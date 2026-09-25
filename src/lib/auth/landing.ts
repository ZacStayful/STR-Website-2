/**
 * Where a member goes once they are signed in.
 *
 * Every route that signs someone in — password login, Google and email links
 * on /auth/callback, token links on /auth/confirm, and the proxy's "already
 * signed in" bounce off /login and /signup — ends by asking this one
 * function, so the rule lives in one place: a member answers the welcome
 * questions before anything else, and /welcome itself sends anyone who has
 * already answered (or skipped enough times) on to where they were going,
 * or to the deals grid.
 *
 * Two flows are never interrupted: accepting a team invite (the join page is
 * where the invite token is, and the owner's settings apply) and a password
 * reset (the recovery session has to reach the reset form).
 *
 * Pure, so the routing is tested rather than trusted.
 */
import { safeInternalPath } from '../safe-path.ts';

/** Where a member who has answered (or skipped) the welcome questions lands. */
export const HOME_PATH = '/deals';
export const WELCOME_PATH = '/welcome';

/** Destinations the welcome screen must never sit in front of. */
function bypassesWelcome(path: string): boolean {
  return path.startsWith('/team/join') || path === '/reset-password' || path.startsWith('/reset-password?');
}

/** A return target that would only send the member round in a circle. */
function isAuthPath(path: string): boolean {
  return /^\/(welcome|login|signup)(\/|\?|$)/.test(path);
}

/**
 * The path to redirect to after a successful sign-in or sign-up. `next` is
 * the raw, untrusted "return to" value (?next= / ?redirect=), or nothing.
 */
export function postAuthPath(next: string | null | undefined): string {
  const wanted = safeInternalPath(next, '');
  if (!wanted) return WELCOME_PATH;
  if (bypassesWelcome(wanted)) return wanted;
  if (isAuthPath(wanted)) return WELCOME_PATH;
  return `${WELCOME_PATH}?next=${encodeURIComponent(wanted)}`;
}

/** Where /welcome sends the member on: their original destination, else home. */
export function welcomeReturnPath(next: string | null | undefined): string {
  const wanted = safeInternalPath(next, HOME_PATH);
  return isAuthPath(wanted) ? HOME_PATH : wanted;
}
