import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isSameOriginJson } from '@/lib/tracking/request';
import { answerFact } from '@/lib/chat/log-server';
import { chatMemberFor } from '@/lib/chat/turns-server';

/**
 * Batch 26: the member's Yes or No to "Want me to remember that?" under a
 * full-view answer. Only the fact that answer proposed, once, and only on
 * Yes (Batch 24's rememberFact refuses anything sensitive or personal, a
 * duplicate, or past the cap). The member sees and deletes their facts in
 * Account.
 *
 * Body: { turnId: uuid, yes: boolean }.
 */
export const runtime = 'nodejs';

const REASONS: Record<string, string> = {
  sensitive: 'I can’t keep that kind of detail, so I haven’t saved it.',
  personal_details: 'I don’t keep personal details like that, so I haven’t saved it.',
  duplicate: 'I already remember that.',
  cap: 'I’m remembering as much as I can for you. Delete something in Account to make room.',
  too_long: 'That’s too long for me to keep.',
  empty: 'There was nothing to remember.',
};

export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in.' }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ ok: false, message: 'Not available just now.' });
  let body: { turnId?: unknown; yes?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* handled below */
  }
  const member = await chatMemberFor(user);
  const result = await answerFact(createAdminClient(), member, String(body.turnId ?? ''), body.yes === true);
  if (!result) return Response.json({ ok: false, message: 'That has already been answered.' });
  if (result.ok) return Response.json({ ok: true, saved: result.saved, message: result.saved ? 'Done — I’ll remember that. You can see it in Account.' : 'OK, I won’t keep that.' });
  return Response.json({ ok: false, message: REASONS[result.reason] ?? 'I couldn’t save that just now.' });
}
