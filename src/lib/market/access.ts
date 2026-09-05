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

import { hasAccess, type Profile } from '../access.ts';
import { isAdminEmail } from '../admin.ts';

export type MarketAccessState = 'anon' | 'blocked' | 'ok';

export type MarketAccessProfile = Pick<Profile, 'plan' | 'reports_run' | 'stripe_subscription_id'>;

export function marketAccessState(
  user: { email?: string | null } | null | undefined,
  profile: MarketAccessProfile | null | undefined,
): MarketAccessState {
  if (!user) return 'anon';
  if (isAdminEmail(user.email)) return 'ok';
  if (!profile) return 'blocked';
  return hasAccess(profile) ? 'ok' : 'blocked';
}
