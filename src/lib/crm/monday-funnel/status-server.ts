import 'server-only';

import { createAdminClient, hasServiceRole } from '../../supabase/admin';
import { funnelEnabled } from './config';
import { mondayToken } from './board';

/**
 * What /admin/lifecycle shows about the Monday funnel and inactivity
 * (Batch 20): whether Monday is on, the queue, the last nightly runs, and how
 * many members are in Re-engage or have their picks paused. Anything
 * unreadable (the schema not run) reads as null.
 */
export interface FunnelStatus {
  enabled: boolean;
  token: boolean;
  queued: number | null;
  oldestQueued: string | null;
  failing: number | null;
  runs: { day: string; started_at: string | null; finished_at: string | null; inactivity_at: string | null; stats: Record<string, unknown> }[] | null;
  reengage: number | null;
  picksPaused: number | null;
}

export async function funnelStatus(): Promise<FunnelStatus> {
  const out: FunnelStatus = { enabled: funnelEnabled(), token: Boolean(mondayToken()), queued: null, oldestQueued: null, failing: null, runs: null, reengage: null, picksPaused: null };
  if (!hasServiceRole()) return out;
  const admin = createAdminClient();
  const [queue, oldest, failing, runs, reengage, paused] = await Promise.all([
    admin.from('monday_funnel_queue').select('user_id', { count: 'exact', head: true }),
    admin.from('monday_funnel_queue').select('queued_at').order('queued_at', { ascending: true }).limit(1),
    admin.from('monday_funnel_queue').select('user_id', { count: 'exact', head: true }).gt('attempts', 0),
    admin.from('monday_funnel_runs').select('day, started_at, finished_at, inactivity_at, stats').order('day', { ascending: false }).limit(5),
    admin.from('profiles').select('id', { count: 'exact', head: true }).not('reengage_since', 'is', null),
    admin.from('profiles').select('id', { count: 'exact', head: true }).not('picks_paused_inactive_at', 'is', null),
  ]);
  if (!queue.error) out.queued = queue.count ?? 0;
  if (!oldest.error) out.oldestQueued = ((oldest.data ?? [])[0] as { queued_at: string } | undefined)?.queued_at ?? null;
  if (!failing.error) out.failing = failing.count ?? 0;
  if (!runs.error) out.runs = (runs.data ?? []) as FunnelStatus['runs'];
  if (!reengage.error) out.reengage = reengage.count ?? 0;
  if (!paused.error) out.picksPaused = paused.count ?? 0;
  return out;
}
