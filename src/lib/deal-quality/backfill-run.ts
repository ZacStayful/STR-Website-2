import 'server-only';

/**
 * Part D's job (the rules are in backfill.ts): the Monday backfill rows get
 * their postcode, location and comparables' figures back, and duplicates are
 * archived whole in analyser_reports_removed, then deleted. Entry points:
 * /api/internal/report-backfill (secret-gated, ?dry=1) and the /admin/demand
 * buttons. Idempotent: a row with a location is not geocoded again, a row
 * with its comparables' figures is not rewritten, and a removed row is gone.
 * A run stops inside ~45 seconds; pressing it again carries on.
 *
 * Geocoding is Google's (the codebase's own, metered at ~0.4p a postcode),
 * once per distinct postcode, as house spend. Every run is recorded in
 * marketplace_runs (kind 'report_backfill', with who ran it).
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { geocodePostcode } from '../apis/geocode';
import { getUnitCostTable } from '../credit/unit-costs';
import { unitKey } from '../credit/costs';
import { BACKFILL_SOURCE } from '../market/quality';
import { compFieldsFrom, locationFor, planRemovals, type BackfillRow, type Removal } from './backfill';

type Admin = ReturnType<typeof createAdminClient>;

const TIME_BUDGET_MS = 45_000;
const PAGE = 1000;
const WORKERS = 4;
export const BACKFILL_KIND = 'report_backfill';

interface StoredRow {
  id: string;
  created_at: string;
  address: string | null;
  postcode: string | null;
  lat: number | string | null;
  bedrooms: number | null;
  gross_revenue: number | string | null;
  adr: number | string | null;
  occupancy: number | string | null;
  comp_count: number | null;
  filename: string | null;
  raw: Record<string, unknown> | null;
}

export interface BackfillResult {
  status: number;
  body: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

async function loadRows(admin: Admin): Promise<StoredRow[] | null> {
  const out: StoredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('analyser_reports')
      .select('id, created_at, address, postcode, lat, bedrooms, gross_revenue, adr, occupancy, comp_count, filename, raw:raw_response')
      .eq('source', BACKFILL_SOURCE)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[report-backfill] rows unreadable:', error.message);
      return null;
    }
    out.push(...((data ?? []) as unknown as StoredRow[]));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

function toBackfillRow(r: StoredRow): BackfillRow {
  return {
    id: r.id,
    created_at: r.created_at,
    item: str(r.raw?.item_id),
    filename: str(r.raw?.filename) ?? r.filename,
    address: r.address ?? str(r.raw?.address),
    bedrooms: r.bedrooms,
    gross_revenue: num(r.gross_revenue),
    adr: num(r.adr),
    occupancy: num(r.occupancy),
  };
}

interface Plan {
  rows: StoredRow[];
  removals: Removal[];
  /** Survivors whose comparables' figures are still empty. */
  fill: StoredRow[];
  /** Survivors with no location yet, by the postcode they take. */
  byPostcode: Map<string, string[]>;
  skipped: { no_postcode: number; file_not_for_address: number };
}

function plan(rows: StoredRow[]): Plan {
  const removals = planRemovals(rows.map(toBackfillRow));
  const gone = new Set(removals.map((r) => r.id));
  const survivors = rows.filter((r) => !gone.has(r.id));
  const filesByItem = new Map<string, Set<string>>();
  for (const r of survivors) {
    const b = toBackfillRow(r);
    if (!b.item) continue;
    const files = filesByItem.get(b.item) ?? new Set<string>();
    files.add(b.filename ?? `row:${r.id}`);
    filesByItem.set(b.item, files);
  }
  const byPostcode = new Map<string, string[]>();
  const skipped = { no_postcode: 0, file_not_for_address: 0 };
  for (const r of survivors) {
    if (num(r.lat) !== null) continue;
    const b = toBackfillRow(r);
    const where = locationFor(b, b.item ? (filesByItem.get(b.item)?.size ?? 1) : 1);
    if ('skip' in where) skipped[where.skip] += 1;
    else byPostcode.set(where.postcode, [...(byPostcode.get(where.postcode) ?? []), r.id]);
  }
  return { rows, removals, fill: survivors.filter((r) => r.comp_count === null), byPostcode, skipped };
}

async function record(admin: Admin, dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: BACKFILL_KIND, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[report-backfill] run record failed:', error.message);
}

/** Runs `fn` over `items`, WORKERS at a time, until the deadline. */
async function pool<T>(items: T[], deadline: number, fn: (item: T) => Promise<void>): Promise<boolean> {
  const queue = [...items];
  let outOfTime = false;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (queue.length > 0) {
        if (Date.now() > deadline) {
          outOfTime = true;
          return;
        }
        await fn(queue.shift()!);
      }
    }),
  );
  return outOfTime;
}

