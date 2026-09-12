'use server'

import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/client'
import {
  PAUSED_FROM_KEY,
  formatPlanDate,
  isPauseMonths,
  pauseWindow,
  subscriptionStateFromStripe,
} from '@/lib/subscription'
import { isPauseScheduled, isPaused } from '@/lib/access'
import { cancelScheduledEmail, pauseBookedEmail } from '@/lib/email/billing-emails'
import { isEmailConfigured, sendEmail } from '@/lib/email/send'
import { BRAND } from '@/lib/brand'
import { CANCEL_REASONS, type BillingState, type CancelReason } from './plan-view'
import type Stripe from 'stripe'

const REASON_SLUGS: Set<string> = new Set(CANCEL_REASONS.map((r) => r.slug))

const SIGN_IN_AGAIN = 'Your session has expired. Please sign in again.'
const UNAVAILABLE = "We couldn't reach our payment provider. Please try again in a moment."
const MANAGED_BY_US = `Your subscription was set up by our team, so it can't be changed here. Email ${BRAND.contactEmail} and we'll sort it out the same day.`

interface Context {
  userId: string
  email: string | null
  subscriptionId: string
  customerId: string | null
  profile: Record<string, unknown>
  stripe: Stripe
}

/**
 * Auth, ownership and configuration for every billing action.
 *
 * The subscription id is read from the profile row keyed by the signed-in
 * user, and only from there. No action takes an id, customer or price from the
 * form, so there is nothing for a caller to tamper with.
 */
async function billingContext(): Promise<{ ok: true; ctx: Context } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: SIGN_IN_AGAIN }

  // Read with the member's own client so RLS scopes it to their row.
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'email, plan, plan_source, stripe_customer_id, stripe_subscription_id, subscription_paused_from, subscription_paused_until, subscription_cancel_at',
    )
    .eq('id', user.id)
    .single()

  if (!profile) return { ok: false, error: SIGN_IN_AGAIN }

  const subscriptionId = profile.stripe_subscription_id as string | null
  // Subscriptions arranged by hand have no Stripe record we can drive. Give
  // them a route to a human rather than a button that throws.
  if (!subscriptionId) return { ok: false, error: MANAGED_BY_US }
  if (!stripeConfigured()) return { ok: false, error: UNAVAILABLE }

  return {
    ok: true,
    ctx: {
      userId: user.id,
      email: (profile.email as string | null) ?? user.email ?? null,
      subscriptionId,
      customerId: (profile.stripe_customer_id as string | null) ?? null,
      profile,
      stripe: getStripe(),
    },
  }
}

/**
 * Fetch the subscription and re-check it belongs to this member.
 *
 * The id already came from their own row, so this is belt and braces against a
 * mis-linked profile rather than against a hostile caller.
 */
async function ownedSubscription(ctx: Context): Promise<Stripe.Subscription | null> {
  const sub = await ctx.stripe.subscriptions.retrieve(ctx.subscriptionId)
  if (ctx.customerId) {
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
    if (customer && customer !== ctx.customerId) {
      console.error(
        `[account] subscription ${ctx.subscriptionId} belongs to ${customer}, not ${ctx.customerId}`,
      )
      return null
    }
  }
  return sub
}

/**
 * Persist billing columns with the service-role client.
 *
 * Two reasons this cannot use the member's session: the billing columns are no
 * longer granted to `authenticated` (see supabase/schema.sql), and /account has
 * to be correct on the very next render rather than whenever the webhook lands.
 */
async function writeProfile(userId: string, values: Record<string, unknown>): Promise<boolean> {
  const { error } = await createAdminClient().from('profiles').update(values).eq('id', userId)
  if (error) {
    console.error('[account] profile write failed:', error.message)
    return false
  }
  return true
}

function failed(where: string, err: unknown): BillingState {
  // Stripe messages carry ids and internal detail, so they are logged, never
  // shown.
  console.error(`[account] ${where} failed:`, err)
  return { error: UNAVAILABLE, success: null }
}

