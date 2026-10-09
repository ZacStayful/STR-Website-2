import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/tracking/request';
import { getBillingSettings } from '@/lib/credit/unit-costs';
import { deleteMemberHistory, memberHistory } from '@/lib/chat/log-server';

/**
 * Batch 26: the member's own chat with Stayful Intelligence (the full view's
 * history). GET: the last si_transcript_retention_days (90), newest first.
 * DELETE: "Delete my chat history": the transcripts go, and the member's name
 * comes off the questions, which stay (with their outcome) for learning.
 * Only ever the signed-in member's own.
 */
export const runtime = 'nodejs';

async function signedIn() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return Response.json({ error: 'Sign in.' }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ conversations: [] });
  const days = (await getBillingSettings()).voice.transcriptRetentionDays;
  try {
    const conversations = await memberHistory(createAdminClient(), user.id, { days, now: new Date() });
    return Response.json({ days, conversations });
  } catch (err) {
    console.error('[api/chat/history]', (err as Error)?.message ?? err);
    return Response.json({ error: 'Your history could not be read just now.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const user = await signedIn();
  if (!user) return Response.json({ error: 'Sign in.' }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'Not available.' }, { status: 503 });
  try {
    const out = await deleteMemberHistory(createAdminClient(), user.id);
    if (!out.ok) return Response.json({ error: 'Wait for my answer to your last question, then delete.' }, { status: 409 });
    return Response.json(out);
  } catch (err) {
    console.error('[api/chat/history] delete:', (err as Error)?.message ?? err);
    return Response.json({ error: 'Your history could not be deleted just now. Please try again.' }, { status: 500 });
  }
}
