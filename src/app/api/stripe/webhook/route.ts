import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeEvent } from "@/lib/stripe/webhook";
import { liveWebhookDeps } from "@/lib/stripe/deps";
import { SECRET_VARS, verifyWebhook, webhookSecrets } from "@/lib/billing/webhook-secrets";

// Stripe webhook: turns money into credit. Subscriptions grant a plan cycle
// on every paid invoice, top-ups grant on payment, cancellations expire plan
// credit, and pause / cancel state is mirrored onto the profile. Every event
// id is recorded first so a retry can never double-grant.
// Runs on Node (needs the raw request body for signature verification).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  // One secret per endpoint. The account has more than one endpoint, and a
  // delivery is signed only with the secret of the endpoint it came from.
  const secrets = webhookSecrets(process.env);
  if (!secretKey || secrets.length === 0) {
    console.error(`[stripe/webhook] not configured — need STRIPE_SECRET_KEY and at least one of ${SECRET_VARS.join(", ")}`);
    return new Response("Stripe is not configured.", { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const rawBody = await request.text();

  const verified = verifyWebhook(stripe, rawBody, request.headers.get("stripe-signature"), secrets);
  if (!verified) {
    // Never log the secrets, only how many were tried.
    console.error(`[stripe/webhook] signature verification failed against all ${secrets.length} configured secret(s)`);
    return new Response("Invalid signature.", { status: 400 });
  }
  const { event, position } = verified;
  // The position identifies which endpoint sent this, without exposing the
  // secret. Once only one position ever appears, the other endpoint is unused.
  console.log(`[stripe/webhook] ${event.type} verified with secret ${position}/${secrets.length}`);

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
