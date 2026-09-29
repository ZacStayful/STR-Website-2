import 'server-only';

/**
 * The one-off interest-only backfill (Batch 16b; the rules are in
 * mortgage-backfill.ts). Every stored purchase deal that is not yet at the
 * current mortgage type is rewritten in place: marketplace_deals.deal,
 * sourcing_sent.deal (the picks) and checked_listings.deal with its
 * quick_estimate.deal (the Explorer). Nothing else on a row is touched: not
 * cash needed, the screening, the band or the stream, and never a row's
 * updated_at (it orders the Explorer and the team pipeline). Entry points:
 * /api/internal/mortgage-backfill (secret-gated, ?dry=1) and the
 * /admin/deals buttons. No network, no spend. A run stops inside ~45
 * seconds; pressing it again carries on. Idempotent: a rewritten row is
 * never selected again, so a second run finds nothing.
 *
 * The dry run is the before/after report: rows to change per table, the
 * live sale deals on the repayment formula and on interest-only (cash flow
 * and Batch 14's profit check at each minimum in force), and five worked
 * examples. It writes nothing. Every run is recorded in marketplace_runs
 * (kind 'mortgage_backfill', with who ran it).
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { parseMarketGoals } from '../market/goals';
import { TAILORING } from '../tailoring/config';
import type { QuickEstimate } from './quick-types';
import { exampleLine, liveSaleReport, MORTGAGE_BACKFILL_KIND, refreshedDeal, workedExamples, type LiveSaleRow } from './mortgage-backfill';

type Admin = ReturnType<typeof createAdminClient>;

const TIME_BUDGET_MS = 45_000;
const PAGE = 500;
const WORKERS = 4;

export interface MortgageBackfillResult {
  status: number;
  body: Record<string, unknown>;
}

interface Pending<K> {
  key: K;
  deal: unknown;
  quick?: QuickEstimate | null;
}

/** Every row of `table` whose purchase deal has no mortgage type yet, paged; null when unreadable. */
async function loadPending<K>(admin: Admin, table: string, columns: string, keyOf: (r: Record<string, unknown>) => K, order: string): Promise<Pending<K>[] | null> {
  const out: Pending<K>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns).eq('deal->>kind', 'purchase').is('deal->>mortgageType', null).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.error(`[mortgage-backfill] ${table} unreadable:`, error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of rows) out.push({ key: keyOf(r), deal: r.deal, quick: (r.quick_estimate as QuickEstimate | null | undefined) ?? null });
    if (rows.length < PAGE) return out;
  }
}

/** The live sale deals for the report: area, size, confidence and the stored deal; no address, no link. */
async function loadLiveSale(admin: Admin): Promise<LiveSaleRow[] | null> {
  const out: LiveSaleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('marketplace_deals')
      .select('canonical_url, postcode_area, bedrooms, confidence:screening->>confidence, deal')
      .eq('status', 'live')
      .eq('kind', 'sale')
      .eq('deal->>kind', 'purchase')
      .order('canonical_url', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[mortgage-backfill] live deals unreadable:', error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as { postcode_area: string | null; bedrooms: number | null; confidence: string | null; deal: unknown }[];
    for (const r of rows) out.push({ area: r.postcode_area, bedrooms: r.bedrooms, confidence: r.confidence, deal: r.deal });
    if (rows.length < PAGE) return out;
  }
}

/** The £500 default plus every minimum a member has set, each once. */
async function loadMinimums(admin: Admin): Promise<number[]> {
  const mins = new Set<number>([TAILORING.fallbackMinProfitPcm]);
  const { data, error } = await admin.from('profiles').select('market_goals').not('market_goals', 'is', null).limit(5000);
  if (error) {
    console.warn('[mortgage-backfill] profiles unreadable, reporting at the default minimum only:', error.message);
    return [...mins];
  }
  for (const r of (data ?? []) as { market_goals: unknown }[]) {
    const goals = parseMarketGoals(r.market_goals);
    if (goals && Number.isFinite(goals.finance.targetMarginPcm)) mins.add(goals.finance.targetMarginPcm);
  }
  return [...mins].sort((a, b) => a - b);
}

/** Runs `fn` over `items`, WORKERS at a time, until the deadline; false when it ran out of time. */
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
  return !outOfTime;
}

async function record(admin: Admin, dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: MORTGAGE_BACKFILL_KIND, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[mortgage-backfill] run record failed:', error.message);
}

