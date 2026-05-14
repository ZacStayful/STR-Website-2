import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createTrialSignup, markEmailVerified } from '@/lib/monday/trial'

// Handles both OAuth (Google) callback and email-confirmation links.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/estimate'
  const error = searchParams.get('error_description') || searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createSupabaseServerClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
    )
  }

  // First-confirmation hook: push a new row to Monday board 18413002067
  // the first time a verified user lands here. Idempotent — the helper
  // checks profiles.monday_item_id. Always flip Email Verified on confirm
  // (covers reconfirmations from a different device too). Errors are
  // swallowed inside the helpers so a Monday outage can't block the
  // redirect to /estimate.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name, mobile, trial_ends_at, monday_item_id')
        .eq('id', user.id)
        .single()
      if (profile && !profile.monday_item_id) {
        const mondayId = await createTrialSignup({
          email: profile.email ?? user.email ?? '',
          fullName: profile.full_name ?? '',
          mobile: profile.mobile ?? '',
          signupAt: new Date().toISOString(),
          trialEndsAt: profile.trial_ends_at,
        })
        if (mondayId) {
          await supabase
            .from('profiles')
            .update({ monday_item_id: mondayId })
            .eq('id', user.id)
          await markEmailVerified(mondayId)
        }
      } else if (profile?.monday_item_id) {
        await markEmailVerified(profile.monday_item_id)
      }
    }
  } catch (err) {
    console.error('[auth/callback] Monday trial signup hook failed:', err)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
