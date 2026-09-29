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
 * saved, then anything that depends on their consent. So someone who
 * accepted on the landing page and then signed up counts as consenting.
 *
 * The cookies are read while the request is here; the database work runs
 * after the response (after()), so it never slows sign-up or sign-in and a
 * failure never blocks it.
 */
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { hasOpenInvite } from '../team';
import { TRACKING } from './config';
import { attributionCookie, saveAttribution } from './attribution-server';
import { attachDevice, deviceConsent, recordChoice, setDeviceConsent } from './consent-server';
import { chooseTouch, parseTouch } from './touch';

/** A new account from the sign-up form. `carried` is the form's hidden attribution field. */
export async function onEmailSignup(input: { userId: string; teamInvite: boolean; carried: string | null; consentTicked: boolean }): Promise<void> {
  try {
    const device = await deviceConsent();
    const cookieTouch = await attributionCookie();
    const at = new Date();
    const visitorId = device?.visitorId ?? randomUUID();
    // Ticked: this device says yes too, from now on.
    if (input.consentTicked) await setDeviceConsent({ choice: 'accept', at, visitorId, version: TRACKING.consentVersion });
    const { touch, via } = chooseTouch(cookieTouch, parseTouch(input.carried), 'form');
    after(async () => {
      if (input.consentTicked) await recordChoice({ visitorId, userId: input.userId, choice: 'accept', source: 'signup', at });
      else await attachDevice(input.userId, device);
      await saveAttribution({ userId: input.userId, method: 'email', teamInvite: input.teamInvite, touch, via });
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
    const newGoogle = isNewGoogleAccount(input.user, Date.now());
    const chosen = newGoogle ? chooseTouch(await attributionCookie(), parseTouch(input.carried), 'redirect') : null;
    const userId = input.user.id;
    const email = input.user.email ?? null;
    after(async () => {
      await attachDevice(userId, device);
      if (chosen) {
        const teamInvite = input.next.startsWith('/team/join') && (await hasOpenInvite(email));
        await saveAttribution({ userId, method: 'google', teamInvite, touch: chosen.touch, via: chosen.via });
      }
    });
  } catch (err) {
    console.warn('[signin] consent and attribution not recorded:', err instanceof Error ? err.message : String(err));
  }
}
