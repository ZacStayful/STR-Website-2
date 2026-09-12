import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeEvent } from "@/lib/stripe/webhook";
import { liveWebhookDeps } from "@/lib/stripe/deps";

// Stripe webhook: turns money into credit. Subscriptions grant a plan cycle
// on every paid invoice, top-ups grant on payment, cancellations expire plan
// credit. Every event id is recorded first so a retry can never double-grant.
// Runs on Node (needs the raw request body for signature verification).
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

  // Idempotency: claim the event id; a duplicate delivery is acknowledged and skipped.
  const { data: claimed, error: claimError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type })
    .select("id")
    .maybeSingle();
  if (claimError && claimError.code !== "23505") {
    console.error("[stripe/webhook] could not record event:", claimError.message);
  }
  if (!claimed && claimError?.code === "23505") {
    const { data: prior } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
    if (prior?.processed_at) return Response.json({ received: true, duplicate: true });
    // Claimed earlier but never finished (handler error): fall through and retry.
  }

  try {
    const result = await handleStripeEvent(event, liveWebhookDeps());
    await admin.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    if (result.note) console.log(`[stripe/webhook] ${event.type}: ${result.note}`);
    return Response.json({ received: true, handled: result.handled });
  } catch (err) {
    console.error("[stripe/webhook] handler error:", err);
    await admin.from("stripe_events").update({ error: String((err as Error)?.message ?? err).slice(0, 500) }).eq("id", event.id);
    return new Response("Webhook handler error.", { status: 500 });
  }
}
