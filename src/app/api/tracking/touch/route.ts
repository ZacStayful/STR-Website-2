import { keepTouch } from '@/lib/tracking/attribution-server';
import { deviceConsent } from '@/lib/tracking/consent-server';
import { isSameOriginJson } from '@/lib/tracking/request';
import { isTagged, parseTouch } from '@/lib/tracking/touch';

export const dynamic = 'force-dynamic';

/**
 * A tagged landing (utm tags or Meta's click id) on a device that has
 * accepted (Batch 19): kept in the httpOnly attribution cookie for 30 days
 * (first touch wins), and Meta's click id in its _fbc cookie. Without Accept
 * nothing is stored on the device; the page carries the touch to sign-up
 * itself. Same-origin JSON only.
 *
 *   POST { t: <touch> }  →  { ok }
 */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return Response.json({ error: 'Too large.' }, { status: 413 });
  let raw: unknown;
  try {
    raw = ((await request.json()) as { t?: unknown }).t;
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const touch = parseTouch(typeof raw === 'string' ? raw : null);
  if (!touch || !isTagged(touch)) return Response.json({ ok: false });
  if ((await deviceConsent())?.choice !== 'accept') return Response.json({ ok: false });
  await keepTouch(touch, request.headers.get('x-forwarded-host') ?? request.headers.get('host'));
  return Response.json({ ok: true });
}
