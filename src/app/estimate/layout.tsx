import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAccess, isTrialActive, trialDaysRemaining, type Profile } from '@/lib/access'
import { signOutAction } from '../(auth)/actions'

// Auth is enforced by proxy.ts (redirects unauthenticated users to /login).
// This layout adds the plan-and-trial check on top: users whose trial has
// expired and who don't have an active subscription are bounced to /upgrade.
export default async function EstimateLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Belt-and-braces — proxy.ts should have caught this already.
  if (!user) {
    redirect('/login?redirect=/estimate')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, plan, trial_ends_at, stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile || !hasAccess(profile)) {
    redirect('/upgrade')
  }

  const onTrial = isTrialActive(profile) && profile.plan !== 'pro'
  const daysLeft = trialDaysRemaining(profile)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/estimate" className="font-semibold text-sm">
            Stayful Intelligence
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {onTrial ? (
              <span className="hidden sm:inline text-muted-foreground">
                {daysLeft} day{daysLeft === 1 ? '' : 's'} left in trial
              </span>
            ) : null}
            {onTrial ? (
              <Link
                href="/upgrade"
                className="hidden sm:inline-flex h-8 items-center rounded-md bg-primary px-3 text-primary-foreground text-xs font-medium hover:bg-primary/90"
              >
                Upgrade
              </Link>
            ) : null}
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
