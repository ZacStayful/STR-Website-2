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

export function hasAccess(profile: Pick<Profile, 'plan' | 'reports_run'>): boolean {
  return isPro(profile) || hasFreeRunsLeft(profile)
}
