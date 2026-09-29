import { createSupabaseServerClient } from '@/lib/supabase/server';
import { recordBannerEvent, type BannerAction } from '@/lib/feedback/announcements-server';

export const dynamic = 'force-dynamic';

const ACTIONS: readonly BannerAction[] = ['shown', 'dismiss', 'click'];

/**
 * The announcement banner reporting back (Batch 18): { action: 'shown' |
 * 'dismiss' | 'click', ids }. Sent from the browser once the banner is
 * really on screen, so a prefetch never counts as seen. Members only, and
 * only ever for the member's own views: whose they are comes from the
 * session. Answers 204 whatever happened; the banner never waits on it.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 4096) return new Response(null, { status: 413 });
  let body: { action?: unknown; ids?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(null, { status: 400 });
  }
  const action = ACTIONS.find((a) => a === body.action);
  if (!action) return new Response(null, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  try {
    await recordBannerEvent(user.id, action, body.ids);
  } catch (err) {
    console.warn('[announcements] event failed:', err instanceof Error ? err.message : err);
  }
  return new Response(null, { status: 204 });
}
