import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe webhook: grants Pro (unlimited) access when a user pays, and
// revokes it if their subscription later lapses/cancels. Runs on Node
// (needs the raw request body for signature verification).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("[stripe/webhook] STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
    return new Response("Stripe is not configured.", { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      // Fired when a Payment Link / Checkout completes successfully.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const email =
          session.customer_details?.email ?? session.customer_email ?? null;

        const update = {
          plan: "pro",
          stripe_customer_id:
            typeof session.customer === "string" ? session.customer : null,
          stripe_subscription_id:
            typeof session.subscription === "string" ? session.subscription : null,
          stripe_subscription_status: "active",
        };

        // Prefer the exact user id we tagged the link with; fall back to email.
        if (userId) {
          await admin.from("profiles").update(update).eq("id", userId);
        } else if (email) {
          await admin.from("profiles").update(update).eq("email", email);
        } else {
          console.warn("[stripe/webhook] completed session with no user id or email");
        }
        break;
      }

      // Keep access in sync if the subscription changes or is cancelled.
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const active = sub.status === "active" || sub.status === "trialing";
        await admin
          .from("profiles")
          .update({
            plan: active ? "pro" : "free",
            stripe_subscription_status: sub.status,
          })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      default:
        // Ignore other event types.
        break;
    }
  } catch (err) {
    console.error("[stripe/webhook] handler error:", err);
    return new Response("Webhook handler error.", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
