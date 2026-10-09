import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/tracking/request';
import { markUnhappy } from '@/lib/chat/log-server';

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
  return Response.json({ ok: await markUnhappy(createAdminClient(), user.id, id) });
}
