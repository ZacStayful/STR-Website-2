import { NextResponse, type NextRequest } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/proxy'
import { postAuthPath } from '@/lib/auth/landing'

const PROTECTED_PREFIXES = ['/welcome', '/today', '/my-deals', '/estimate', '/reports', '/picks', '/deals', '/leads', '/dashboard', '/account', '/upgrade', '/admin', '/extension/connect']
const AUTH_ROUTES = ['/login', '/signup']

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.includes(pathname)
}

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

export async function proxy(request: NextRequest) {
  // Short-circuit when Supabase isn't configured yet — lets the existing
  // analyser render in environments where env vars haven't been set.
  if (!isSupabaseConfigured()) {
    return NextResponse.next()
  }

  const { response, user } = await updateSupabaseSession(request)
  const { pathname } = request.nextUrl

  if (isProtected(pathname) && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute(pathname) && user) {
    // Already signed in: keep the destination the page was carrying
    // (/login?redirect=…, /signup?next=…) and apply the landing rule to it,
    // so an invitee who is already logged in still reaches the join page.
    const wanted = request.nextUrl.searchParams.get('redirect') ?? request.nextUrl.searchParams.get('next')
    return NextResponse.redirect(new URL(postAuthPath(wanted), request.url))
  }

  // /signup?ref=CODE → remembered for 30 days so the referral is credited
  // once the account is confirmed (src/lib/credit/welcome.ts).
  const ref = request.nextUrl.searchParams.get('ref')
  if (pathname === '/signup' && ref && /^[A-Z0-9]{4,20}$/i.test(ref)) {
    response.cookies.set('sf_ref', ref.toUpperCase(), { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax', httpOnly: true })
  }

  return response
}

export const config = {
  // Run on everything except static assets, image optimisation, and the
  // analyser SSE endpoint (which we'll guard at the route level instead).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf)$).*)',
  ],
}
