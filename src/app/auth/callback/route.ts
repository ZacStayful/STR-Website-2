import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/safe-path'
import { runSignInHooks } from '@/lib/auth/sign-in-hooks'

// Handles both OAuth (Google) callback and PKCE email links (confirmation,
// password reset, "email me a sign-in link"). Token-hash links, which need no
// PKCE verifier cookie, land on /auth/confirm instead.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  // Guarded here — the sink — so every producer of ?next= is covered.
  const next = safeInternalPath(searchParams.get('next'), '/estimate')
  const error = searchParams.get('error_description') || searchParams.get('error')
  const loginUrl = (reason: string) => `${origin}/login?error=${encodeURIComponent(reason)}&redirect=${encodeURIComponent(next)}`

  if (error) return NextResponse.redirect(loginUrl(error))
  if (!code) return NextResponse.redirect(loginUrl('missing_code'))

  const supabase = await createSupabaseServerClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) return NextResponse.redirect(loginUrl(exchangeError.message))

  await runSignInHooks(supabase)
  return NextResponse.redirect(`${origin}${next}`)
}
