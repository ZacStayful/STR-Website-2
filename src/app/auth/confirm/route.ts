import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/safe-path'
import { runSignInHooks } from '@/lib/auth/sign-in-hooks'
import { postAuthPath } from '@/lib/auth/landing'
import { isManagementOnly } from '@/lib/management/stamp-server'
import { onSignIn } from '@/lib/tracking/signup-server'

// Signs a member in from a token-hash link:
//   /auth/confirm?token_hash=…&type=magiclink&next=/deals
// The lead-form welcome email and WhatsApp message carry this link (built by
// /api/internal/leads/provision from generateLink's hashed_token). Unlike the
// PKCE flow on /auth/callback it needs no verifier cookie, so the link works
// on whichever device it is opened on. The token is single-use and expires
// after the project's email OTP expiry; a second click by a member who is
// already signed in still lands them in the app.
const TYPES: ReadonlySet<string> = new Set(['magiclink', 'recovery', 'signup', 'email', 'invite'])

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // An absent destination means the landing rule decides (src/lib/auth/landing.ts).
  const next = safeInternalPath(searchParams.get('next'), '')
  const loginUrl = (reason: string) => `${origin}/login?error=${encodeURIComponent(reason)}${next ? `&redirect=${encodeURIComponent(next)}` : ''}`

  if (!tokenHash || !type || !TYPES.has(type)) return NextResponse.redirect(loginUrl('missing_token'))

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash })
  if (error) {
    // Used or expired link, but the member may already be signed in from the
    // first click (the same link is in the email and the WhatsApp message).
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) return NextResponse.redirect(`${origin}${postAuthPath(next, { management: await isManagementOnly(user.id) })}`)
    return NextResponse.redirect(loginUrl('link_expired'))
  }

  await runSignInHooks(supabase)
  // Batch 19: this device's cookie choice becomes the member's.
  if (data.user) await onSignIn({ user: data.user, carried: null, next })
  // Batch 22f: a management company without deal-finding lands on Leads.
  const management = data.user ? await isManagementOnly(data.user.id) : false
  return NextResponse.redirect(`${origin}${postAuthPath(next, { management })}`)
}
