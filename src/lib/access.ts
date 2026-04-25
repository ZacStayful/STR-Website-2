export type Profile = {
  id: string
  email: string | null
  plan: 'free' | 'pro'
  trial_ends_at: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
}

export const TRIAL_DAYS = 14

export function isTrialActive(profile: Pick<Profile, 'trial_ends_at'>): boolean {
  return new Date(profile.trial_ends_at).getTime() > Date.now()
}

export function isPro(profile: Pick<Profile, 'plan'>): boolean {
  return profile.plan === 'pro'
}

export function hasAccess(profile: Pick<Profile, 'plan' | 'trial_ends_at'>): boolean {
  return isPro(profile) || isTrialActive(profile)
}

export function trialDaysRemaining(profile: Pick<Profile, 'trial_ends_at'>): number {
  const ms = new Date(profile.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}
