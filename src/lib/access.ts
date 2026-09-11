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
  // Self-serve pause window. See isPaused() below and the schema comment.
  subscription_paused_from: string | null
  subscription_paused_until: string | null
  // Mirrors Stripe's cancel_at, set by cancel_at_period_end.
  subscription_cancel_at: string | null
  subscription_current_period_end: string | null
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
 * - `paused`          — inside a self-serve pause window: not billed, no access,
 *                       and it comes back on its own at the end of the window.
 */
export type AccountStatus =
  | 'paid'
  | 'subscription_trial'
  | 'free_trial'
  | 'trial_expired'
  | 'lapsed'
  | 'paused'

// Tolerate partial selects and loosely-typed Supabase rows: callers that only
// fetched some columns (or typed `plan` as a nullable string) still get a sane
// answer rather than a crash or a type error.
type PartialAccount = {
  plan?: Plan | string | null
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
 * period does nothing until it arrives, and an elapsed one restores access on
 * the next read even if Stripe's resume webhook was never delivered. Nothing
 * about a pause depends on a cron or on a boolean staying in sync.
 *
 * A window missing either end is not a pause. A half-written row must fail
 * towards giving the member access, never towards locking a payer out.
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
  // anything that reads the status first would hand a paused member full
  // access. A manual grant must not rescue them either — they asked to pause.
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
export function isSubscriber(profile: PartialAccount, now: number = Date.now()): boolean {
  const s = accountStatus(profile, now)
  return s === 'paid' || s === 'subscription_trial'
}

/** Strictly a paying customer (excludes Stripe free trials). */
export function isPaid(profile: PartialAccount, now: number = Date.now()): boolean {
  return accountStatus(profile, now) === 'paid'
}

/** On the usage-based free trial — never subscribed, reports still left. */
export function isOnFreeTrial(profile: PartialAccount, now: number = Date.now()): boolean {
  return accountStatus(profile, now) === 'free_trial'
}

/**
 * Someone who subscribed at least once but isn't currently a subscriber —
 * i.e. they cancelled or their subscription lapsed. These users must
 * re-subscribe; they do NOT fall back to the free tier.
 */
export function isLapsedSubscriber(profile: PartialAccount, now: number = Date.now()): boolean {
  return accountStatus(profile, now) === 'lapsed'
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
export function freeReportsRemaining(profile: PartialAccount, now: number = Date.now()): number | null {
  if (!isOnFreeTrial(profile, now)) return null
  return Math.max(0, FREE_RUNS - (profile.reports_run ?? 0))
}

/**
 * Should this analysis burn a free-report credit? Only for free-trial users.
 * Subscribers get unlimited reports, so counting theirs would silently
 * exhaust an allowance they'd be dropped onto if their subscription ever
 * lapsed — instantly hard-paywalling a customer who never had a trial.
 */
export function countsAgainstFreeTrial(profile: PartialAccount, now: number = Date.now()): boolean {
  return accountStatus(profile, now) === 'free_trial'
}

export function hasAccess(profile: PartialAccount, now: number = Date.now()): boolean {
  switch (accountStatus(profile, now)) {
    case 'paid':
    case 'subscription_trial':
    case 'free_trial':
      return true
    case 'lapsed':
    case 'trial_expired':
    case 'paused':
      return false
  }
}

/**
 * Columns every access check needs. Select these together, always.
 *
 * The Supabase client here is untyped, so a missing column is not a type error
 * — it reads as undefined and silently changes the answer. Omitting the pause
 * columns would hand a paused member full access.
 */
export const ACCESS_COLUMNS =
  'plan, plan_source, reports_run, stripe_subscription_id, stripe_subscription_status, subscription_paused_from, subscription_paused_until, subscription_cancel_at'

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
  now: number = Date.now(),
): 'free_trial' | 'lapsed' | 'paused' | null {
  if (admin || !profile) return null
  const s = accountStatus(profile, now)
  // A paused member is not on a trial and has not lapsed — they chose this and
  // it ends on a known date, so they get their own banner.
  if (s === 'paused') return 'paused'
  if (s === 'paid' || s === 'subscription_trial') return null
  return s === 'lapsed' ? 'lapsed' : 'free_trial'
}

/**
 * The body for a 402 when someone is signed in but cannot use a feature.
 *
 * Shared so the API, the extension and the analyser say the same thing. The
 * important case is `paused`: those members already HAVE a subscription, so
 * sending them to checkout would start a second one and bill them twice. Their
 * route out is /account, never /upgrade.
 */
export function accessDenied(
  profile: PartialAccount | null | undefined,
  feature = 'this',
  now: number = Date.now(),
): { error: string; upgradeUrl: string; code: AccountStatus | 'unknown' } {
  if (!profile) {
    return { error: `Your plan does not include ${feature}.`, upgradeUrl: '/upgrade', code: 'unknown' }
  }
  const s = accountStatus(profile, now)
  if (s === 'paused') {
    return {
      error: `Your plan is paused, so ${feature} is switched off. Restart it to carry on.`,
      upgradeUrl: '/account',
      code: s,
    }
  }
  if (s === 'lapsed') {
    return {
      error: `Your subscription has ended, so ${feature} is switched off.`,
      upgradeUrl: '/upgrade',
      code: s,
    }
  }
  return { error: `Your plan does not include ${feature}.`, upgradeUrl: '/upgrade', code: s }
}
