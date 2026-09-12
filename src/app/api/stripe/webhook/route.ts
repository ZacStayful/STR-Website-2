import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeEvent, type Crm } from "@/lib/billing/webhook";
import { SECRET_VARS, verifyWebhook, webhookSecrets } from "@/lib/billing/webhook-secrets";

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
  // One secret per endpoint. The account has more than one endpoint, and a
  // delivery is signed only with the secret of the endpoint it came from.
  const secrets = webhookSecrets(process.env);
  if (!secretKey || secrets.length === 0) {
    console.error(
      `[stripe/webhook] not configured — need STRIPE_SECRET_KEY and at least one of ${SECRET_VARS.join(", ")}`,
    );
    return new Response("Stripe is not configured.", { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const rawBody = await request.text();

  const verified = verifyWebhook(
    stripe,
    rawBody,
    request.headers.get("stripe-signature"),
    secrets,
  );
  if (!verified) {
    // Never log the secrets, only how many were tried.
    console.error(
      `[stripe/webhook] signature verification failed against all ${secrets.length} configured secret(s)`,
    );
    return new Response("Invalid signature.", { status: 400 });
  }

  const { event, position } = verified;
  // The position identifies which endpoint sent this, without exposing the
  // secret. Once only one position ever appears, the other endpoint is unused
  // and can be deleted.
  console.log(
    `[stripe/webhook] ${event.type} verified with secret ${position}/${secrets.length}`,
  );

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
