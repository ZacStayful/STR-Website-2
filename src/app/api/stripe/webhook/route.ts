import { NextResponse, type NextRequest } from 'next/server'
import Stripe from 'stripe'
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role'
import { markCustomer, markTrialExpired } from '@/lib/monday/enquiries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = new Set(['active', 'trialing'])

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key)
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 })
  }

  const payload = await request.text()
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid signature'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (
    event.type !== 'customer.subscription.created' &&
    event.type !== 'customer.subscription.updated' &&
    event.type !== 'customer.subscription.deleted'
  ) {
    return NextResponse.json({ received: true })
  }

  const subscription = event.data.object as Stripe.Subscription
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id

  const supabase = createSupabaseServiceRoleClient()

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, monday_item_id, plan')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (profileError) {
    console.error('[stripe/webhook] profile lookup failed:', profileError)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  if (!profile) {
    // No matching user yet — checkout session completed handler should have
    // backfilled stripe_customer_id; if not, we just ack the event.
    return NextResponse.json({ received: true, note: 'no profile' })
  }

  const becameActive = ACTIVE_STATUSES.has(subscription.status)
  const becameInactive =
    event.type === 'customer.subscription.deleted' || !becameActive

  await supabase
    .from('profiles')
    .update({
      stripe_subscription_id: subscription.id,
      stripe_subscription_status: subscription.status,
      plan: becameActive ? 'pro' : 'free',
    })
    .eq('id', profile.id)

  if (profile.monday_item_id) {
    try {
      if (becameActive) {
        await markCustomer(profile.monday_item_id)
      } else if (becameInactive && event.type === 'customer.subscription.deleted') {
        await markTrialExpired(profile.monday_item_id)
      }
    } catch (err) {
      console.error('[stripe/webhook] monday status sync failed:', err)
    }
  }

  return NextResponse.json({ received: true })
}
