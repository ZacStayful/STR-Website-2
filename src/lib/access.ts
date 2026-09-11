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
  // Free-trial allowance counter — only advances while on the free trial.
  reports_run: number
  // Every report ever run, subscribers included. Reporting only, never gating.
  reports_total: number
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
  plan_source?: string | null
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
    // subscription is over, whatever a stale `plan` column still says. They
    // do NOT fall back onto the free-report allowance, and must never be
    // told they're "on a trial".
    return 'lapsed'
  }

  // No Stripe status at all. plan='pro' here is a legacy or hand-set grant.
  if (profile.plan === 'pro') return 'paid'

  // A subscription id but no status — subscription history all the same.
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

// NOTE: there is deliberately no `isPro(profile)` helper reading `plan` on its
// own. That check is what let a paying customer whose plan write failed be
// treated as a free-trial user. Use `isSubscriber` / `accountStatus`.

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
  'plan, plan_source, reports_run, stripe_subscription_id, stripe_subscription_status'

/**
 * Which TrialBanner variant to show, or null for no banner.
 *
 * Admins and subscribers (paying customers and Stripe-trial customers) have
 * unlimited access, so free-report copy is always wrong for them. Shared by
 * every layout that renders the banner so the three can't drift apart.
 */
export function trialBannerVariant(
  profile: PartialAccount | null | undefined,
  admin: boolean,
): 'free_trial' | 'lapsed' | null {
  if (admin || !profile) return null
  const s = accountStatus(profile)
  if (s === 'paid' || s === 'subscription_trial') return null
  return s === 'lapsed' ? 'lapsed' : 'free_trial'
}
