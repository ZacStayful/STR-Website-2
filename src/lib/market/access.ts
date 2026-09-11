/**
 * Market Explorer access state — the single rule the /markets layout applies.
 *
 *   anon    → no signed-in user: show the public product page (no data)
 *   blocked → signed in but no access (free runs used up, lapsed subscriber,
 *             or missing profile): send to /upgrade
 *   ok      → admin, Pro, or a trial user with free runs left: render the explorer
 *
 * Deliberately a pure function of (user, profile) so it is unit-testable and
 * can never touch reports_run — viewing the explorer must not consume a free run.
 */

import { hasAccess, type AccessProfile } from '../access.ts';
import { isAdminEmail } from '../admin.ts';

export type MarketAccessState = 'anon' | 'blocked' | 'ok';

/**
 * Whatever the caller selected. Deliberately the tolerant shape rather than a
 * required Pick: rows come back from an untyped Supabase client, and a route
 * that legitimately selects a few extra columns should not have to restate
 * every access column to type-check. Select ACCESS_COLUMNS and the runtime
 * answer is right; accountStatus copes with anything missing.
 */
export type MarketAccessProfile = AccessProfile;

export function marketAccessState(
  user: { email?: string | null } | null | undefined,
  profile: MarketAccessProfile | null | undefined,
  now: number = Date.now(),
): MarketAccessState {
  if (!user) return 'anon';
  if (isAdminEmail(user.email)) return 'ok';
  if (!profile) return 'blocked';
  return hasAccess(profile, now) ? 'ok' : 'blocked';
}
