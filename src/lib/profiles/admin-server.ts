import 'server-only';

/**
 * What /admin/profiles reads: every saved profile row (dates only, never a
 * name: a client profile's name can identify the client) and Batch 9's
 * weekly-active drill-down, read as it is (loadWeeklyActive). Service role
 * only; the page checks the admin session first.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { loadWeeklyActive } from '../activity/admin-server';
import { ukWeekRange, weekLabel } from '../activity/week';
import { profileMetrics, type ProfileFact, type ProfileMetrics } from './admin-metrics';

const PAGE = 1000;

export type ProfileStatsStatus = 'ok' | 'no_service_role' | 'schema_missing' | 'activity_missing' | 'failed';

export async function loadProfileMetrics(now: Date = new Date()): Promise<{ status: ProfileStatsStatus; message: string | null; metrics: ProfileMetrics | null }> {
  if (!hasServiceRole()) return { status: 'no_service_role', message: null, metrics: null };
  const admin = createAdminClient();
  const facts: ProfileFact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('search_profiles').select('user_id, created_at, paused_at, deleted_at').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { status: /does not exist|could not find/i.test(error.message) ? 'schema_missing' : 'failed', message: error.message, metrics: null };
    for (const r of (data ?? []) as { user_id: string; created_at: string; paused_at: string | null; deleted_at: string | null }[]) facts.push({ userId: r.user_id, createdAt: r.created_at, pausedAt: r.paused_at, deletedAt: r.deleted_at });
    if ((data?.length ?? 0) < PAGE) break;
  }
  const active = await loadWeeklyActive({ weeks: 8, now });
  if (active.status !== 'ok') return { status: 'activity_missing', message: active.message, metrics: null };
  return { status: 'ok', message: null, metrics: profileMetrics(active.report.members, facts, { now, weekEnd: (w) => ukWeekRange(w).end.getTime(), weekLabel }) };
}
