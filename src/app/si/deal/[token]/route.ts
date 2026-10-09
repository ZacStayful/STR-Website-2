import { siteUrl } from '@/lib/url';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';

/**
 * Batch 25: the short link in a standout deal's text or email
 * (/si/deal/<token>), so a text stays one segment and never carries the
 * listing. It lands on the deal in the app (sign-in and the member's own
 * visibility rules apply there); an unknown token is a 404.
 */
export const dynamic = 'force-dynamic';

const TOKEN = /^[0-9a-f]{10}$/;
const VIA = new Set(['sms', 'email']);

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN.test(token) || !hasServiceRole()) return new Response('Not found', { status: 404 });
  const { data, error } = await createAdminClient().from('standout_decisions').select('deal_id').eq('link_token', token).not('deal_id', 'is', null).maybeSingle();
  const dealId = (data as { deal_id: string } | null)?.deal_id;
  if (error || !dealId) return new Response('Not found', { status: 404 });
  const via = new URL(request.url).searchParams.get('via');
  return Response.redirect(siteUrl(`/deals/${dealId}?via=${via && VIA.has(via) ? via : 'sms'}`), 302);
}
