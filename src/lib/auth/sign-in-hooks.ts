import 'server-only'

import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin'
import { ensureEnquiry } from '@/lib/apis/monday'
import { isTeamBound } from '@/lib/team'

// Runs once a member has a session, from whichever route signed them in:
// /auth/callback (OAuth and PKCE email links) and /auth/confirm (token-hash
// links from the lead-form welcome email and WhatsApp message).
//
// 1. Lead activation: a member provisioned from a lead form has just signed
//    in for the first time. Stamp it and tell the ad platform (via n8n) that
//    the lead became a member, so its optimisation learns which leads are
//    worth buying. Idempotent on profiles.lead_activated_at.
// 2. Monday: push a "Trial signups" row the first time a verified user lands.
//    Idempotent on profiles.monday_item_id.
//
// Errors are swallowed so a Monday or n8n outage can never block the redirect.
export async function runSignInHooks(supabase: SupabaseClient): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name, mobile, trial_ends_at, monday_item_id, lead_source, lead_activated_at')
      .eq('id', user.id)
      .single()
    if (!profile) return

    if (profile.lead_source && !profile.lead_activated_at && hasServiceRole()) {
      const activatedAt = new Date().toISOString()
      const source = profile.lead_source as Record<string, unknown>
      const userId = user.id
      const email = profile.email ?? user.email ?? ''
      after(async () => {
        try {
          const admin = createAdminClient()
          const { data: stamped } = await admin.from('profiles').update({ lead_activated_at: activatedAt }).eq('id', userId).is('lead_activated_at', null).select('id')
          if (!stamped || stamped.length === 0) return // already stamped by a concurrent request
          const hook = process.env.LEAD_ACTIVATION_WEBHOOK_URL
          if (!hook) return
          await fetch(hook, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(process.env.INTERNAL_API_SECRET ? { 'x-internal-secret': process.env.INTERNAL_API_SECRET } : {}) },
            body: JSON.stringify({ event: 'lead_activated', userId, email, source: source.source ?? null, leadId: source.leadId ?? null, activatedAt }),
          })
        } catch (err) {
          console.warn('[auth] lead activation hook failed:', (err as Error)?.message ?? err)
        }
      })
    }

    // Team members (and people on their way to becoming one) are paid for by
    // their team: not trial signups for the sales board.
    if (!profile.monday_item_id && !(await isTeamBound(user.id, profile.email ?? user.email ?? null))) {
      const mondayId = await ensureEnquiry({
        name: profile.full_name ?? '',
        email: profile.email ?? user.email ?? '',
        mobile: profile.mobile ?? '',
        trialStartedAt: new Date().toISOString(),
      })
      if (mondayId) {
        await supabase.from('profiles').update({ monday_item_id: mondayId }).eq('id', user.id)
      }
    }
  } catch (err) {
    console.error('[auth] sign-in hooks failed:', err)
  }
}
