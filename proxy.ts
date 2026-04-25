import { NextResponse, type NextRequest } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/proxy'

const PROTECTED_PREFIXES = ['/estimate', '/dashboard', '/account', '/upgrade']
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
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute(pathname) && user) {
    return NextResponse.redirect(new URL('/estimate', request.url))
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
