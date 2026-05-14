import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAccess, isPro, trialDaysRemaining, type Profile } from '@/lib/access'

export const metadata = { title: 'Upgrade · Stayful Intelligence' }

export default async function UpgradePage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/upgrade')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, plan, trial_ends_at, stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
    .eq('id', user.id)
    .single<Profile>()

  if (profile && isPro(profile)) {
    redirect('/estimate')
  }

  const onTrial = profile ? hasAccess(profile) : false
  const daysLeft = profile ? trialDaysRemaining(profile) : 0

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">
          {onTrial ? `${daysLeft} days left in your trial` : 'Your free trial has ended'}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {onTrial
            ? 'Upgrade now to lock in unlimited analyses after your trial.'
            : 'Subscribe to Stayful Intelligence Pro to keep running analyses.'}
        </p>

        <div className="mt-6 rounded-xl border border-border p-6">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold">£49</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>· Unlimited property analyses</li>
            <li>· Full Airbnb + long-let comparables</li>
            <li>· Risk-scored verdicts and downloadable reports</li>
            <li>· Cancel anytime</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {/* TODO: wire Stripe Checkout. For now, contact link. */}
          <a
            href="mailto:zac@stayful.co.uk?subject=Stayful%20Intelligence%20Pro"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-primary-foreground font-medium hover:bg-primary/90"
          >
            Get in touch to upgrade
          </a>
          <Link
            href="/"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
