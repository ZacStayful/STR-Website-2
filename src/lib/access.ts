export type Profile = {
  id: string
  email: string | null
  /** Legacy flag kept in sync for the Monday mirror: 'pro' while a subscription is active. */
  plan: 'free' | 'pro'
  /** Subscription tier ('starter' | 'pro' | 'scale' | 'pro_annual'); null = pay-as-you-go on credit. */
  plan_code: string | null
  trial_ends_at: string
  reports_run: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
  stripe_price_id: string | null
  stripe_default_payment_method_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
}

// Access is no longer a boolean: every signed-in member can open the app and
// every paid action is charged to their credit balance (src/lib/credit). The
// only thing a plan changes is how much credit arrives each month and which
// perks apply (src/lib/credit/perks.ts).

export function isPro(profile: Pick<Profile, 'plan_code'> | null | undefined): boolean {
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
