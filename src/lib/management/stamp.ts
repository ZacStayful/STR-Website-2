/**
 * Batch 22f: management companies — the one mark on the account.
 *
 * A management company's own ad always points at MC_PATH. An account whose
 * first touch (Batch 19, src/lib/tracking/touch.ts → member_attribution.
 * landing_path) is that page is stamped at creation: profiles.signup_path =
 * 'management'. So is anyone who presses Start on that page, or chooses the
 * branded lead form from the quiz or from Account (all three go through
 * START_PATH). Every rule reads the stamp, never the URL or
 * a cookie again.
 *
 * What the stamp changes, while deal-finding is off (the three mandatory
 * profile questions not yet answered):
 *   - no quiz and no signup reveal in front of app pages (AppShell);
 *   - sign-in lands on Leads, not Home (src/lib/auth/landing.ts);
 *   - daily picks written off at stamping;
 *   - no Stayful Intelligence intro or low-credit call (voice/eligibility).
 * Answering the three questions from the Profile pill switches deal-finding
 * on, and the normal rules apply from then on.
 *
 * Pure: no network, no database, no server-only.
 */
import type { Touch } from '../tracking/touch.ts';

/** The page a management company's ad points at. */
export const MC_PATH = '/for-management-companies';
/**
 * The way in from the page's Start, the quiz and Account: stamps the
 * signed-in account (signing up first if need be), then sends it to the
 * setup. ?via=quiz | account says which.
 */
export const START_PATH = '/for-management-companies/start';
/** The setup a stamped account is sent to. */
export const SETUP_PATH = '/leads/setup';
/** Where a stamped account without deal-finding lands after signing in. */
export const MC_LANDING_PATH = '/leads';

export const MANAGEMENT = 'management' as const;
export type StampVia = 'first_touch' | 'start' | 'quiz' | 'account';

export function isManagement(signupPath: unknown): boolean {
  return signupPath === MANAGEMENT;
}

/** The first touch was the management-company page. */
export function isManagementTouch(touch: Pick<Touch, 'lp'> | null | undefined): boolean {
  if (!touch?.lp) return false;
  const lp = touch.lp.replace(/\/+$/, '');
  return lp === MC_PATH;
}

/** Deal-finding is on once the three mandatory profile questions are answered. */
export function dealFindingOn(mandatoryDone: boolean): boolean {
  return mandatoryDone;
}

/**
 * A stamped account that has not switched deal-finding on: the quiz and the
 * reveal stay out of its way, it lands on Leads, and nothing calls it about
 * investor deals.
 */
export function managementOnly(o: { signupPath: unknown; mandatoryDone: boolean }): boolean {
  return isManagement(o.signupPath) && !dealFindingOn(o.mandatoryDone);
}

/**
 * AppShell's two gates. `gate` is what the shell would do for anyone; a
 * management-only account gets 'none' instead of the quiz or the reveal.
 * A team member is never gated anyway.
 */
export function shellGate(o: { signupPath: unknown; mandatoryDone: boolean; teamMember: boolean; revealPending: boolean }): 'quiz' | 'reveal' | 'none' {
  if (o.teamMember) return 'none';
  if (managementOnly(o)) return 'none';
  if (!o.mandatoryDone) return 'quiz';
  return o.revealPending ? 'reveal' : 'none';
}
