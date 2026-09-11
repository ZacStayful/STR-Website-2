import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeEvent, type Crm } from "@/lib/billing/webhook";

// Stripe webhook. Grants Pro (unlimited) access when someone pays, revokes it
// when their subscription lapses, and mirrors pause and cancel state onto the
// profile. Runs on Node because signature verification needs the raw body.
//
// All the logic lives in src/lib/billing/webhook.ts so it can be driven by fake
// clients in a test. This file only does what cannot be faked: read the env,
// verify the signature, and build the real dependencies.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Monday mirror, imported lazily so an unconfigured CRM costs nothing on
// the events that never reach it.
const mondayCrm: Crm = {
  async subscriptionStarted(email) {
    const { setSubscriptionStarted } = await import("@/lib/apis/monday");
    await setSubscriptionStarted(email);
  },
  async subscriptionCancelled(email) {
    const { setSubscriptionCancelled } = await import("@/lib/apis/monday");
    await setSubscriptionCancelled(email);
  },
};

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

  try {
    await handleStripeEvent(
      { admin: createAdminClient(), stripe, crm: mondayCrm },
      event,
    );
  } catch (err) {
    // 500 so Stripe retries. A write that failed here is what leaves a paying
    // customer on the free-trial banner, so it must never be swallowed.
    console.error("[stripe/webhook] handler error:", err);
    return new Response("Webhook handler error.", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
