import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isSameOriginJson } from '@/lib/tracking/request';

export const dynamic = 'force-dynamic';

/**
 * Batch 22f: one view of /for-management-companies, counted per UK day
 * (mc_page_views), for the admin's management-company funnel. Nothing about
 * the visitor is kept: no cookie, no IP, no account — so it needs no
 * consent. `tagged`: they came from an ad or a tagged link.
 *
 *   POST { tagged: boolean }  →  { ok }
 */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 512) return Response.json({ error: 'Too large.' }, { status: 413 });
  let tagged = false;
  try {
    tagged = ((await request.json()) as { tagged?: unknown }).tagged === true;
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!hasServiceRole()) return Response.json({ ok: false });
  const { error } = await createAdminClient().rpc('mc_page_view_hit', { p_tagged: tagged });
  if (error) console.warn('[mc] page view not counted:', error.message);
  return Response.json({ ok: !error });
}
