import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { pixelEnabled, serverSendMode } from '@/lib/meta/env';
import { hashEmail, hashExternalId } from '@/lib/meta/hash';
import { metaExclusion, pendingForBrowser, releaseHeld } from '@/lib/meta/conversions';
import { attachDevice, clearTrackingCookies, deviceConsent, refreshBrowserDetails } from '@/lib/tracking/consent-server';
import { SIGNED_OUT, type BrowserConversion, type MeAnswer } from '@/lib/tracking/me';
import { clientDetails, isSameOriginJson } from '@/lib/tracking/request';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The signed-in member's side of cookie consent and the pixel (Batch 19),
 * asked by TrackingRoot on page loads and after payments, only when a
 * session cookie is present, so anonymous visitors never make this request.
 *
 *   - A choice made on this device while signed out (or by this member)
 *     becomes theirs when it is newer (attachDevice); someone else's choice
 *     on a shared device never does. The member's saved choice is what counts
 *     while they are signed in, on any device: they are asked once, not once
 *     per device. It is never written into this device's cookie, so it goes
 *     when they sign out.
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

  const userId = user.id;
  const details = clientDetails(request.headers);
  const device = await deviceConsent();
  const member = await attachDevice(userId, device);
  // This device's Accept has just become the member's: anything held in the last hour goes.
  if (member?.adopted && member.choice === 'accept') after(() => releaseHeld(userId, details));
  // A Reject made elsewhere: this device's attribution and click cookies go too.
  if (member?.choice === 'reject' && device?.choice !== 'reject') await clearTrackingCookies(request.headers.get('x-forwarded-host') ?? request.headers.get('host'));

  const who = hashExternalId(userId);
  let excluded = false;
  let pixel: MeAnswer['pixel'] = null;
  let pending: BrowserConversion[] = [];

  if (member?.choice === 'accept' && (pixelEnabled() || serverSendMode().ok)) {
    excluded = (await metaExclusion(userId, user.email ?? null)) !== null;
    if (!excluded) {
      if (pixelEnabled() && who) {
        pixel = { em: hashEmail(user.email), external_id: who };
        pending = await pendingForBrowser(userId);
      }
      if (serverSendMode().ok) after(() => refreshBrowserDetails(userId, details));
    }
  }

  const answer: MeAnswer = { signedIn: true, who, choice: member?.choice ?? null, excluded, pixel, pending };
  return Response.json(answer, { headers: NO_STORE });
}
