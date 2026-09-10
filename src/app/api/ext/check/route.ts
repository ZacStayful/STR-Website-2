import { extensionAccess } from '@/lib/extension/auth';
import { json, preflight } from '@/lib/extension/cors';
import { resolveListing, recordCheckedListing, resolvesToday } from '@/lib/listing/server';
import { quickEstimate } from '@/lib/listing/quick';
import { detectListingUrl } from '@/lib/listing/detect';

export const runtime = 'nodejs';
export const maxDuration = 30;

const DEFAULT_RESOLVES_PER_DAY = 30;
const MAX_HTML_BYTES = 3 * 1024 * 1024;

/**
 * POST { url, html?, save? } from the extension. The same free quick view as
 * the site's paste box, but the page HTML comes from the member's own browser
 * tab, which is how Zoopla and Booking.com (blocked server-side) get read.
 * HTML is parsed and discarded; only the typed snapshot is kept. `save`
 * (default true) records the listing in the member's pipeline.
 */
export async function POST(request: Request) {
  const access = await extensionAccess(request);
  if (access.state === 'anon') return json(request, { error: 'Not connected. Open the Stayful site and connect the extension.', code: 'not_connected' }, { status: 401 });
  if (access.state !== 'ok' || !access.user) return json(request, { error: 'Your plan does not include listing checks.', code: 'no_access', upgradeUrl: '/upgrade' }, { status: 402 });

  let body: { url?: unknown; html?: unknown; save?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(request, { error: 'Invalid request body.' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 2048) : '';
  const detected = detectListingUrl(url);
  if (!detected) return json(request, { error: 'This page is not a listing we can read.', code: 'unsupported_url' }, { status: 400 });
  let html = typeof body.html === 'string' ? body.html : undefined;
  if (html && html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);

  const cap = Number(process.env.LISTING_RESOLVES_PER_DAY ?? DEFAULT_RESOLVES_PER_DAY);
  const used = await resolvesToday(access.user.id, { admin: true });
  if (Number.isFinite(cap) && cap > 0 && used >= cap) {
    return json(request, { error: `You have checked ${cap} listings today. Try again tomorrow.`, code: 'cap' }, { status: 429 });
  }

  const resolved = await resolveListing(url, { html });
  if (!resolved.ok) return json(request, { error: resolved.message, code: resolved.code, detected: resolved.detected }, { status: 200 });

  const snap = resolved.snapshot;
  const price = snap.kind === 'sale' ? resolved.prefill.purchasePrice : snap.kind === 'rent' ? resolved.prefill.advertisedRent : null;
  const quick = await quickEstimate(
    {
      kind: snap.kind,
      postcode: snap.postcode ?? null,
      outcode: snap.outcode ?? null,
      bedrooms: resolved.prefill.bedrooms,
      bathrooms: resolved.prefill.bathrooms,
      lat: snap.lat ?? null,
      lng: snap.lng ?? null,
      airbnbId: snap.source === 'airbnb' ? snap.id : null,
      price: price ?? null,
      finance: access.goals?.finance ?? null,
    },
    { mode: 'quick', userId: access.user.id },
  );
  const checkedListingId = body.save === false ? null : await recordCheckedListing(access.user.id, snap, quick, { admin: true });
  return json(request, { snapshot: snap, prefill: resolved.prefill, warnings: resolved.warnings, quick, checkedListingId, fromCache: resolved.fromCache });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
