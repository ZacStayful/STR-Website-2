export type Profile = {
  id: string
  email: string | null
  plan: 'free' | 'pro'
  trial_ends_at: string
  reports_run: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
}

// Free users get a fixed number of analyses before they must subscribe.
// (Previously the trial was time-based — 14 days — now it's usage-based.)
export const FREE_RUNS = 5

export function isPro(profile: Pick<Profile, 'plan'>): boolean {
  return profile.plan === 'pro'
}

// How many free reports the user has left (never negative).
export function runsRemaining(profile: Pick<Profile, 'reports_run'>): number {
  return Math.max(0, FREE_RUNS - (profile.reports_run ?? 0))
}

export function hasFreeRunsLeft(profile: Pick<Profile, 'reports_run'>): boolean {
  return (profile.reports_run ?? 0) < FREE_RUNS
}

// Someone who subscribed at least once (has a Stripe subscription on record)
// but isn't currently Pro — i.e. they cancelled or their subscription lapsed.
// These users must re-subscribe; they do NOT fall back to the free tier.
export function isLapsedSubscriber(
  profile: Pick<Profile, 'plan' | 'stripe_subscription_id'>,
): boolean {
  return !!profile.stripe_subscription_id && profile.plan !== 'pro'
}

export function hasAccess(
  profile: Pick<Profile, 'plan' | 'reports_run' | 'stripe_subscription_id'>,
): boolean {
  if (isPro(profile)) return true
  // Former subscribers who cancelled are sent to the paywall — no falling
  // back onto the free-report allowance.
  if (isLapsedSubscriber(profile)) return false
  return hasFreeRunsLeft(profile)
}
