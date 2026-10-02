import 'server-only';

/**
 * What /admin/weekly-active (and the headline on /admin) reads and changes:
 *
 *   loadWeeklyActive     the figures: one call to activity_weekly_facts, the
 *                        sums in metrics.ts
 *   setMetricsExclusion  the "Exclude from metrics" switch
 *   runBackfill          copy older history into the log (dry run first)
 *   runRetention         count, or delete, what is older than 24 months
 *
 * Service role only. Every caller checks the admin session first; nothing
 * here does. Nothing here charges or changes credit.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { COUNTED_KINDS, QUALIFYING_KINDS } from './kinds';
import { computeWeeklyActive, emptyFacts, type WeeklyActiveReport, type WeeklyFacts } from './metrics';
import { retentionCutoff, ukDay, ukWeekStart } from './week';
import { homeKeepsActive, homeOnlyWeeks, type HomeOnlyWeek } from './home-only';
import { getBillingSettings } from '../credit/unit-costs';

/**
 * 'ok', or why the page shows empty figures: no service role key, the Batch 9
 * section of supabase/schema.sql not run yet, or the read failed.
 */
export type WeeklyActiveStatus = 'ok' | 'no_service_role' | 'schema_missing' | 'failed';

export interface WeeklyActiveLoad {
  status: WeeklyActiveStatus;
  /** The database's own words when the read failed; for admins only. */
  message: string | null;
  report: WeeklyActiveReport;
}

/** The Batch 9 functions or tables are not there (schema not run, or PostgREST not reloaded). */
function schemaMissing(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || /could not find the function|does not exist/i.test(error.message ?? '');
}

