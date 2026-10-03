import 'server-only';

/**
 * Batch 24: Coverage's reads. Counts come from si_question_counts (grouped
 * in the database, so no row limit cuts them short); "approved" is every
 * slug Zac has ever approved, so a retired or stale entry still counts for
 * the weeks it answered in.
 */
import { createAdminClient } from '../supabase/admin';
import { ukWeekRange } from '../activity/week';
import { parseCounts, tallyWeeks, type WeekCoverage } from './coverage';

type Admin = ReturnType<typeof createAdminClient>;

export async function everApprovedSlugs(admin: Admin): Promise<Set<string> | null> {
  const { data, error } = await admin.from('si_knowledge').select('slug').not('approved_at', 'is', null).limit(5000);
  if (error) return null;
  return new Set(((data ?? []) as { slug: string }[]).map((r) => r.slug));
}

/** The weeks given (Mondays, oldest first), tallied. Null when the log can't be read. */
export async function coverageFor(admin: Admin, weeks: readonly string[]): Promise<WeekCoverage[] | null> {
  if (weeks.length === 0) return [];
  const since = ukWeekRange(weeks[0]).start.toISOString();
  const until = ukWeekRange(weeks[weeks.length - 1]).end.toISOString();
  const [counts, approved] = await Promise.all([admin.rpc('si_question_counts', { p: { since, until } }), everApprovedSlugs(admin)]);
  if (counts.error || !approved) {
    if (counts.error) console.error('[knowledge] coverage counts failed:', counts.error.message);
    return null;
  }
  return tallyWeeks(parseCounts(counts.data), weeks, approved);
}

export interface TopGap {
  id: string;
  label: string;
  asked: number;
  status: string;
  entry_id: string | null;
  last_asked_at: string | null;
}

/** The most asked gaps still worth a look (not dismissed or covered), optionally only those asked since `since`. */
export async function topGaps(admin: Admin, o: { limit: number; since?: string; until?: string }): Promise<TopGap[] | null> {
  let q = admin.from('si_knowledge_gaps').select('id, label, asked, status, entry_id, last_asked_at').in('status', ['open', 'drafted', 'rejected', 'failed']);
  if (o.since) q = q.gte('last_asked_at', o.since);
  if (o.until) q = q.lt('last_asked_at', o.until);
  const { data, error } = await q.order('asked', { ascending: false }).order('last_asked_at', { ascending: false }).limit(o.limit);
  if (error) return null;
  return (data ?? []) as TopGap[];
}
