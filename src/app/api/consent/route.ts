import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { releaseHeld } from '@/lib/meta/conversions';
import { isChoice, isConsentSource, type DeviceConsent } from '@/lib/tracking/consent';
import { clearTrackingCookies, deviceConsent, recordChoice, setDeviceConsent } from '@/lib/tracking/consent-server';
import { clientDetails, isSameOriginJson } from '@/lib/tracking/request';
import { TRACKING } from '@/lib/tracking/config';

export const dynamic = 'force-dynamic';

/**
 * A cookie choice from the banner, Cookie settings or the sign-up checkbox
 * (src/components/tracking). Our own pages only (same origin, JSON): another
 * site cannot make a choice for a visitor.
 *
 *   POST { choice: 'accept' | 'reject', source: 'banner' | 'settings' | 'signup' }
 *
 * Records the proof (and, signed in, the member's saved choice), writes the
 * essential cookie again from the server (so Safari's 7-day cap on script-set
 * cookies does not apply), and on Reject clears the attribution cookie and
 * our _fbc; on a member's Accept, conversions held in the last hour are
 * sent. Never fails the page: the browser has already remembered the
 * choice itself.
 */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 2048) return Response.json({ error: 'Too large.' }, { status: 413 });
  let body: { choice?: unknown; source?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const choice = body.choice;
  const source = body.source ?? 'banner';
  if (!isChoice(choice) || !isConsentSource(source)) return Response.json({ error: 'Invalid choice.' }, { status: 400 });

  const device = await deviceConsent();
  const now = new Date();
  const consent: DeviceConsent = { choice, at: now, visitorId: device?.visitorId ?? randomUUID(), version: TRACKING.consentVersion };

  let userId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* signed out, or auth unavailable: the choice still counts for this device */
  }

  const recorded = await recordChoice({ visitorId: consent.visitorId, userId, choice, source, at: now });
  await setDeviceConsent(consent);
  if (choice === 'reject') await clearTrackingCookies(request.headers.get('x-forwarded-host') ?? request.headers.get('host'));
  // A member's Accept: their conversions held in the last hour are sent after all.
  if (userId && recorded.member?.choice === 'accept') {
    const memberId = userId;
    const details = clientDetails(request.headers);
    after(() => releaseHeld(memberId, details));
  }

  return Response.json({ ok: true, choice, at: now.toISOString() });
}
