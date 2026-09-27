import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { reminderEvent } from '@/lib/analysis/take-up';

/**
 * A reminder to run the Full analysis of this deal was on screen (Batch 10):
 * the line under a deal moved past Kept, or the Kept next step. Sent from the
 * browser once the reminder is really shown, so a prefetch or a dismissed
 * reminder never counts. Records reminder_shown, once per member, deal,
 * place and stage; nothing else happens.
 *
 * Body: { where: 'stage' | 'kept_step', stage }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  let body: { where?: unknown; stage?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* refused below */
  }
  const shown = reminderEvent('shown', { dealId: id, where: body.where, stage: body.stage });
  if (!shown) return new Response(null, { status: 400 });
  logActivity(user.id, 'reminder_shown', { dealId: id, dedupeKey: shown.dedupeKey, extras: shown.extras });
  return new Response(null, { status: 204 });
}
