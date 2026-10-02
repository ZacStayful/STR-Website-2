import 'server-only';

/**
 * The re-stream backfill (Batch 22c, Part A; the rules are in restream.ts).
 * Every deal still in play (live, pending_check, pending_verify) has its
 * `stream` column worked out again under the cheap-price rule; a Project
 * deal keeps its stream. Entry points: /api/internal/restream-backfill
 * (secret-gated, ?dry=1) and the /admin/deals buttons. No network, no
 * spend. Idempotent: a second run finds nothing to move.
 *
 * The dry run is the report: counts per stream before and after (every row,
 * and the live ones), and the rows that would move (id, area, bedrooms,
 * price; never an address or a URL). It writes nothing. Every run is
 * recorded in marketplace_runs (kind 'restream_backfill', with who ran it).
 */
import { createAdminClient } from '../supabase/admin';
import { readDealQualitySettings } from './settings-server';
import { movesByTarget, RESTREAM_KIND, RESTREAM_STATUSES, restreamPlan, tallyLine, type RestreamRow } from './restream';

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
/** Ids per update: keeps the request URL well inside PostgREST's limit. */
const UPDATE_CHUNK = 200;
/** Moves listed in the report. */
const SAMPLE = 40;

export interface RestreamResult {
  status: number;
  body: Record<string, unknown>;
}

async function loadRows(admin: Admin): Promise<RestreamRow[] | null> {
  const out: RestreamRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('marketplace_deals')
      .select('id, kind, status, stream, deal, postcode_area, bedrooms, price_amount')
      .in('status', [...RESTREAM_STATUSES])
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[restream] marketplace_deals unreadable:', error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as RestreamRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function recordRun(admin: Admin, dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: RESTREAM_KIND, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[restream] run record failed:', error.message);
}

export async function runRestreamBackfill(opts: { dry: boolean; triggeredBy: string }): Promise<RestreamResult> {
  const startedAt = new Date();
  const admin = createAdminClient();
  const settings = await readDealQualitySettings(admin);
  const rows = await loadRows(admin);
  if (!rows) return { status: 500, body: { error: 'marketplace_deals unreadable' } };
  const plan = restreamPlan(rows, settings.lowEntry);
  const summary: Record<string, unknown> = {
    triggeredBy: opts.triggeredBy,
    dry: opts.dry,
    cheapMaxPrice: settings.lowEntry.cheapMaxPrice,
    rows: plan.rows,
    toMove: plan.moves.length,
    live: tallyLine(plan.before.live, plan.after.live),
    all: tallyLine(plan.before.all, plan.after.all),
    before: plan.before,
    after: plan.after,
  };
  const sample = plan.moves.slice(0, SAMPLE).map((m) => `${m.id.slice(0, 8)} ${m.area ?? '?'} ${m.bedrooms ?? '?'}-bed £${m.price === null ? '?' : Math.round(m.price).toLocaleString('en-GB')} ${m.status}: ${m.from ?? 'none'} → ${m.to}`);

  if (opts.dry) {
    await recordRun(admin, true, startedAt, summary);
    return { status: 200, body: { ...summary, sample } };
  }

  let moved = 0;
  let failed = 0;
  for (const [to, ids] of Object.entries(movesByTarget(plan.moves))) {
    for (let i = 0; i < (ids ?? []).length; i += UPDATE_CHUNK) {
      const chunk = (ids ?? []).slice(i, i + UPDATE_CHUNK);
      // Never a Project deal's stream, even one that became Project since the read.
      const { data, error } = await admin.from('marketplace_deals').update({ stream: to }).in('id', chunk).or('stream.is.null,stream.neq.project').select('id');
      if (error) {
        console.error('[restream] update failed:', error.message);
        failed += chunk.length;
      } else moved += (data ?? []).length;
    }
  }
  const done = { ...summary, moved, failed };
  await recordRun(admin, false, startedAt, done);
  return { status: failed > 0 ? 500 : 200, body: { ...done, sample } };
}
