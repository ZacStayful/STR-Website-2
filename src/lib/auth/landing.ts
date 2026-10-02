/**
 * Where a member goes once they are signed in.
 *
 * Every route that signs someone in — password login, Google and email links
 * on /auth/callback, token links on /auth/confirm, and the proxy's "already
 * signed in" bounce off /login and /signup — ends by asking this one
 * function, so the rule lives in one place: the member goes where they were
 * going, or to Home (Batch 22e; it was Today before).
 *
 * The profile quiz (Batch 12) is no longer a stop on the way in: its first
 * three questions gate every members-only page instead (AppShell →
 * src/lib/profile/server.ts requireProfileStart), so a member who has not
 * answered them is sent to /welcome from whatever page they reach, with that
 * page as the way back, and one who has is never interrupted.
 *
 * Two flows are never interrupted at all: accepting a team invite (the join
 * page is where the invite token is, and the owner's settings apply) and a
 * password reset (the recovery session has to reach the reset form).
 *
 * Pure, so the routing is tested rather than trusted.
 */
import { safeInternalPath } from '../safe-path.ts';

/** Where a signed-in member lands with nowhere else to go: Home (Batch 22e). */
export const HOME_PATH = '/home';
/** The profile quiz. */
export const WELCOME_PATH = '/welcome';

/** Destinations the quiz must never sit in front of. */
export function bypassesWelcome(path: string): boolean {
  return path.startsWith('/team/join') || path === '/reset-password' || path.startsWith('/reset-password?');
}

/** A return target that would only send the member round in a circle. */
function isAuthPath(path: string): boolean {
  return /^\/(welcome|login|signup)(\/|\?|$)/.test(path);
}

/**
 * Batch 22f: where a management company lands with nowhere else to go, until
 * it switches deal-finding on (src/lib/management/stamp.ts). Everyone else
 * keeps HOME_PATH.
 */
export const MANAGEMENT_HOME_PATH = '/leads';

/**
 * The path to redirect to after a successful sign-in or sign-up. `next` is
 * the raw, untrusted "return to" value (?next= / ?redirect=), or nothing.
 * `management`: the account is a management company without deal-finding
 * (the caller reads the stamp; this stays pure).
 */
export function postAuthPath(next: string | null | undefined, opts: { management?: boolean } = {}): string {
  const home = opts.management ? MANAGEMENT_HOME_PATH : HOME_PATH;
  const wanted = safeInternalPath(next, '');
  if (!wanted) return home;
  if (bypassesWelcome(wanted)) return wanted;
  if (isAuthPath(wanted)) return home;
  return wanted;
}

/** Where /welcome sends the member on: their original destination, else home. */
export function welcomeReturnPath(next: string | null | undefined): string {
  const wanted = safeInternalPath(next, HOME_PATH);
  return isAuthPath(wanted) ? HOME_PATH : wanted;
}

/** The quiz, with the way back: `/welcome?next=<page>`. */
export function quizPathFor(returnTo: string | null | undefined): string {
  const wanted = safeInternalPath(returnTo, '');
  if (!wanted || isAuthPath(wanted) || bypassesWelcome(wanted)) return WELCOME_PATH;
  return `${WELCOME_PATH}?next=${encodeURIComponent(wanted)}`;
}