// ---------------------------------------------------------------
// Pause
// ---------------------------------------------------------------

export async function pauseSubscriptionAction(
  _prev: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const months = formData.get('months')
  if (!isPauseMonths(months)) {
    return { error: 'Choose 1, 2 or 3 months.', success: null }
  }

  const got = await billingContext()
  if (!got.ok) return { error: got.error, success: null }
  const { ctx } = got

  if (isPaused(ctx.profile) || isPauseScheduled(ctx.profile)) {
    return { error: 'Your plan is already paused.', success: null }
  }

  try {
    const sub = await ownedSubscription(ctx)
    if (!sub) return { error: UNAVAILABLE, success: null }

    const window = pauseWindow(sub, Number(months) as 1 | 2 | 3)
    if (!window) {
      // No period end means we cannot honour "you keep what you paid for".
      return {
        error: `We couldn't work out your renewal date. Email ${BRAND.contactEmail} and we'll pause it for you.`,
        success: null,
      }
    }

    const updated = await ctx.stripe.subscriptions.update(ctx.subscriptionId, {
      pause_collection: {
        behavior: 'void',
        resumes_at: Math.floor(window.until.getTime() / 1000),
      },
      // Stripe has no concept of a pause that starts later, so the start of our
      // window rides along on the subscription. The webhook reads it back,
      // which is what keeps a replayed event idempotent.
      metadata: { ...(sub.metadata ?? {}), [PAUSED_FROM_KEY]: window.from.toISOString() },
    })

    const state = subscriptionStateFromStripe(updated)
    const ok = await writeProfile(ctx.userId, {
      subscription_paused_from: window.from.toISOString(),
      subscription_paused_until: window.until.toISOString(),
      subscription_current_period_end: state.currentPeriodEnd,
      stripe_subscription_status: state.status,
    })
    if (!ok) return { error: UNAVAILABLE, success: null }

    const from = formatPlanDate(window.from.toISOString())
    const until = formatPlanDate(window.until.toISOString())
    queueEmail(ctx.email, () => pauseBookedEmail({ from, until }))

    revalidatePath('/account')
    return {
      error: null,
      success: `Your plan pauses on ${from} and restarts on ${until}.`,
    }
  } catch (err) {
    return failed('pause', err)
  }
}

export async function resumeSubscriptionAction(): Promise<BillingState> {
  const got = await billingContext()
  if (!got.ok) return { error: got.error, success: null }
  const { ctx } = got

  try {
    const sub = await ownedSubscription(ctx)
    if (!sub) return { error: UNAVAILABLE, success: null }

    const metadata = { ...(sub.metadata ?? {}) }
    metadata[PAUSED_FROM_KEY] = ''

    const updated = await ctx.stripe.subscriptions.update(ctx.subscriptionId, {
      // Stripe's Emptyable sentinel is the empty string. `null` does not
      // type-check here and does not clear the field.
      pause_collection: '',
      metadata,
    })

    const state = subscriptionStateFromStripe(updated)
    const ok = await writeProfile(ctx.userId, {
      subscription_paused_from: null,
      subscription_paused_until: null,
      subscription_current_period_end: state.currentPeriodEnd,
      stripe_subscription_status: state.status,
      plan: state.active ? 'pro' : 'free',
    })
    if (!ok) return { error: UNAVAILABLE, success: null }

    revalidatePath('/account')
    revalidatePath('/upgrade')
    return { error: null, success: 'Your plan is active again.' }
  } catch (err) {
    return failed('resume', err)
  }
}

// ---------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------