export async function runMortgageBackfill(opts: { dry: boolean; triggeredBy: string }): Promise<MortgageBackfillResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + TIME_BUDGET_MS;
  const admin = createAdminClient();

  const [deals, picks, checked, live, minimums, settings] = await Promise.all([
    loadPending<string>(admin, 'marketplace_deals', 'canonical_url, deal', (r) => String(r.canonical_url), 'canonical_url'),
    loadPending<{ userId: string; url: string }>(admin, 'sourcing_sent', 'user_id, canonical_url, deal', (r) => ({ userId: String(r.user_id), url: String(r.canonical_url) }), 'canonical_url'),
    loadPending<string>(admin, 'checked_listings', 'id, deal, quick_estimate', (r) => String(r.id), 'id'),
    loadLiveSale(admin),
    loadMinimums(admin),
    getBillingSettings(),
  ]);
  if (!deals || !picks || !checked || !live) return { status: 500, body: { error: 'rows unreadable' } };

  // Only rows whose deal actually changes are written; an older shape without the figures is left as it is.
  const dealWrites = deals.map((p) => ({ key: p.key, deal: refreshedDeal(p.deal) })).filter((w) => w.deal !== null);
  const pickWrites = picks.map((p) => ({ key: p.key, deal: refreshedDeal(p.deal) })).filter((w) => w.deal !== null);
  const checkedWrites = checked
    .map((p) => {
      const deal = refreshedDeal(p.deal);
      const quickDeal = p.quick?.deal ? (refreshedDeal(p.quick.deal) ?? p.quick.deal) : null;
      return { key: p.key, deal, quick: p.quick && quickDeal ? { ...p.quick, deal: quickDeal } : null };
    })
    .filter((w) => w.deal !== null);

  const report = liveSaleReport(live, minimums, settings.dealPricing.profitRangePct);
  const examples = workedExamples(live);
  const body: Record<string, unknown> = {
    dry: opts.dry,
    triggeredBy: opts.triggeredBy,
    toChange: { marketplace_deals: dealWrites.length, sourcing_sent: pickWrites.length, checked_listings: checkedWrites.length },
    skippedOlderShape: { marketplace_deals: deals.length - dealWrites.length, sourcing_sent: picks.length - pickWrites.length, checked_listings: checked.length - checkedWrites.length },
    minimums,
    liveSale: report,
    examples,
    examplesLine: examples.map(exampleLine).join(' | '),
  };

  if (opts.dry) {
    body.done = true;
    body.elapsedMs = Date.now() - startedAt.getTime();
    await record(admin, true, startedAt, body);
    return { status: 200, body };
  }

  const changed = { marketplace_deals: 0, sourcing_sent: 0, checked_listings: 0 };
  let failed = 0;
  const firstError: string[] = [];
  const fail = (where: string, message: string) => {
    failed += 1;
    if (firstError.length < 3) firstError.push(`${where}: ${message}`);
  };
  const finishedDeals = await pool(dealWrites, deadline, async (w) => {
    const { error } = await admin.from('marketplace_deals').update({ deal: w.deal }).eq('canonical_url', w.key);
    if (error) fail('marketplace_deals', error.message);
    else changed.marketplace_deals += 1;
  });
  const finishedPicks =
    finishedDeals &&
    (await pool(pickWrites, deadline, async (w) => {
      const { error } = await admin.from('sourcing_sent').update({ deal: w.deal }).eq('user_id', w.key.userId).eq('canonical_url', w.key.url);
      if (error) fail('sourcing_sent', error.message);
      else changed.sourcing_sent += 1;
    }));
  const finishedChecked =
    finishedPicks &&
    (await pool(checkedWrites, deadline, async (w) => {
      const update: Record<string, unknown> = { deal: w.deal };
      if (w.quick) update.quick_estimate = w.quick;
      const { error } = await admin.from('checked_listings').update(update).eq('id', w.key);
      if (error) fail('checked_listings', error.message);
      else changed.checked_listings += 1;
    }));

  body.changed = changed;
  body.failed = failed;
  if (firstError.length > 0) body.errors = firstError;
  body.done = Boolean(finishedChecked) && failed === 0;
  body.elapsedMs = Date.now() - startedAt.getTime();
  await record(admin, false, startedAt, body);
  return { status: 200, body };
}