/** The weekly-active figures for the `weeks` weeks up to and including this one. Never throws. */
export async function loadWeeklyActive(opts: { weeks?: number; now?: Date } = {}): Promise<WeeklyActiveLoad> {
  const now = opts.now ?? new Date();
  const weeks = opts.weeks ?? 12;
  const admins = adminEmails();
  const empty = () => computeWeeklyActive(emptyFacts(now, ukWeekStart(now), weeks), { adminEmails: admins });
  if (!hasServiceRole()) return { status: 'no_service_role', message: null, report: empty() };
  try {
    const { data, error } = await createAdminClient().rpc('activity_weekly_facts', {
      p: { weeks, now: now.toISOString(), qualifying: QUALIFYING_KINDS, counted: COUNTED_KINDS },
    });
    if (error) {
      if (!schemaMissing(error)) console.error('[activity] weekly facts failed:', error.message);
      return { status: schemaMissing(error) ? 'schema_missing' : 'failed', message: error.message, report: empty() };
    }
    return { status: 'ok', message: null, report: computeWeeklyActive(data as WeeklyFacts, { adminEmails: admins }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[activity] weekly facts failed:', message);
    return { status: 'failed', message, report: empty() };
  }
}

export interface HomeOnlyLoad {
  /** Per week (oldest first): members active only because they looked at Home. */
  weeks: HomeOnlyWeek[];
  /** Members Home visits alone keep out of the 14-day quiet, and out of the 25-day picks pause, tonight. */
  quiet: number;
  paused: number;
  /** False until billing_settings.inactivity_from is set: then no one is quiet either way. */
  rulesOn: boolean;
}

/**
 * Batch 22e: what home_view (login lands on Home) does to the figures. The
 * weekly facts once more without it, and each counted member's latest Home
 * view against their latest other action. Null on any failure: the page
 * leaves the section out.
 */
export async function loadHomeOnly(report: WeeklyActiveReport, opts: { weeks?: number; now?: Date } = {}): Promise<HomeOnlyLoad | null> {
  if (!hasServiceRole()) return null;
  const now = opts.now ?? new Date();
  const weeks = opts.weeks ?? 12;
  try {
    const admin = createAdminClient();
    const without = QUALIFYING_KINDS.filter((k) => k !== 'home_view');
    const { data, error } = await admin.rpc('activity_weekly_facts', { p: { weeks, now: now.toISOString(), qualifying: without, counted: COUNTED_KINDS } });
    if (error) throw new Error(error.message);
    const withoutReport = computeWeeklyActive(data as WeeklyFacts, { adminEmails: adminEmails() });

    const settings = (await getBillingSettings()).lifecycle;
    const ids = report.members.map((m) => m.id);
    const lastHome = new Map<string, string>();
    const lastOther = new Map<string, string>();
    const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    for (let i = 0; i < ids.length; i += 200) {
      for (let from = 0; ; from += 1000) {
        const { data: rows, error: e } = await admin.from('activity_events').select('user_id, kind, occurred_at').in('user_id', ids.slice(i, i + 200)).in('kind', QUALIFYING_KINDS).gte('occurred_at', since).order('occurred_at', { ascending: true }).range(from, from + 999);
        if (e) throw new Error(e.message);
        for (const r of (rows ?? []) as { user_id: string; kind: string; occurred_at: string }[]) (r.kind === 'home_view' ? lastHome : lastOther).set(r.user_id, ukDay(new Date(r.occurred_at)));
        if ((rows?.length ?? 0) < 1000) break;
      }
    }
    let quiet = 0;
    let paused = 0;
    for (const m of report.members) {
      // Members on a plan (paying or paused) are never quiet (inactivity/rules.ts inactivityEligible).
      const eligible = m.category === 'never_paid' || m.category === 'cancelled';
      const keeps = homeKeepsActive({ lastHomeDay: lastHome.get(m.id) ?? null, lastOtherDay: lastOther.get(m.id) ?? null, createdAt: m.joined, eligible }, settings, now);
      if (keeps.quiet) quiet += 1;
      if (keeps.paused) paused += 1;
    }
    return { weeks: homeOnlyWeeks(report.weeks, withoutReport.weeks), quiet, paused, rulesOn: Boolean(settings.inactivityFrom) };
  } catch (err) {
    console.error('[activity] home-only figures failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Switches one account out of (or back into) every weekly-active figure.
 * `by` is the admin who did it, for the record. True when saved.
 */
export async function setMetricsExclusion(input: { userId: string; exclude: boolean; by: string | null; reason?: string | null }): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const table = createAdminClient().from('activity_excluded_accounts');
  const { error } = input.exclude
    ? await table.upsert({ user_id: input.userId, reason: input.reason?.trim().slice(0, 200) || null, added_by: input.by, added_at: new Date().toISOString() }, { onConflict: 'user_id' })
    : await table.delete().eq('user_id', input.userId);
  if (error) console.error('[activity] exclusion not saved:', error.message);
  return !error;
}

export interface BackfillResult {
  dry: boolean;
  /** 'not_live': the real run waits until something has been logged live in production. */
  error: 'not_live' | null;
  /** History is copied from before this moment only. */
  cutoff: string | null;
  /** Whether the cutoff is stored for good (it is from the first real run on). */
  cutoffFixed: boolean;
  /** Nothing older than this is copied: the 24 months the log keeps. */
  floor: string | null;
  /** Per source table: rows found, and how many of those are not in the log yet. */
  sources: { table: string; found: number; fresh: number }[];
  inserted: number;
}

export type RunOutcome<T> = { ok: true; result: T } | { ok: false; message: string };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** The backfill: `apply` false only counts. Safe to run any number of times (see the SQL). */
export async function runBackfill(apply: boolean): Promise<RunOutcome<BackfillResult>> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not configured.' };
  try {
    const { data, error } = await createAdminClient().rpc('activity_backfill', { p: { apply } });
    if (error) return { ok: false, message: schemaMissing(error) ? 'The Batch 9 section of supabase/schema.sql has not been run.' : error.message };
    const r = (data ?? {}) as Record<string, unknown>;
    const sources = Object.entries((r.sources ?? {}) as Record<string, { found?: unknown; new?: unknown }>)
      .map(([table, v]) => ({ table, found: num(v?.found), fresh: num(v?.new) }))
      .sort((a, b) => a.table.localeCompare(b.table));
    return {
      ok: true,
      result: {
        dry: r.dry !== false,
        error: r.error === 'not_live' ? 'not_live' : null,
        cutoff: typeof r.cutoff === 'string' ? r.cutoff : null,
        cutoffFixed: r.cutoff_fixed === true,
        floor: typeof r.floor === 'string' ? r.floor : null,
        sources,
        inserted: num(r.inserted),
      },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export interface RetentionResult {
  dry: boolean;
  before: string;
  events: number;
  visits: number;
  /** After a real run: rows older than the cutoff are still left (the next run takes them). */
  more: boolean;
}

/** Counts (`apply` false) or deletes events and visits older than 24 months. */
export async function runRetention(opts: { apply: boolean; now?: Date; limit?: number }): Promise<RunOutcome<RetentionResult>> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not configured.' };
  const before = retentionCutoff(opts.now ?? new Date()).toISOString();
  try {
    const { data, error } = await createAdminClient().rpc('activity_retention', { p: { apply: opts.apply, before, ...(opts.limit ? { limit: opts.limit } : {}) } });
    if (error) return { ok: false, message: schemaMissing(error) ? 'The Batch 9 section of supabase/schema.sql has not been run.' : error.message };
    const r = (data ?? {}) as Record<string, unknown>;
    return { ok: true, result: { dry: r.dry !== false, before: typeof r.before === 'string' ? r.before : before, events: num(r.events), visits: num(r.visits), more: r.more === true } };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
