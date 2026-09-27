import 'server-only';

/**
 * Reads the activity log for Batch 10's figures on /admin/weekly-active
 * (take-up.ts does the sums). Service role only; the page checks the admin
 * session first. Never throws.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { emptyTakeUp, TAKE_UP_DAYS, TAKE_UP_KINDS, takeUpFigures, type TakeUpEvent, type TakeUpFigures } from './take-up';

const PAGE = 1000;
// 50,000 events in 28 days is far beyond today's volume; past it the figures say so.
const MAX_PAGES = 50;

export interface TakeUpLoad {
  status: 'ok' | 'no_service_role' | 'failed';
  figures: TakeUpFigures;
  /** More events than were read: the figures cover the most recent part only. */
  capped: boolean;
}

export async function loadTakeUp(opts: { excluded: readonly string[]; now?: Date }): Promise<TakeUpLoad> {
  const empty = { figures: emptyTakeUp(), capped: false };
  if (!hasServiceRole()) return { status: 'no_service_role', ...empty };
  const since = new Date((opts.now ?? new Date()).getTime() - TAKE_UP_DAYS * 86_400_000).toISOString();
  const admin = createAdminClient();
  const events: TakeUpEvent[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await admin
        .from('activity_events')
        .select('user_id, kind, deal_id, extras, occurred_at')
        .in('kind', [...TAKE_UP_KINDS])
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        console.error('[take-up] read failed:', error.message);
        return { status: 'failed', ...empty };
      }
      const rows = (data ?? []) as TakeUpEvent[];
      events.push(...rows);
      if (rows.length < PAGE) return { status: 'ok', figures: takeUpFigures(events, new Set(opts.excluded)), capped: false };
    }
    return { status: 'ok', figures: takeUpFigures(events, new Set(opts.excluded)), capped: true };
  } catch (err) {
    console.error('[take-up] read failed:', err instanceof Error ? err.message : err);
    return { status: 'failed', ...empty };
  }
}
