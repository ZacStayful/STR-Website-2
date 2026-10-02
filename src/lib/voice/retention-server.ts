import 'server-only';

/**
 * Batch 23: transcripts are kept si_transcript_retention_days (90), then the
 * turns are deleted; each question's text and outcome stay for Batch 24's
 * learning loop. Once a UK day, from the calls cron.
 */
import { createAdminClient } from '../supabase/admin';

export interface RetentionResult {
  due: number;
  purged: number;
}

export async function purgeTranscripts(o: { apply: boolean; days: number; now?: Date; limit?: number }): Promise<RetentionResult> {
  const admin = createAdminClient();
  const cutoff = new Date((o.now ?? new Date()).getTime() - o.days * 86_400_000).toISOString();
  const { data, error } = await admin.from('si_conversations').select('id').lt('started_at', cutoff).is('transcript_purged_at', null).limit(o.limit ?? 500);
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!o.apply || ids.length === 0) return { due: ids.length, purged: 0 };
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error: delErr } = await admin.from('si_conversation_turns').delete().in('conversation_id', chunk);
    if (delErr) throw new Error(delErr.message);
    const { error: upErr } = await admin.from('si_conversations').update({ transcript_purged_at: new Date().toISOString() }).in('id', chunk);
    if (upErr) throw new Error(upErr.message);
  }
  return { due: ids.length, purged: ids.length };
}
