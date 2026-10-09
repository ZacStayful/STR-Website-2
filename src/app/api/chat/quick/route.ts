import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSameOriginJson } from '@/lib/tracking/request';
import { askQuick } from '@/lib/chat/quick-server';
import { isUuid } from '@/lib/chat/turns-server';

/**
 * Batch 26: a quick answer (src/lib/chat/quick-server.ts). Signed-in members
 * only; the member is always the session's, never anything in the body.
 *
 * Body: { clientTurnId: uuid (the same id on a retry), question: string }.
 * Always 200 with a ChatReply (src/lib/chat/reply.ts) for a signed-in member:
 * "Top up", "Ask in the full view" and "I don't know" are answers, not errors.
 * If the page goes away before the answer is back, the model is stopped and
 * nothing is charged (vercel.json opts this route into request cancellation);
 * the work runs under after() so that clean-up still finishes.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in to ask Stayful Intelligence.', code: 'signed_out' }, { status: 401 });
  let body: { clientTurnId?: unknown; question?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* handled below */
  }
  if (!isUuid(body.clientTurnId)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const work = askQuick(user, { clientTurnId: body.clientTurnId, question: body.question, signal: request.signal });
  after(work.then(
    () => undefined,
    () => undefined,
  ));
  return Response.json(await work);
}
