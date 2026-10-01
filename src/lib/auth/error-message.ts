/**
 * What a member reads when Supabase Auth itself fails.
 *
 * Supabase's own messages are right for the member's mistakes ("Invalid login
 * credentials", "User already registered") and wrong for an outage: a sign-in
 * during a blip read "fetch failed" or "Database error saving new user", which
 * tells them to check a password that was fine. Anything that looks like the
 * service, not the member, gets one sentence instead.
 *
 * Pure, so the mapping is tested.
 */

export const AUTH_SERVICE_DOWN = "We couldn't reach our sign-in service. Please try again in a minute."

/** A Supabase AuthError, or anything shaped like one. */
export interface AuthFailure {
  message: string
  status?: number | null
  code?: string | null
}

const SERVICE_FAULT = /fetch failed|network|timeout|timed out|ECONNRESET|ECONNREFUSED|socket hang up|database error|unexpected_failure|internal server error|service unavailable|bad gateway|gateway timeout/i

/** True when the failure is the service's, not the member's. */
export function isAuthServiceFault(error: AuthFailure | null | undefined): boolean {
  if (!error) return false
  if (typeof error.status === 'number' && error.status >= 500) return true
  if (error.code === 'unexpected_failure') return true
  return SERVICE_FAULT.test(error.message ?? '')
}

/** The sentence to show: ours for a service fault, Supabase's otherwise. */
export function authErrorMessage(error: AuthFailure | null | undefined): string {
  if (!error) return AUTH_SERVICE_DOWN
  return isAuthServiceFault(error) ? AUTH_SERVICE_DOWN : error.message
}
