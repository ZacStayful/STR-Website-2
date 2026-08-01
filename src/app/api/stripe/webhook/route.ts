import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe webhook: grants Pro (unlimited) access when a user pays, and
// revokes it if their subscription later lapses/cancels. Runs on Node
// (needs the raw request body for signature verification).
//
// The hard problem this file solves is MATCHING a Stripe event back to a
// Supabase profile. A subscription set up by hand in the Stripe dashboard
// never produces a Checkout Session, so there is no client_reference_id to
// match on — and the profile's stripe_subscription_id is still null, so
// subscription.* events have nothing to join against either. Previously
// those customers paid and stayed on `plan: 'free'` forever, which is why
// they kept being told how many free trial reports they had left.
//
// So: every handler funnels through findProfile(), which tries user id →
// subscription id → customer id → email (case-insensitive), backfills the
// Stripe ids it learned onto the profile, and shouts loudly in the logs when
// a payment can't be matched to anybody.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = SupabaseClient;

type ProfileMatch = { id: string; email: string | null };

// Stripe statuses that should grant unlimited access. `past_due` is included
// deliberately — Stripe is still retrying the card, and a paying customer
// must not be paywalled (or worse, shown trial copy) on a single failed
// charge. Kept in sync with LIVE_STATUSES in src/lib/access.ts.
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function isoFromUnix(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Resolve a Stripe event to a Supabase profile, trying every identifier the
 * event gives us. Returns null when nothing matches — the caller logs that as
 * an error, because it means somebody has paid and we can't credit them.
 */
async function findProfile(
  admin: Admin,
  keys: {
    userId?: string | null;
    subscriptionId?: string | null;
    customerId?: string | null;
    email?: string | null;
  },
): Promise<ProfileMatch | null> {
  const select = "id, email";

  if (keys.userId) {
    const { data } = await admin
      .from("profiles")
      .select(select)
      .eq("id", keys.userId)
      .maybeSingle();
    if (data) return data as ProfileMatch;
  }

  if (keys.subscriptionId) {
    const { data } = await admin
      .from("profiles")
      .select(select)
      .eq("stripe_subscription_id", keys.subscriptionId)
      .maybeSingle();
    if (data) return data as ProfileMatch;
  }

  if (keys.customerId) {
    const { data } = await admin
      .from("profiles")
      .select(select)
      .eq("stripe_customer_id", keys.customerId)
      .maybeSingle();
    if (data) return data as ProfileMatch;
  }

  if (keys.email) {
    // Case-insensitive email match — Stripe frequently reports a different
    // casing to the one used at signup. `_` and `%` are legal in the local
    // part of an email and are LIKE wildcards, so the ilike result is
    // re-checked for an exact (lowercased) match before it's trusted: a
    // wildcard hit must never grant Pro to somebody else's account.
    const wanted = keys.email.trim().toLowerCase();
    const { data } = await admin
      .from("profiles")
      .select(select)
      .ilike("email", wanted)
      .limit(5);
    const exact = (data as ProfileMatch[] | null)?.find(
      (row) => row.email?.trim().toLowerCase() === wanted,
    );
    if (exact) return exact;
  }

  return null;
}

/** Pull the billing email off a Stripe customer, for email-fallback matching. */
async function customerEmail(
  stripe: Stripe,
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return customer.email ?? null;
  } catch (err) {
    console.error("[stripe/webhook] could not retrieve customer", customerId, err);
    return null;
  }
}

/**
 * Write subscription state onto the profile. Always backfills the Stripe ids
 * so that later events (which may carry only the subscription or customer id)
 * can match this row directly.
 */
