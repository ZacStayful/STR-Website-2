import { extensionAccess } from '@/lib/extension/auth';
import { accessDenied } from '@/lib/access';
import { json, preflight } from '@/lib/extension/cors';
import { checkListingForMember } from '@/lib/listing/server';

export const runtime = 'nodejs';
// Same ceiling as /api/listing/resolve: the quick view budgets its own lookups.
export const maxDuration = 60;

const MAX_HTML_BYTES = 3 * 1024 * 1024;

/**
 * POST { url, html?, save? } from the extension. The same free quick view as
 * the site's paste box, but the page HTML comes from the member's own browser
 * tab, which is how Zoopla and Booking.com (blocked server-side) get read.
 * HTML is parsed and discarded; only the typed snapshot is kept, and only
 * for this member. `save` (default true) records the listing in their pipeline.
 */
export async function POST(request: Request) {
  const access = await extensionAccess(request);
  if (access.state === 'anon') return json(request, { error: 'Not connected. Open the Stayful site and connect the extension.', code: 'not_connected' }, { status: 401 });
  if (access.state !== 'ok' || !access.user) {
    const denied = accessDenied(access.profile, 'listing checks');
    return json(request, { ...denied, code: 'no_access', reason: denied.code }, { status: 402 });
  }

  let body: { url?: unknown; html?: unknown; save?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(request, { error: 'Invalid request body.' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 2048) : '';
  if (!url) return json(request, { error: 'This page is not a listing we can read.', code: 'unsupported_url' }, { status: 400 });
  let html = typeof body.html === 'string' && body.html.length > 0 ? body.html : undefined;
  if (html && html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);

  try {
    const outcome = await checkListingForMember(url, { userId: access.user.id, goals: access.goals, html, save: body.save !== false, admin: true });
    if (!outcome.ok) {
      const status = outcome.code === 'unsupported_url' ? 400 : outcome.code === 'cap' ? 429 : 200;
      return json(request, { error: outcome.message, code: outcome.code, detected: outcome.detected }, { status });
    }
    return json(request, outcome.body);
  } catch (err) {
    console.error('[ext] check failed:', err);
    return json(request, { error: 'Stayful could not read that listing just now. Please try again in a moment.' }, { status: 500 });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
