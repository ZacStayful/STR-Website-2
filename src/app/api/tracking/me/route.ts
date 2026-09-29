import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { pixelEnabled, serverSendMode } from '@/lib/meta/env';
import { hashEmail, hashExternalId } from '@/lib/meta/hash';
import { metaExclusion, pendingForBrowser, releaseHeld } from '@/lib/meta/conversions';
import { TRACKING } from '@/lib/tracking/config';
import { reconcile, type MemberConsent } from '@/lib/tracking/consent';
import { attachDevice, clearTrackingCookies, deviceConsent, memberConsentFor, refreshBrowserDetails, setDeviceConsent } from '@/lib/tracking/consent-server';
import { SIGNED_OUT, type BrowserConversion, type MeAnswer } from '@/lib/tracking/me';
import { clientDetails, isSameOriginJson } from '@/lib/tracking/request';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The signed-in member's side of cookie consent and the pixel (Batch 19),
 * asked by TrackingRoot on page loads and after payments. Only called from a
 * device that has accepted or not chosen yet, and only when a session cookie
 * is present, so anonymous visitors never make this request.
 *
 *   - Brings this device and the member into line: the newer choice wins
 *     (a member is asked once, not once per device). The member's newer
 *     choice is written to this device's cookie.
 *   - For a consenting member of a production build: the hashed email and
 *     account number for the pixel, and the conversions still to fire.
 *   - Keeps a consenting member's browser details (at most hourly) when the
 *     server can send events, for a payment Stripe reports with no browser.
 *
 * POST with a JSON body, from our own pages only.
 */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 });

  let user: { id: string; email?: string | null } | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    user = u ?? null;
  } catch {
    user = null;
  }
  if (!user) return Response.json(SIGNED_OUT, { headers: NO_STORE });

  const device = await deviceConsent();
  const saved = await memberConsentFor(user.id);
  let member: MemberConsent | null = saved ? { choice: saved.choice, chosenAt: saved.chosenAt } : null;
  let deviceChoice = device?.choice ?? null;
  let deviceUpdated = false;

  const side = reconcile(device, member);
  if (side === 'device' && device && device.choice !== member?.choice) {
    member = (await attachDevice(user.id, device)) ?? member;
    // This device's Accept is now the member's: anything held in the last hour goes.
    if (member?.choice === 'accept') {
      const memberId = user.id;
      const details = clientDetails(request.headers);
      after(() => releaseHeld(memberId, details));
    }
  } else if (side === 'member' && member && member.choice !== device?.choice) {
    await setDeviceConsent({ choice: member.choice, at: member.chosenAt, visitorId: device?.visitorId ?? randomUUID(), version: TRACKING.consentVersion });
    if (member.choice === 'reject') await clearTrackingCookies(request.headers.get('x-forwarded-host') ?? request.headers.get('host'));
    deviceChoice = member.choice;
    deviceUpdated = true;
  }

  const who = hashExternalId(user.id);
  const accepted = member?.choice === 'accept' && deviceChoice === 'accept';
  let excluded = false;
  let pixel: MeAnswer['pixel'] = null;
  let pending: BrowserConversion[] = [];

  if (accepted && (pixelEnabled() || serverSendMode().ok)) {
    excluded = (await metaExclusion(user.id, user.email ?? null)) !== null;
    if (!excluded) {
      if (pixelEnabled() && who) {
        pixel = { em: hashEmail(user.email), external_id: who };
        pending = await pendingForBrowser(user.id);
      }
      if (serverSendMode().ok) {
        const userId = user.id;
        const details = clientDetails(request.headers);
        after(() => refreshBrowserDetails(userId, details));
      }
    }
  }

  const answer: MeAnswer = {
    signedIn: true,
    who,
    choice: member?.choice ?? null,
    deviceUpdated,
    excluded,
    pixel,
    pending,
  };
  return Response.json(answer, { headers: NO_STORE });
}