export async function runReportBackfill(opts: { dry: boolean; triggeredBy: string }): Promise<BackfillResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + TIME_BUDGET_MS;
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const rows = await loadRows(admin);
  if (!rows) return { status: 500, body: { error: 'Could not read the backfill rows' } };
  const p = plan(rows);
  const geocodePence = (await getUnitCostTable()).get(unitKey('google', 'geocode'))?.unitCostPence ?? 0;
  const byReason = (reason: Removal['reason']) => p.removals.filter((r) => r.reason === reason).length;
  const summary = {
    rows: rows.length,
    remove: { exactDuplicates: byReason('exact_duplicate'), reanalysed: byReason('reanalysed') },
    fillCompFigures: p.fill.length,
    toLocate: [...p.byPostcode.values()].reduce((n, ids) => n + ids.length, 0),
    postcodesToGeocode: p.byPostcode.size,
    notLocated: p.skipped,
    estimatedCostPence: Math.round(p.byPostcode.size * geocodePence * 10) / 10,
    triggeredBy: opts.triggeredBy,
  };
  if (opts.dry) {
    await record(admin, true, startedAt, { dry: true, ...summary });
    return { status: 200, body: { dry: true, ...summary } };
  }

  // 1. Duplicates: archive whole, then delete only what was archived. A row a
  //    bulk job still points at is left alone.
  let removed = 0;
  let keptForBulkJob = 0;
  if (p.removals.length > 0) {
    const ids = p.removals.map((r) => r.id);
    // Batch 21 (A5): report_id lives on bulk_job_rows, not bulk_jobs (the old
    // read matched nothing, so the guard never held a report back); and a
    // failed read keeps every row rather than treating it as "none held".
    const { data: referenced, error: refErr } = await admin.from('bulk_job_rows').select('report_id').in('report_id', ids);
    if (refErr) return { status: 500, body: { error: `Could not read the bulk-job references; nothing removed: ${refErr.message}`, ...summary } };
    const held = new Set(((referenced ?? []) as { report_id: string | null }[]).flatMap((r) => (r.report_id ? [r.report_id] : [])));
    keptForBulkJob = held.size;
    const removable = p.removals.filter((r) => !held.has(r.id));
    const { data: full, error: readErr } = await admin.from('analyser_reports').select('*').in('id', removable.map((r) => r.id));
    if (readErr) return { status: 500, body: { error: 'Could not read the rows to archive', ...summary } };
    const byId = new Map(((full ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), r]));
    const archive = removable.filter((r) => byId.has(r.id)).map((r) => ({ id: r.id, reason: r.reason, kept_id: r.keptId, removed_by: opts.triggeredBy, row: byId.get(r.id) }));
    if (archive.length > 0) {
      const { error: archErr } = await admin.from('analyser_reports_removed').upsert(archive, { onConflict: 'id', ignoreDuplicates: true });
      if (archErr) {
        // Nothing is deleted without its archive: the schema section has not been run.
        return { status: 503, body: { error: `Archive failed, nothing removed: ${archErr.message}. Run the "Batch 16" section of supabase/schema.sql.`, ...summary } };
      }
      const { error: delErr, count } = await admin.from('analyser_reports').delete({ count: 'exact' }).in('id', archive.map((a) => a.id));
      if (delErr) return { status: 500, body: { error: `Archived but not deleted: ${delErr.message}`, ...summary } };
      removed = count ?? 0;
    }
  }

  // 2. The comparables' figures the PDF carried (and the file name).
  let filled = 0;
  const fillOutOfTime = await pool(p.fill, deadline, async (r) => {
    const fields = compFieldsFrom(r.raw);
    const filename = r.filename ?? str(r.raw?.filename);
    const { error } = await admin.from('analyser_reports').update({ ...fields, ...(filename ? { filename } : {}) }).eq('id', r.id).is('comp_count', null);
    if (error) console.error('[report-backfill] fill failed:', error.message);
    else filled += 1;
  });

  // 3. Locations: one geocode a postcode, house spend.
  let located = 0;
  let geocoded = 0;
  const failedPostcodes: string[] = [];
  const geoOutOfTime = fillOutOfTime
    ? true
    : await runMetered({ userId: null, admin: false, action: 'admin:report-backfill', actionId: newActionId() }, () =>
        pool([...p.byPostcode.entries()], deadline, async ([postcode, ids]) => {
          try {
            const g = await geocodePostcode(postcode);
            geocoded += 1;
            const { error, count } = await admin.from('analyser_reports').update({ postcode, lat: g.lat, lng: g.lng }, { count: 'exact' }).in('id', ids).is('lat', null);
            if (error) console.error('[report-backfill] location update failed:', error.message);
            else located += count ?? 0;
          } catch (err) {
            failedPostcodes.push(postcode);
            console.warn(`[report-backfill] ${postcode} not geocoded:`, (err as Error)?.message ?? err);
          }
        }),
      );

  const result = { ...summary, removed, keptForBulkJob, filled, geocoded, located, failedPostcodes: failedPostcodes.length, outOfTime: geoOutOfTime, ms: Date.now() - startedAt.getTime() };
  await record(admin, false, startedAt, result);
  return { status: 200, body: result };
}

export interface BackfillRuns {
  lastDry: (Record<string, unknown> & { at: string }) | null;
  lastRun: (Record<string, unknown> & { at: string }) | null;
}

/** The latest dry run and real run of the clean-up, for /admin/demand. Null when they cannot be read. */
export async function latestBackfillRuns(admin: Admin): Promise<BackfillRuns | null> {
  const { data, error } = await admin.from('marketplace_runs').select('dry, started_at, summary').eq('kind', BACKFILL_KIND).order('started_at', { ascending: false }).limit(20);
  if (error) return null;
  const rows = (data ?? []) as { dry: boolean; started_at: string; summary: Record<string, unknown> | null }[];
  const pick = (dry: boolean) => {
    const r = rows.find((x) => x.dry === dry);
    return r ? { ...(r.summary ?? {}), at: r.started_at } : null;
  };
  return { lastDry: pick(true), lastRun: pick(false) };
}
