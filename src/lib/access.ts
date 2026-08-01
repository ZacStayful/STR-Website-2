// Single source of truth for "what kind of account is this?".
//
// The app previously inferred everything from one column (`plan`), which meant
// a paying customer whose `plan` write never landed was indistinguishable from
// somebody on the free trial — they kept seeing "you have N free reports left".
// Account state is now derived from BOTH the `plan` column and the Stripe
// subscription status, so a write that failed on one side can't demote a real
// customer back onto the trial.

export type Plan = 'free' | 'pro'

export type Profile = {
  id: string
  email: string | null
  plan: Plan
  trial_ends_at: string
  reports_run: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
  // How the current plan was granted: Stripe webhook, or set by hand in the
  // Supabase dashboard for a subscription that was arranged manually.
  plan_source: 'stripe' | 'manual' | null
  subscription_started_at: string | null
  subscription_ended_at: string | null
}

// Free users get a fixed number of analyses before they must subscribe.
// (Previously the trial was time-based — 14 days — now it's usage-based.)
export const FREE_RUNS = 5

// Stripe statuses that mean the account is a live customer and should have
// unlimited access. `past_due` is deliberately included: Stripe is still
// retrying the card, and locking a paying customer out on the first failed
// charge is exactly the kind of false paywall this module exists to prevent.
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

// Of the live statuses, the ones where money is actually being collected.
// `trialing` is a Stripe-run free period on a real subscription — unlimited
// access, but not a paying customer yet.
const PAYING_STATUSES = new Set(['active', 'past_due'])

/**
 * What state is this account in? Every gate, banner and paywall message in the
 * app should branch on this rather than reading `plan` directly.
 *
 * - `paid`            — live, billed subscription (or a manually granted plan).
 * - `subscription_trial` — Stripe free period on a real subscription.
 * - `free_trial`      — never subscribed, still has free reports left.
 * - `trial_expired`   — never subscribed, free reports used up.
 * - `lapsed`          — subscribed before; subscription cancelled or expired.
 */
export type AccountStatus =
  | 'paid'
  | 'subscription_trial'
  | 'free_trial'
  | 'trial_expired'
  | 'lapsed'

// Tolerate partial selects and loosely-typed Supabase rows: callers that only
// fetched some columns (or typed `plan` as a nullable string) still get a sane
// answer rather than a crash or a type error.
type PartialAccount = {
  plan?: Plan | string | null
  reports_run?: number | null
  stripe_subscription_id?: string | null
  stripe_subscription_status?: string | null
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

export function accountStatus(profile: PartialAccount): AccountStatus {
  const s = status(profile)

  // A live Stripe subscription is authoritative, whatever `plan` says.
  if (s && LIVE_STATUSES.has(s)) {
    return PAYING_STATUSES.has(s) ? 'paid' : 'subscription_trial'
  }

  // plan='pro' with no live Stripe status is a manually granted subscription
  // (set by hand while self-serve checkout was still being built), or a
  // Stripe grant whose status column never got written. Either way: paid.
  if (profile.plan === 'pro') return 'paid'

  // Not pro and no live subscription, but there is subscription history —
  // they cancelled or the subscription lapsed. They do NOT fall back onto the
  // free-report allowance, and they must never be told they're "on a trial".
  if (hasSubscriptionHistory(profile)) return 'lapsed'

  return hasFreeRunsLeft(profile) ? 'free_trial' : 'trial_expired'
}

/**
 * Unlimited access via a subscription — paying customer or Stripe trial.
 * This is the check to use for "should we hide trial UI?".
 */
export function isSubscriber(profile: PartialAccount): boolean {
  const s = accountStatus(profile)
  return s === 'paid' || s === 'subscription_trial'
}

/** Strictly a paying customer (excludes Stripe free trials). */
export function isPaid(profile: PartialAccount): boolean {
  return accountStatus(profile) === 'paid'
}

/** On the usage-based free trial — never subscribed, reports still left. */
export function isOnFreeTrial(profile: PartialAccount): boolean {
  return accountStatus(profile) === 'free_trial'
}

/**
 * Someone who subscribed at least once but isn't currently a subscriber —
 * i.e. they cancelled or their subscription lapsed. These users must
 * re-subscribe; they do NOT fall back to the free tier.
 */
export function isLapsedSubscriber(profile: PartialAccount): boolean {
  return accountStatus(profile) === 'lapsed'
}

/** @deprecated Prefer `isSubscriber` — kept because `plan` alone lies. */
export function isPro(profile: Pick<Profile, 'plan'>): boolean {
  return profile.plan === 'pro'
}

export function hasFreeRunsLeft(profile: PartialAccount): boolean {
  return (profile.reports_run ?? 0) < FREE_RUNS
}

/**
 * How many free reports are left. Returns `null` for anyone who isn't on the
 * free trial, so that free-trial copy ("N reports left") is impossible to
 * render for a subscriber — the count simply doesn't exist for them.
 */
export function freeReportsRemaining(profile: PartialAccount): number | null {
  if (!isOnFreeTrial(profile)) return null
  return Math.max(0, FREE_RUNS - (profile.reports_run ?? 0))
}

/**
 * Should this analysis burn a free-report credit? Only for free-trial users.
 * Subscribers get unlimited reports, so counting theirs would silently
 * exhaust an allowance they'd be dropped onto if their subscription ever
 * lapsed — instantly hard-paywalling a customer who never had a trial.
 */
export function countsAgainstFreeTrial(profile: PartialAccount): boolean {
  return accountStatus(profile) === 'free_trial'
}

export function hasAccess(profile: PartialAccount): boolean {
  switch (accountStatus(profile)) {
    case 'paid':
    case 'subscription_trial':
    case 'free_trial':
      return true
    case 'lapsed':
    case 'trial_expired':
      return false
  }
}

/** Columns every access check needs. Select these together, always. */
export const ACCESS_COLUMNS =
  'plan, reports_run, stripe_subscription_id, stripe_subscription_status'
