import Stripe from "stripe";
import { subscriptionStateFromStripe } from "@/lib/subscription";
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

// The profile we matched, plus enough of its current state to tell whether
// this event actually changes anything.
type ProfileMatch = {
  id: string;
  email: string | null;
  plan: string | null;
  plan_source: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
};

const PROFILE_FIELDS =
  "id, email, plan, plan_source, stripe_subscription_id, stripe_subscription_status";

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
  const select = PROFILE_FIELDS;

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
  profile: ProfileMatch,
  state: {
    status: string;
    customerId: string | null;
    subscriptionId: string | null;
    startedAt?: string | null;
    /**
     * The subscription this state came from, when there is one. Every
     * pause/cancel column is re-derived from it, so a replayed event writes
     * the same row and an auto-resume clears the pause by itself. Absent only
     * on the checkout fallback that has no subscription to read, where the
     * same columns are cleared instead.
     */
    subscription?: Stripe.Subscription | null;
  },
): Promise<void> {
  const live = LIVE_STATUSES.has(state.status);

  // A plan granted by hand is a deliberate decision that outranks Stripe
  // (accountStatus honours it the same way). Record what Stripe told us, but
  // don't let a stray event silently revoke the override.
  const manual = profile.plan === "pro" && profile.plan_source === "manual";

  const update: Record<string, unknown> = {
    stripe_subscription_status: state.status,
  };
  if (!manual) {
    update.plan = live ? "pro" : "free";
    update.plan_source = "stripe";
  }
  if (state.customerId) update.stripe_customer_id = state.customerId;
  if (state.subscriptionId) update.stripe_subscription_id = state.subscriptionId;
  if (live) {
    if (state.startedAt) update.subscription_started_at = state.startedAt;
    update.subscription_ended_at = null;
  } else {
    update.subscription_ended_at = new Date().toISOString();
  }

  // Self-serve pause and cancel. Always written, never merged: these columns
  // are a projection of the subscription, so re-deriving the whole set is what
  // makes a replayed event a no-op and lets an auto-resume (which arrives as
  // `pause_collection: null`) clear the window on its own. A member who
  // re-subscribes after lapsing gets a clean slate for the same reason.
  const derived = state.subscription
    ? subscriptionStateFromStripe(state.subscription)
    : null;
  update.subscription_paused_from = derived?.pausedFrom ?? null;
  update.subscription_paused_until = derived?.pausedUntil ?? null;
  update.subscription_cancel_at = derived?.cancelAt ?? null;
  update.subscription_current_period_end = derived?.currentPeriodEnd ?? null;
  if (!derived?.cancelAt) {
    // The cancellation was undone, or the subscription is gone. Either way the
    // captured reason no longer describes anything.
    update.cancel_reason = null;
    update.cancel_reason_comment = null;
    update.cancel_reason_at = null;
  }

  const { error } = await admin.from("profiles").update(update).eq("id", profile.id);
  if (error) {
    // Loud: a failed write here is what leaves a paying customer on the
    // free-trial banner, so it must never be swallowed.
    console.error("[stripe/webhook] profile update failed", profile.id, error);
    throw new Error(`profile update failed: ${error.message}`);
  }
}

/**
 * Mirror a subscription transition to the Monday CRM — but ONLY on an actual
 * change of state. `setSubscriptionStarted` overwrites the "Subscribed" date
 * column, and `customer.subscription.updated` fires on every trivial change
 * (metadata edits, renewals), so mirroring unconditionally would rewrite the
 * original subscription date to today over and over.
 */
async function mirrorToMonday(
  email: string | null,
  wasLive: boolean,
  isLive: boolean,
): Promise<void> {
  if (!email || wasLive === isLive) return;
  if (isLive) {
    const { setSubscriptionStarted } = await import("@/lib/apis/monday");
    await setSubscriptionStarted(email);
  } else {
    const { setSubscriptionCancelled } = await import("@/lib/apis/monday");
    await setSubscriptionCancelled(email);
  }
}

/**
 * Any OTHER live subscription this customer holds. Used to decide whether a
 * cancellation really means "stop their access", or is just the tail of a plan
 * change. Returns null if Stripe can't be reached — the caller then trusts the
 * event it was handed.
 */
async function liveSubscriptionFor(
  stripe: Stripe,
  customerId: string,
  excludeId: string,
): Promise<Stripe.Subscription | null> {
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    return (
      subs.data.find(
        (s) => s.id !== excludeId && LIVE_STATUSES.has(s.status),
      ) ?? null
    );
  } catch (err) {
    console.error("[stripe/webhook] could not list subscriptions", customerId, err);
    return null;
  }
}

/** Was this profile already being treated as a live subscriber? */
function wasLive(profile: ProfileMatch): boolean {
  const prior = profile.stripe_subscription_status?.trim().toLowerCase();
  return prior ? LIVE_STATUSES.has(prior) : profile.plan === "pro";
}

/** Grant/revoke off a Stripe Subscription object. */
async function syncSubscription(
  admin: Admin,
  stripe: Stripe,
  sub: Stripe.Subscription,
  extra: { userId?: string | null; email?: string | null } = {},
): Promise<void> {
  const customerId = idOf(sub.customer);

  // Try the cheap id-based matches first. Only reach out to Stripe for the
  // customer's email if none of them hit — `subscription.updated` fires often
  // enough that an unconditional customers.retrieve is wasted latency and
  // quota on every renewal.
  let email = extra.email ?? null;
  let profile = await findProfile(admin, {
    userId: extra.userId,
    subscriptionId: sub.id,
    customerId,
    email,
  });

  if (!profile && !email) {
    email = await customerEmail(stripe, customerId);
    if (email) profile = await findProfile(admin, { email });
  }

  if (!profile) {
    console.error(
      "[stripe/webhook] UNMATCHED subscription — no profile for",
      JSON.stringify({ subscription: sub.id, customer: customerId, email }),
      "— this account will keep being treated as a free trial until it is linked.",
    );
    return;
  }

  const before = wasLive(profile);
  let effective = sub;

  // Don't let a dead subscription revoke access when the customer still has a
  // live one. Switching plan (monthly → annual) cancels the old subscription
  // and creates a new one, and Stripe does not guarantee event order — so a
  // late `sub_old.deleted` would otherwise lock out a customer who is paying
  // on sub_new.
  if (!LIVE_STATUSES.has(sub.status) && customerId) {
    const live = await liveSubscriptionFor(stripe, customerId, sub.id);
    if (live) {
      console.warn(
        "[stripe/webhook] ignoring",
        `${sub.id} (${sub.status})`,
        "— customer still has live subscription",
        live.id,
      );
      effective = live;
    }
  }

  const isLive = LIVE_STATUSES.has(effective.status);

  await applySubscriptionState(admin, profile, {
    status: effective.status,
    customerId,
    subscriptionId: effective.id,
    startedAt: isoFromUnix(effective.start_date),
    subscription: effective,
  });

  await mirrorToMonday(profile.email ?? email, before, isLive);
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

        const before = wasLive(profile);
        await applySubscriptionState(admin, profile, {
          status: "active",
          customerId,
          subscriptionId,
          startedAt: new Date().toISOString(),
        });
        await mirrorToMonday(profile.email ?? email, before, true);
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
