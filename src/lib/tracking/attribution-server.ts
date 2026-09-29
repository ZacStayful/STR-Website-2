import 'server-only';

/**
 * Sign-up attribution on the server (Batch 19).
 *
 *   keepTouch             a tagged landing on an accepted device: the httpOnly
 *                         sf_attr cookie (first touch, 30 days) and Meta's
 *                         _fbc click cookie (90 days, on the site's parent
 *                         domain, where the pixel keeps it)
 *   attributionCookie     the touch kept in sf_attr, if any
 *   saveAttribution       a new account's member_attribution row: once,
 *                         never overwritten, never for lead-form accounts
 *
 * The cookie helpers only work in a route handler or a server action.
 * Nothing here throws.
 */
import { cookies } from 'next/headers';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { deployment } from '../meta/env';
import { buildFbc, fbclidOf, registrableDomain } from '../meta/fbc';
import { TRACKING } from './config';
import { attributionRow, parseTouch, serializeTouch, touchForCookie, type CapturedVia, type Touch } from './touch';

function warn(message: string): void {
  console.warn('[attribution]', message);
}

function secure(): boolean {
  return deployment() !== 'development';
}

export async function attributionCookie(): Promise<Touch | null> {
  try {
    return parseTouch((await cookies()).get(TRACKING.attributionCookie)?.value);
  } catch {
    return null;
  }
}

/**
 * Keep a tagged landing for an accepted device. The caller has checked the
 * device's choice is Accept.
 */
export async function keepTouch(touch: Touch, host: string | null, now: number = Date.now()): Promise<void> {
  try {
    const jar = await cookies();
    const existing = parseTouch(jar.get(TRACKING.attributionCookie)?.value, now);
    const keep = touchForCookie(existing, touch, now, TRACKING.attributionDays);
    if (keep) {
      jar.set(TRACKING.attributionCookie, serializeTouch(keep), { maxAge: TRACKING.attributionDays * 86_400, path: '/', sameSite: 'lax', secure: secure(), httpOnly: true });
    }
    // Meta's click cookie follows the latest click, as the pixel's own would.
    const fbc = touch.fbclid ? buildFbc(touch.fbclid, touch.fbAt ?? touch.at) : null;
    if (fbc && fbclidOf(jar.get(TRACKING.fbcCookie)?.value) !== touch.fbclid) {
      const domain = host ? registrableDomain(host.split(':')[0]) : null;
      jar.set(TRACKING.fbcCookie, fbc, { maxAge: TRACKING.fbcDays * 86_400, path: '/', sameSite: 'lax', secure: secure(), httpOnly: false, ...(domain ? { domain } : {}) });
    }
  } catch (err) {
    warn(`touch not kept: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A new account's attribution: the cookie's touch, else what the page carried
 * (the sign-up form or Google's return address), else empty ("direct /
 * unknown"). Insert-only: a second call for the same account changes nothing.
 */
export async function saveAttribution(input: {
  userId: string;
  method: 'email' | 'google';
  teamInvite: boolean;
  touch: Touch | null;
  via: CapturedVia;
}): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const row = attributionRow({ ...input, env: deployment() });
    const { error } = await createAdminClient().from('member_attribution').upsert(row, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch (err) {
    warn(`not saved: ${err instanceof Error ? err.message : String(err)}`);
  }
}
