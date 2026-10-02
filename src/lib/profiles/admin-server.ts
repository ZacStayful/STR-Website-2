import 'server-only';

/**
 * What /admin/profiles reads: every saved profile row (dates only, never a
 * name: a client profile's name can identify the client) and Batch 9's
 * weekly-active drill-down, read as it is (loadWeeklyActive). Service role
 * only; the page checks the admin session first.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { loadWeeklyActive } from '../activity/admin-server';
import { ukWeekRange, ukWeekStart, weekLabel } from '../activity/week';
import { profileMetrics, type ProfileFact, type ProfileMetrics } from './admin-metrics';
import { resetMetrics, type ResetMetrics, type RestartFact } from './reset';

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

/**
 * Batch 22d: the resets panel. This UK week's Start again resets, the members
 * behind them, and how many of those Kept a deal (activity_events 'keep')
 * within 7 days after. Counts only. Null when profile_restarts cannot be read
 * (the Batch 22d section not run yet).
 */
export async function loadResetMetrics(now: Date = new Date()): Promise<{ week: string; metrics: ResetMetrics } | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const week = ukWeekStart(now);
  const range = ukWeekRange(week);
  const restarts: RestartFact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('profile_restarts')
      .select('user_id, kind, created_at')
      .eq('kind', 'reset')
      .gte('created_at', range.start.toISOString())
      .lt('created_at', range.end.toISOString())
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn('[profiles] resets unreadable (schema behind?):', error.message);
      return null;
    }
    for (const r of (data ?? []) as { user_id: string; kind: 'reset' | 'blank'; created_at: string }[]) restarts.push({ userId: r.user_id, kind: r.kind, createdAt: r.created_at });
    if ((data?.length ?? 0) < PAGE) break;
  }
  const users = [...new Set(restarts.map((r) => r.userId))];
  const keeps: { userId: string; at: string }[] = [];
  const until = new Date(range.end.getTime() + 7 * 86_400_000).toISOString();
  for (let i = 0; i < users.length; i += 150) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('activity_events')
        .select('user_id, occurred_at')
        .in('user_id', users.slice(i, i + 150))
        .eq('kind', 'keep')
        .gte('occurred_at', range.start.toISOString())
        .lt('occurred_at', until)
        .order('occurred_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn('[profiles] keeps after resets unreadable:', error.message);
        break;
      }
      for (const r of (data ?? []) as { user_id: string; occurred_at: string }[]) keeps.push({ userId: r.user_id, at: r.occurred_at });
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  return { week, metrics: resetMetrics(restarts, keeps, range, now) };
}
