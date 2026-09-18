import { isPickToken } from '@/lib/listing/picks';
import { pickByToken, setPicksEnabled } from '@/lib/listing/picks-server';
import { siteUrl } from '@/lib/url';

export const runtime = 'nodejs';

/**
 * RFC 8058 one-click unsubscribe: mail clients POST here (the address in the
 * List-Unsubscribe header) with `List-Unsubscribe=One-Click` in the body. A
 * browser GET is sent to the confirming page instead, because links are
 * prefetched by mail security scanners and must not have side effects.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isPickToken(token)) return new Response('Not found', { status: 404 });
  const pick = await pickByToken(token);
  if (!pick) return new Response('Not found', { status: 404 });
  const ok = await setPicksEnabled(pick.userId, false);
  return new Response(ok ? 'Unsubscribed' : 'Try again later', { status: ok ? 200 : 503, headers: { 'Content-Type': 'text/plain' } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isPickToken(token)) return new Response('Not found', { status: 404 });
  return Response.redirect(siteUrl(`/p/${encodeURIComponent(token)}?a=unsubscribe`), 303);
}
