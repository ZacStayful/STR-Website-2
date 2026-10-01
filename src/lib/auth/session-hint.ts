/**
 * Whether this browser is probably signed in, from its cookies alone.
 *
 * The marketing header is a client component on static pages, so it cannot
 * ask Supabase who is looking. Supabase's session cookie is readable from the
 * page (`sb-<project>-auth-token`, chunked `.0`, `.1`… when long), so the
 * header can at least stop offering "Sign in" and "Start free trial" to a
 * member: the proxy would only bounce both to Today. A hint, never an
 * authority: every members-only page still checks the session itself.
 */
const SESSION_COOKIE = /(?:^|;\s*)sb-[a-z0-9-]+-auth-token(?:\.\d+)?=/i

export function hasSessionCookie(cookie: string | null | undefined): boolean {
  return typeof cookie === 'string' && SESSION_COOKIE.test(cookie)
}
