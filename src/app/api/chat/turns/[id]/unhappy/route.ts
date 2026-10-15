import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/tracking/request';
import { markUnhappy } from '@/lib/chat/log-server';
import { logActivity } from '@/lib/activity/log';

/**
 * Batch 26: "Not helpful" under an answer. The question is logged as
 * member_unhappy (once), which Batch 24's nightly job learns from. No refund.
 * Only the signed-in member's own answer.
 */
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in.' }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ ok: false });
  const ok = await markUnhappy(createAdminClient(), user.id, id);
  // R3-92: the member's own action, record only (the question itself is logged as member_unhappy for the nightly job).
  if (ok) logActivity(user.id, 'si_chat_unhappy', { dedupeKey: `si_chat_unhappy:${id}` });
  return Response.json({ ok });
}