async function applySubscriptionState(
  admin: Admin,
  profileId: string,
  state: {
    status: string;
    customerId: string | null;
    subscriptionId: string | null;
    startedAt?: string | null;
  },
): Promise<void> {
  const live = LIVE_STATUSES.has(state.status);

  const update: Record<string, unknown> = {
    plan: live ? "pro" : "free",
    plan_source: "stripe",
    stripe_subscription_status: state.status,
  };
  if (state.customerId) update.stripe_customer_id = state.customerId;
  if (state.subscriptionId) update.stripe_subscription_id = state.subscriptionId;
  if (live) {
    if (state.startedAt) update.subscription_started_at = state.startedAt;
    update.subscription_ended_at = null;
  } else {
    update.subscription_ended_at = new Date().toISOString();
  }

  const { error } = await admin.from("profiles").update(update).eq("id", profileId);
  if (error) {
    // Loud: a failed write here is what leaves a paying customer on the
    // free-trial banner, so it must never be swallowed.
    console.error("[stripe/webhook] profile update failed", profileId, error);
    throw new Error(`profile update failed: ${error.message}`);
  }
}

/** Grant/revoke off a Stripe Subscription object. */
async function syncSubscription(
  admin: Admin,
  stripe: Stripe,
  sub: Stripe.Subscription,
  extra: { userId?: string | null; email?: string | null } = {},
): Promise<void> {
  const customerId = idOf(sub.customer);
  const email = extra.email ?? (await customerEmail(stripe, customerId));

  const profile = await findProfile(admin, {
    userId: extra.userId,
    subscriptionId: sub.id,
    customerId,
    email,
  });

  if (!profile) {
    console.error(
      "[stripe/webhook] UNMATCHED subscription — no profile for",
      JSON.stringify({ subscription: sub.id, customer: customerId, email }),
      "— this account will keep being treated as a free trial until it is linked.",
    );
    return;
  }

  await applySubscriptionState(admin, profile.id, {
    status: sub.status,
    customerId,
    subscriptionId: sub.id,
    startedAt: isoFromUnix(sub.start_date),
  });

  const mirrorEmail = profile.email ?? email;
  if (!mirrorEmail) return;

  if (LIVE_STATUSES.has(sub.status)) {
    const { setSubscriptionStarted } = await import("@/lib/apis/monday");
    await setSubscriptionStarted(mirrorEmail);
  } else {
    const { setSubscriptionCancelled } = await import("@/lib/apis/monday");
    await setSubscriptionCancelled(mirrorEmail);
  }
}

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
        const customerId = idOf(session.customer);
        const subscriptionId = idOf(session.subscription);
        const email =
          session.customer_details?.email ??
          session.customer_email ??
          (await customerEmail(stripe, customerId));

        // Prefer the real subscription object — it carries the authoritative
        // status (a checkout can complete into a `trialing` subscription).
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscription(admin, stripe, sub, { userId, email });
          break;
        }

        const profile = await findProfile(admin, { userId, customerId, email });
        if (!profile) {
          console.error(
            "[stripe/webhook] UNMATCHED checkout session — no profile for",
            JSON.stringify({ session: session.id, customer: customerId, email }),
          );
          break;
        }

        await applySubscriptionState(admin, profile.id, {
          status: "active",
          customerId,
          subscriptionId,
          startedAt: new Date().toISOString(),
        });

        const mirrorEmail = profile.email ?? email;
        if (mirrorEmail) {
          const { setSubscriptionStarted } = await import("@/lib/apis/monday");
          await setSubscriptionStarted(mirrorEmail);
        }
        break;
      }

      // `created` matters for subscriptions set up by hand in the Stripe
      // dashboard: there is no Checkout Session for those, so this is the
      // only event that can ever link them to a profile.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(admin, stripe, sub);
        break;
      }

      // Safety net. If every earlier event failed to match (customer created
      // before the profile existed, email typo since corrected, webhook
      // downtime), the first successful invoice re-links the account.
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = idOf(
          invoice.parent?.subscription_details?.subscription ?? null,
        );
        if (!subscriptionId) break;
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await syncSubscription(admin, stripe, sub, {
          email: invoice.customer_email ?? null,
        });
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
