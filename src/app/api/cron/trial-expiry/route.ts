import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role'
import { markTrialExpired } from '@/lib/monday/enquiries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Daily cron — finds profiles whose trial has elapsed and who haven't
// converted to a paid plan, then flips their Monday enquiry item to
// "Free Trial Expired". Idempotent: profiles.trial_expired_synced acts
// as a guard so we don't re-flip on every run.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? ''
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServiceRoleClient()

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, monday_item_id, trial_ends_at, stripe_subscription_status, plan')
    .lt('trial_ends_at', new Date().toISOString())
    .eq('trial_expired_synced', false)
    .neq('plan', 'pro')
    .not('monday_item_id', 'is', null)

  if (error) {
    console.error('[cron/trial-expiry] profile query failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates = (profiles ?? []).filter(
    (p) => !['active', 'trialing'].includes(p.stripe_subscription_status ?? '')
  )

  let synced = 0
  const failures: Array<{ id: string; message: string }> = []

  for (const profile of candidates) {
    if (!profile.monday_item_id) continue
    try {
      await markTrialExpired(profile.monday_item_id)
      await supabase
        .from('profiles')
        .update({ trial_expired_synced: true })
        .eq('id', profile.id)
      synced++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[cron/trial-expiry] markTrialExpired failed:', profile.id, message)
      failures.push({ id: profile.id, message })
    }
  }

  return NextResponse.json({ scanned: candidates.length, synced, failures })
}
