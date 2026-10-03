import 'server-only';

/**
 * Batch 23b: what a member does with their briefing, on its row and as
 * record-only activity (briefing_seen, briefing_played, briefing_feedback).
 * Nothing here charges or changes weekly active.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { recordActivity } from '../activity/log';
import { ukDay } from '../activity/week';

export type Feedback = 'useful' | 'not_for_me';

export function isFeedback(v: unknown): v is Feedback {
  return v === 'useful' || v === 'not_for_me';
}

/** In from the email on a day with a briefing: seen there. Once a day; never throws. */
export async function markBriefingSeenByEmail(userId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const day = ukDay(now);
    const { data } = await createAdminClient().from('member_briefings').update({ seen_email_at: now.toISOString() }).eq('user_id', userId).eq('uk_day', day).is('seen_email_at', null).in('status', ['ready', 'template']).select('id');
    if ((data ?? []).length > 0) await recordActivity(userId, 'briefing_seen', { extras: { source: 'email_click' }, dedupeKey: `briefing_seen:email:${day}`, at: now });
  } catch (err) {
    console.warn('[briefing] seen-by-email not recorded:', (err as Error)?.message ?? err);
  }
}

/** First time the card opens on Today: stamped once, logged once. */
export async function markShownInApp(userId: string, briefingId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  const { data } = await createAdminClient().from('member_briefings').update({ shown_in_app_at: now.toISOString() }).eq('id', briefingId).eq('user_id', userId).is('shown_in_app_at', null).select('id');
  if ((data ?? []).length > 0) await recordActivity(userId, 'briefing_seen', { extras: { source: 'in_app' }, dedupeKey: `briefing_seen:app:${ukDay(now)}`, at: now });
}

export async function markDismissed(userId: string, briefingId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  await createAdminClient().from('member_briefings').update({ dismissed_at: now.toISOString() }).eq('id', briefingId).eq('user_id', userId);
}

export async function markPlayed(userId: string, briefingId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  const admin = createAdminClient();
  const { data } = await admin.from('member_briefings').select('played_count').eq('id', briefingId).eq('user_id', userId).maybeSingle();
  if (!data) return;
  await admin.from('member_briefings').update({ played_count: (Number(data.played_count) || 0) + 1 }).eq('id', briefingId).eq('user_id', userId);
  await recordActivity(userId, 'briefing_played', { at: now });
}

/** "Useful" / "Not for me": the latest answer stands. Returns false when the row is not theirs. */
export async function recordFeedback(briefingId: string, feedback: Feedback, now: Date = new Date(), userId?: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  let q = createAdminClient().from('member_briefings').update({ feedback, feedback_at: now.toISOString() }).eq('id', briefingId);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q.select('user_id');
  const row = (data ?? [])[0] as { user_id: string } | undefined;
  if (!row) return false;
  await recordActivity(row.user_id, 'briefing_feedback', { extras: { answer: feedback }, at: now });
  return true;
}
