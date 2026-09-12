// Single source of truth for "what kind of account is this?".
//
// Access is no longer a boolean: every signed-in member can open the app and
// every paid action is charged to their credit balance (src/lib/credit). What a
// subscription changes is how much credit arrives each month and which perks
// apply (src/lib/credit/perks.ts). This module answers the billing-state
// questions the account page, the webhook and the admin dashboard still need:
// is this a live subscriber, are they paused, is a cancellation booked.
//
// Account state is derived from BOTH the `plan` column and the Stripe
// subscription status, so a write that failed on one side can't demote a real
// customer.

export type Plan = 'free' | 'pro'

export type Profile = {
  id: string
  email: string | null
  /** Legacy flag kept in sync for the Monday mirror: 'pro' while a subscription is live. */
  plan: Plan
  /** Subscription tier ('starter' | 'pro' | 'scale' | 'pro_annual'); null = pay-as-you-go on credit. */
  plan_code: string | null
  trial_ends_at: string
  // Legacy free-trial counter. No longer advanced; kept for reporting.
  reports_run: number
  // Every report ever run. Reporting only, never gating.
  reports_total: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
  stripe_price_id: string | null
  stripe_default_payment_method_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  // How the current plan was granted: Stripe webhook, or set by hand in the
  // Supabase dashboard for a subscription that was arranged manually.
  plan_source: 'stripe' | 'manual' | null
  subscription_started_at: string | null
  subscription_ended_at: string | null
  // Self-serve pause window. See isPaused() below and the schema comment.
  subscription_paused_from: string | null
  subscription_paused_until: string | null
  // Mirrors Stripe's cancel_at, set by cancel_at_period_end.
  subscription_cancel_at: string | null
  subscription_current_period_end: string | null
}

export function isPro(profile: { plan_code?: string | null } | null | undefined): boolean {
  return Boolean(profile?.plan_code)
}

export const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  scale: 'Scale',
  pro_annual: 'Pro (annual)',
}

export function planName(code: string | null | undefined): string {
  if (!code) return 'Pay as you go'
  return PLAN_NAMES[code] ?? code
}

// Stripe statuses that mean the account is a live subscriber. `past_due` is
// deliberately included: Stripe is still retrying the card, and treating a
// paying customer as lapsed on the first failed charge is exactly the kind of
// false signal this module exists to prevent.
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

// Of the live statuses, the ones where money is actually being collected.
// `trialing` is a Stripe-run free period on a real subscription.
const PAYING_STATUSES = new Set(['active', 'past_due'])

/**
 * What billing state is this account in? Every banner and plan card in the
 * app should branch on this rather than reading `plan` directly.
 *
 * - `paid`               — live, billed subscription (or a manually granted plan).
 * - `subscription_trial` — Stripe free period on a real subscription.
 * - `free`               — never subscribed: pay-as-you-go on welcome / top-up credit.
 * - `lapsed`             — subscribed before; subscription cancelled or expired.
 *                          Still a member: they keep whatever credit they have.
 * - `paused`             — inside a self-serve pause window: not billed and no
 *                          new plan credit, comes back on its own at the end of
 *                          the window. Remaining credit stays spendable.
 */
export type AccountStatus = 'paid' | 'subscription_trial' | 'free' | 'lapsed' | 'paused'

// Tolerate partial selects and loosely-typed Supabase rows: callers that only
// fetched some columns (or typed `plan` as a nullable string) still get a sane
// answer rather than a crash or a type error.
type PartialAccount = {
  plan?: Plan | string | null
  plan_code?: string | null
  plan_source?: string | null
  reports_run?: number | null
  stripe_subscription_id?: string | null
  stripe_subscription_status?: string | null
  subscription_paused_from?: string | null
  subscription_paused_until?: string | null
  subscription_cancel_at?: string | null
}

/** The same shape, named for callers that pass a profile row around. */
export type AccessProfile = PartialAccount

