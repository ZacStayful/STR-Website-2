import 'server-only';

/**
 * Sign-up and sign-in, for cookie consent and attribution (Batch 19). One
 * call from each place a member gets an account or a session:
 *
 *   onEmailSignup  signupAction, once Supabase has made the account
 *   onSignIn       /auth/callback (Google, email links), /auth/confirm
 *                  (token links) and loginAction (password)
 *
 * Always in this order: this device's cookie choice becomes the member's
 * first (the newer choice wins), then the new account's attribution is
 * saved, then CompleteRegistration (src/lib/meta/conversions.ts decides
 * whether it counts: once per account, accounts made after tracking began,
 * not lead-form accounts or team seats). So someone who accepted on the
 * landing page and then signed up counts as consenting.
 *
 * Batch 22f: an account whose first touch is the management-company page
 * (cookie, hidden field or Google's return, whichever chooseTouch picks) is
 * stamped as a management company right after its attribution is saved.
 *
 * The cookies are read while the request is here; the database work runs
 * after the response (after()), so it never slows sign-up or sign-in and a
 * failure never blocks it.
 */
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { hasOpenInvite } from '../team';
import { recordConversion, releaseHeld } from '../meta/conversions';
import type { ClientDetails } from '../meta/capi';
import { TRACKING } from './config';
import { attributionCookie, saveAttribution } from './attribution-server';
import { attachDevice, deviceConsent, recordChoice, setDeviceConsent } from './consent-server';
import { clientDetails } from './request';
import { chooseTouch, parseTouch } from './touch';
import { isManagementTouch } from '../management/stamp';
import { stampManagement } from '../management/stamp-server';

async function requestDetails(): Promise<ClientDetails | null> {
  try {
    return clientDetails(await headers());
  } catch {
    return null;
  }
}

/**
 * A new account from the sign-up form. `carried` is the form's hidden
 * attribution field; `signedIn` is Supabase confirming the address itself
 * and returning a session (then the sign-up is complete now, not at the
 * confirmation link).
 */
export async function onEmailSignup(input: { userId: string; teamInvite: boolean; carried: string | null; consentTicked: boolean; signedIn: boolean }): Promise<void> {
  try {
    const device = await deviceConsent();
    const cookieTouch = await attributionCookie();
    const details = input.signedIn ? await requestDetails() : null;
    const at = new Date();
    const visitorId = device?.visitorId ?? randomUUID();
    // Ticked: this device says yes too, from now on.
    if (input.consentTicked) await setDeviceConsent({ choice: 'accept', at, visitorId, version: TRACKING.consentVersion });
    const { touch, via } = chooseTouch(cookieTouch, parseTouch(input.carried), 'form');
    after(async () => {
      if (input.consentTicked) await recordChoice({ visitorId, userId: input.userId, choice: 'accept', source: 'signup', at });
      else await attachDevice(input.userId, device);
      await saveAttribution({ userId: input.userId, method: 'email', teamInvite: input.teamInvite, touch, via });
      // Batch 22f: a first touch on the management-company page stamps the account (never a team seat).
      if (!input.teamInvite && isManagementTouch(touch)) await stampManagement(input.userId, 'first_touch');
      if (input.signedIn) await recordConversion({ name: 'CompleteRegistration', userId: input.userId, details });
    });
  } catch (err) {
    console.warn('[signup] consent and attribution not recorded:', err instanceof Error ? err.message : String(err));
  }
}

/** A Google account made moments ago is a sign-up, not a sign-in. */
function isNewGoogleAccount(user: { app_metadata?: { provider?: unknown } | null; created_at?: string | null }, now: number): boolean {
  if (user.app_metadata?.provider !== 'google' || !user.created_at) return false;
  const created = new Date(user.created_at).getTime();
  return Number.isFinite(created) && now - created >= 0 && now - created < TRACKING.newGoogleAccountMinutes * 60_000;
}

/**
 * A member has a session. `carried` is the attribution Google's return
 * address brought back (callback only); `next` is where they are going (a
 * team invite's join page marks a team seat).
 */
export async function onSignIn(input: {
  user: { id: string; email?: string | null; app_metadata?: { provider?: unknown } | null; created_at?: string | null };
  carried: string | null;
  next: string;
}): Promise<void> {
  try {
    const device = await deviceConsent();
    const details = await requestDetails();
    const newGoogle = isNewGoogleAccount(input.user, Date.now());
    const chosen = newGoogle ? chooseTouch(await attributionCookie(), parseTouch(input.carried), 'redirect') : null;
    const userId = input.user.id;
    const email = input.user.email ?? null;
    // Batch 22f: a new Google account whose first touch was the management
    // page is stamped NOW, not after the response: the callback's redirect
    // reads the stamp to choose where they land. Never a team invite.
    if (chosen && isManagementTouch(chosen.touch) && !input.next.startsWith('/team/join')) await stampManagement(userId, 'first_touch');
    after(async () => {
      const member = await attachDevice(userId, device);
      // This device's yes has just become theirs: anything held in the last hour goes now.
      if (member?.adopted && member.choice === 'accept') await releaseHeld(userId, details);
      if (chosen) {
        const teamInvite = input.next.startsWith('/team/join') && (await hasOpenInvite(email));
        await saveAttribution({ userId, method: 'google', teamInvite, touch: chosen.touch, via: chosen.via });
      }
      await recordConversion({ name: 'CompleteRegistration', userId, details });
    });
  } catch (err) {
    console.warn('[signin] consent and attribution not recorded:', err instanceof Error ? err.message : String(err));
  }
}
