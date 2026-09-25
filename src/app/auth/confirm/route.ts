import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/safe-path'
import { runSignInHooks } from '@/lib/auth/sign-in-hooks'

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
  const next = safeInternalPath(searchParams.get('next'), '/deals')
  const loginUrl = (reason: string) => `${origin}/login?error=${encodeURIComponent(reason)}&redirect=${encodeURIComponent(next)}`

  if (!tokenHash || !type || !TYPES.has(type)) return NextResponse.redirect(loginUrl('missing_token'))

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash })
  if (error) {
    // Used or expired link, but the member may already be signed in from the
    // first click (the same link is in the email and the WhatsApp message).
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) return NextResponse.redirect(`${origin}${next}`)
    return NextResponse.redirect(loginUrl('link_expired'))
  }

  await runSignInHooks(supabase)
  return NextResponse.redirect(`${origin}${next}`)
}
