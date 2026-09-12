/**
 * Members-only surface access — the single rule the /markets, /estimate and
 * /reports layouts and the extension apply.
 *
 *   anon    → no signed-in user: show the public product page (no data)
 *   blocked → signed in but the profile row is missing (sign-up did not
 *             finish): send to /upgrade, which explains and links to support
 *   ok      → any member (admin, subscriber or pay-as-you-go): render the app;
 *             paid actions are charged to their credit balance individually
 *
 * Deliberately a pure function of (user, profile) so it is unit-testable.
 */

import type { Profile } from '../access.ts';
import { isAdminEmail } from '../admin.ts';

export type MarketAccessState = 'anon' | 'blocked' | 'ok';

export type MarketAccessProfile = Partial<Pick<Profile, 'plan_code'>> & { id?: string };

export function marketAccessState(
  user: { email?: string | null } | null | undefined,
  profile: MarketAccessProfile | null | undefined,
): MarketAccessState {
  if (!user) return 'anon';
  if (isAdminEmail(user.email)) return 'ok';
  if (!profile) return 'blocked';
  return 'ok';
}