function time(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/**
 * Is this account inside a pause window right now?
 *
 * A pause is two timestamps, not a flag, and the test is `from <= now < until`.
 * That makes both ends self-correcting: a pause booked for the end of the paid
 * period does nothing until it arrives, and an elapsed one restores the plan on
 * the next read even if Stripe's resume webhook was never delivered. Nothing
 * about a pause depends on a cron or on a boolean staying in sync.
 *
 * A window missing either end is not a pause.
 */
export function isPaused(profile: PartialAccount, now: number = Date.now()): boolean {
  const from = time(profile.subscription_paused_from)
  const until = time(profile.subscription_paused_until)
  if (from === null || until === null) return false
  return from <= now && now < until
}

/** Pause booked but not started — still a paying member until `from`. */
export function isPauseScheduled(profile: PartialAccount, now: number = Date.now()): boolean {
  const from = time(profile.subscription_paused_from)
  const until = time(profile.subscription_paused_until)
  if (from === null || until === null) return false
  return now < from
}

/** Cancellation booked for the end of the paid period, and not yet reached. */
export function isCancelScheduled(profile: PartialAccount, now: number = Date.now()): boolean {
  const at = time(profile.subscription_cancel_at)
  return at !== null && now < at
}

function status(profile: PartialAccount): string | null {
  return profile.stripe_subscription_status?.trim().toLowerCase() ?? null
}

/** True when Stripe currently reports a live subscription for this account. */
export function hasLiveSubscription(profile: PartialAccount): boolean {
  const s = status(profile)
  return !!s && LIVE_STATUSES.has(s)
}

/** True when the account has ever been attached to a Stripe subscription. */
export function hasSubscriptionHistory(profile: PartialAccount): boolean {
  return !!profile.stripe_subscription_id || !!status(profile)
}

export function accountStatus(profile: PartialAccount, now: number = Date.now()): AccountStatus {
  const s = status(profile)

  // Checked first, ahead of both the manual override and Stripe. A pause leaves
  // the Stripe status on 'active' (pause_collection does not change it), so
  // anything that reads the status first would call a paused member "paid".
  if (isPaused(profile, now)) return 'paused'

  // A plan granted by hand (plan_source='manual') is a deliberate decision by
  // us and outranks anything Stripe says — it's the escape hatch for a
  // customer Stripe doesn't know about, or whose Stripe record is wrong.
  if (profile.plan === 'pro' && profile.plan_source === 'manual') return 'paid'

  // Otherwise Stripe is the source of truth for billing, in BOTH directions.
  if (s) {
    if (LIVE_STATUSES.has(s)) {
      return PAYING_STATUSES.has(s) ? 'paid' : 'subscription_trial'
    }
    // A dead Stripe status is just as authoritative as a live one: the
    // subscription is over, whatever a stale `plan` column still says.
    return 'lapsed'
  }

  // No Stripe status at all. plan='pro' here is a legacy or hand-set grant.
  if (profile.plan === 'pro' || profile.plan_code) return 'paid'

  // A subscription id but no status — subscription history all the same.
  if (hasSubscriptionHistory(profile)) return 'lapsed'

  return 'free'
}

/**
 * Live subscription — paying customer or Stripe trial. This is the check to
 * use for "does plan credit arrive each month?".
 */
export function isSubscriber(profile: PartialAccount, now: number = Date.now()): boolean {
  const s = accountStatus(profile, now)
  return s === 'paid' || s === 'subscription_trial'
}

/** Strictly a paying customer (excludes Stripe free trials). */
export function isPaid(profile: PartialAccount, now: number = Date.now()): boolean {
  return accountStatus(profile, now) === 'paid'
}

/**
 * Someone who subscribed at least once but isn't currently a subscriber —
 * i.e. they cancelled or their subscription lapsed. They stay a member on
 * whatever credit they have left.
 */
export function isLapsedSubscriber(profile: PartialAccount, now: number = Date.now()): boolean {
  return accountStatus(profile, now) === 'lapsed'
}

/**
 * Columns every billing-state check needs. Select these together, always.
 *
 * The Supabase client here is untyped, so a missing column is not a type error
 * — it reads as undefined and silently changes the answer.
 */
export const ACCESS_COLUMNS =
  'plan, plan_code, plan_source, reports_run, stripe_subscription_id, stripe_subscription_status, subscription_paused_from, subscription_paused_until, subscription_cancel_at'

/**
 * The body for a 402 when someone is signed in but the app cannot serve them:
 * today that only happens when the profile row is missing (sign-up did not
 * finish). Out-of-credit refusals use src/lib/credit/http.ts instead.
 *
 * Shared so the API, the extension and the analyser say the same thing.
 */
export function accessDenied(
  profile: PartialAccount | null | undefined,
  feature = 'this',
): { error: string; upgradeUrl: string; code: AccountStatus | 'unknown' } {
  if (!profile) {
    return {
      error: `Your account isn't set up yet, so ${feature} is switched off. Open the Stayful site to finish setting up.`,
      upgradeUrl: '/upgrade',
      code: 'unknown',
    }
  }
  return { error: `Your plan does not include ${feature}.`, upgradeUrl: '/upgrade', code: accountStatus(profile) }
}