export async function cancelSubscriptionAction(
  _prev: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const reason = String(formData.get('reason') ?? '')
  const comment = String(formData.get('comment') ?? '').trim().slice(0, 500)

  const got = await billingContext()
  if (!got.ok) return { error: got.error, success: null }
  const { ctx } = got

  try {
    const sub = await ownedSubscription(ctx)
    if (!sub) return { error: UNAVAILABLE, success: null }

    // True for a pause that is running AND one merely booked for later: both
    // set pause_collection. Either way, leaving makes the pause moot.
    const paused = !!sub.pause_collection
    const metadata = { ...(sub.metadata ?? {}) }
    if (paused) metadata[PAUSED_FROM_KEY] = ''

    const updated = await ctx.stripe.subscriptions.update(ctx.subscriptionId, {
      cancel_at_period_end: true,
      // Cancelling while paused lifts the pause, so cancel_at lands on a real
      // period end and the member gets the paid time they are owed.
      ...(paused ? { pause_collection: '' as const, metadata } : {}),
    })

    const state = subscriptionStateFromStripe(updated)
    const ok = await writeProfile(ctx.userId, {
      subscription_cancel_at: state.cancelAt,
      subscription_current_period_end: state.currentPeriodEnd,
      subscription_paused_from: state.pausedFrom,
      subscription_paused_until: state.pausedUntil,
      stripe_subscription_status: state.status,
      cancel_reason: REASON_SLUGS.has(reason) ? (reason as CancelReason) : null,
      cancel_reason_comment: comment || null,
      cancel_reason_at: new Date().toISOString(),
    })
    if (!ok) return { error: UNAVAILABLE, success: null }

    const endsOn = formatPlanDate(state.cancelAt ?? state.currentPeriodEnd)
    queueEmail(ctx.email, () => cancelScheduledEmail({ endsOn }))

    revalidatePath('/account')
    return {
      error: null,
      success: endsOn
        ? `Your plan will end on ${endsOn}. You keep full access until then.`
        : 'Your plan will end at the end of this billing period.',
    }
  } catch (err) {
    return failed('cancel', err)
  }
}

/** Undo a scheduled cancellation. */
export async function keepSubscriptionAction(): Promise<BillingState> {
  const got = await billingContext()
  if (!got.ok) return { error: got.error, success: null }
  const { ctx } = got

  try {
    const sub = await ownedSubscription(ctx)
    if (!sub) return { error: UNAVAILABLE, success: null }

    const updated = await ctx.stripe.subscriptions.update(ctx.subscriptionId, {
      cancel_at_period_end: false,
    })

    const state = subscriptionStateFromStripe(updated)
    const ok = await writeProfile(ctx.userId, {
      subscription_cancel_at: state.cancelAt,
      subscription_current_period_end: state.currentPeriodEnd,
      stripe_subscription_status: state.status,
      cancel_reason: null,
      cancel_reason_comment: null,
      cancel_reason_at: null,
    })
    if (!ok) return { error: UNAVAILABLE, success: null }

    revalidatePath('/account')
    return { error: null, success: 'Your plan will carry on as normal.' }
  } catch (err) {
    return failed('keep', err)
  }
}

/**
 * Resume from the paywall at /upgrade.
 *
 * A plain <form action> in a server component must resolve to void, so this
 * wraps the real action and navigates instead of returning state. Success
 * lands them back in the analyser; a failure lands on /account, which has the
 * same button plus a route to a human, and says what went wrong.
 */
export async function resumeFromUpgradeAction(): Promise<void> {
  const result = await resumeSubscriptionAction()
  redirect(result.error ? '/account?resume=failed' : '/estimate')
}

/** Cancel a pause that has been booked but has not started yet. */
export async function cancelPauseAction(): Promise<BillingState> {
  const result = await resumeSubscriptionAction()
  return result.error ? result : { error: null, success: 'Your pause has been called off.' }
}

/**
 * Send after the response, and never let a failed send break a billing change:
 * sendEmail already swallows its own errors, and this swallows the rest.
 */
function queueEmail(
  to: string | null,
  build: () => { subject: string; html: string; text: string },
): void {
  if (!to || !isEmailConfigured()) return
  after(async () => {
    try {
      await sendEmail({ to, ...build() })
    } catch (err) {
      console.error('[account] billing email failed:', err)
    }
  })
}
