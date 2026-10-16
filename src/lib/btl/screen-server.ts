import 'server-only';

/**
 * The nightly buy-to-let screen (Batch 28, Parts A and C): the job behind
 * /api/internal/btl-screen. Every sale the feeds have shown in the last week
 * is screened for buy-to-let from data already held (the district's key
 * stats, live rentals, the cached live rate, cached EPCs); a short paid
 * shortlist gets a rent valuation and an EPC, inside its own line of Batch
 * 16's daily cap; the lens is written to each deal's row; sales that pass
 * only as buy-to-let are let in (or brought back), and buy-to-let-only rows
 * that stop passing are retired; and the benchmarks ("the typical deal in
 * their budget", per area and cash band, widening outward) are stored for
 * Today, the deal page and the standout calls. Free except the shortlist.
 *
 *   ?dry=1  everything worked out and counted (what would be written, let in,
 *           brought back and retired; what the shortlist would buy and what
 *           the day's cap has left), nothing asked that costs, nothing written
 *
 * Background work: nothing here is recorded as member activity.
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { COST_PENCE } from '../broker/config';
import { ask, pdEnergyEfficiency, pdLongLetRent, pdMortgageRates } from '../broker';
import { liveMortgageRate } from '../listing/mortgage-rate';
import { readAllRegionKeyStats } from '../market/key-stats-cache';
import { AREA_CENTROIDS } from '../market/area-centroids';
import { pdRegionForArea } from '../market/key-stats';
import { pickEpc } from '../analysis/due-diligence';
import { normalisePostcode, type EpcEntry } from '../apis/propertydata-parse';
import type { SourcedListing } from '../listing/sourcing';
import { serverFetchEnabled } from '../listing/fetch';
import { buildDealRecord, feedStatusOf, qualifiesForMarketplace } from '../marketplace/record';
import { chunk, loadScreenContext, recordColumns, revalidateDeals, writeWithoutMissing, type Admin, type ScreenContext } from '../marketplace/server';
import { nextCheckDueAt } from '../marketplace/cadence';
import { retiredReasonFor } from '../marketplace/status';
import type { RetiredReason } from '../marketplace/types';
import { ukDayStart } from '../deal-quality/checks';
import { runPool } from '../deal-quality/checks-run';
import { benchmarkFor, type BenchmarkDeal } from './benchmark';
import { CASH_BANDS, isEpcRating, type EpcRating } from './deal';
import { listingKind } from './listing';
import type { RentComp } from './rent';
import { btlOnlyBand, btlRowAction, pickShortlist, rentCompFrom, screenForBtl, valuationPropertyType, type BtlRowAction, type BtlScreen, type BtlScreenContext, type DistrictStats, type PoolRowFacts, type RentalRow, type ShortlistCandidate, type Valuation } from './screen';
import { readBtlSettings } from './settings-server';

export const BTL_SCREEN_KIND = 'btl_screen';
const SALES_MAX_AGE_DAYS = 7;
const PAGE = 1000;
const URL_CHUNK = 150;
const WRITE_CHUNK = 100;
/** Three rent attempts and an EPC, at one credit each: what one shortlisted listing can cost at worst. */
const WORST_PENCE_EACH = COST_PENCE.propertydataCall * 4;
/** Opened buy-to-let deals in this many days get their EPC looked up too (inside the cap). */
const OPENED_EPC_DAYS = 2;
const WORKERS = 4;
/** The paid part stops starting new lookups after this, so the run always writes its results. */
const PAID_BUDGET_MS = 150_000;

export interface BtlScreenOptions {
  dry: boolean;
  /** 'cron', 'internal', or the admin's email. */
  triggeredBy: string;
  now?: Date;
}

export interface BtlScreenResult {
  status: number;
  body: Record<string, unknown>;
}

interface SaleRow {
  canonical_url: string;
  snapshot: SourcedListing;
  first_seen_at: string;
}

interface PoolRow extends PoolRowFacts {
  url: string;
  /** The rent valuation its stored lens already holds (bought by an earlier run), monthly; null for none. */
  valuation: number | null;
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

async function readAll<T>(page: (from: number, to: number) => PromiseLike<Page<T>>, tag: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      console.error(`[btl-screen] ${tag} unreadable:`, error.message);
      return null;
    }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function loadSales(admin: Admin, now: Date): Promise<SaleRow[] | null> {
  const since = daysAgo(now, SALES_MAX_AGE_DAYS);
  return readAll<SaleRow>((from, to) => admin.from('sourced_listings').select('canonical_url, snapshot, first_seen_at').eq('kind', 'sale').gte('last_seen_at', since).order('canonical_url').range(from, to) as unknown as PromiseLike<Page<SaleRow>>, 'sales');
}

async function loadRentals(admin: Admin, now: Date, maxAgeDays: number): Promise<Map<string, RentComp[]> | null> {
  const since = daysAgo(now, maxAgeDays);
  const rows = await readAll<RentalRow>(
    (from, to) =>
      admin
        .from('sourced_listings')
        .select('postcode_area, price:snapshot->price, bedrooms:snapshot->bedrooms, lat:snapshot->lat, lng:snapshot->lng, raw_type:snapshot->>rawType, title:snapshot->>title')
        .eq('kind', 'rent')
        .gte('last_seen_at', since)
        .order('canonical_url')
        .range(from, to) as unknown as PromiseLike<Page<RentalRow>>,
    'rentals',
  );
  if (!rows) return null;
  const byArea = new Map<string, RentComp[]>();
  for (const r of rows) {
    const c = rentCompFrom(r);
    if (!c || !c.postcodeArea) continue;
    const list = byArea.get(c.postcodeArea) ?? [];
    list.push(c);
    byArea.set(c.postcodeArea, list);
  }
  return byArea;
}

async function loadDistricts(): Promise<Map<string, DistrictStats>> {
  const out = new Map<string, DistrictStats>();
  try {
    for (const [region, stats] of await readAllRegionKeyStats()) {
      for (const row of stats.rows) if (row.outcode && !out.has(row.outcode.toUpperCase())) out.set(row.outcode.toUpperCase(), { row, region, asOf: stats.asOf });
    }
  } catch (err) {
    console.warn('[btl-screen] key stats unreadable:', (err as Error)?.message ?? err);
  }
  return out;
}

/** The pool rows for these listings; null when the Batch 28 columns are not there yet (the schema section not run). */
async function loadPoolRows(admin: Admin, urls: readonly string[]): Promise<Map<string, PoolRow> | null> {
  const out = new Map<string, PoolRow>();
  for (const some of chunk([...urls], URL_CHUNK)) {
    const { data, error } = await admin.from('marketplace_deals').select('canonical_url, status, band, retired_reason, btl_pass, project, valuation:btl->rent->valuation').in('canonical_url', some);
    if (error) {
      console.error('[btl-screen] pool rows unreadable (Batch 28 schema section not run?):', error.message);
      return null;
    }
    for (const r of (data ?? []) as { canonical_url: string; status: PoolRow['status']; band: string; retired_reason: RetiredReason | null; project: unknown; valuation: unknown }[]) {
      const valuation = typeof r.valuation === 'number' && Number.isFinite(r.valuation) && r.valuation > 0 ? r.valuation : null;
      out.set(r.canonical_url, { url: r.canonical_url, status: r.status, band: r.band, project: r.project !== null && r.project !== undefined, retiredReason: r.retired_reason, valuation });
    }
  }
  return out;
}

/** EPC ratings already in the broker's cache (free), matched to each listing's own address. */
async function cachedEpcs(admin: Admin, sales: readonly SourcedListing[]): Promise<Map<string, EpcRating>> {
  const out = new Map<string, EpcRating>();
  const byPostcode = new Map<string, SourcedListing[]>();
  for (const l of sales) {
    if (!l.postcode || !l.address) continue;
    const key = normalisePostcode(l.postcode);
    byPostcode.set(key, [...(byPostcode.get(key) ?? []), l]);
  }
  for (const some of chunk([...byPostcode.keys()], URL_CHUNK)) {
    const { data, error } = await admin.from('broker_cache').select('key, value').eq('question', 'pdEnergyEfficiency').in('key', some);
    if (error) {
      console.warn('[btl-screen] EPC cache unreadable:', error.message);
      return out;
    }
    for (const r of (data ?? []) as { key: string; value: unknown }[]) {
      const entries = Array.isArray(r.value) ? (r.value as EpcEntry[]) : null;
      for (const l of byPostcode.get(r.key) ?? []) {
        const rating = pickEpc(entries, l.address ?? '')?.rating;
        if (isEpcRating(rating)) out.set(l.canonicalUrl, rating);
      }
    }
  }
  return out;
}

/** Postcode areas where a profile chose buy-to-let: their shortlist comes first. */
async function wantedAreas(admin: Admin): Promise<Set<string>> {
  const { data, error } = await admin.from('search_profiles').select('areas').is('deleted_at', null).contains('criteria', { dealTypes: ['btl'] }).limit(5000);
  if (error) return new Set();
  const out = new Set<string>();
  for (const r of (data ?? []) as { areas: string[] | null }[]) for (const a of r.areas ?? []) out.add(a.toUpperCase());
  return out;
}

/** What the meter recorded under one action, exact pence (whole pence before Batch 16's raw_pence); null when unreadable. */
async function meteredPence(admin: Admin, actionId: string): Promise<number | null> {
  type Row = { raw_pence?: unknown; cost_pence?: unknown };
  const read = (columns: string) => admin.from('provider_calls').select(columns).eq('action_id', actionId).eq('cache_hit', false);
  let res = await read('raw_pence, cost_pence');
  if (res.error && /raw_pence/.test(res.error.message)) res = await read('cost_pence');
  if (res.error) {
    console.warn('[btl-screen] metered spend unreadable:', res.error.message);
    return null;
  }
  return ((res.data ?? []) as unknown as Row[]).reduce((sum, r) => sum + (Number(r.raw_pence ?? r.cost_pence) || 0), 0);
}

/** Today's spend and valuations on this line (UK day), from the runs' own records; unreadable reads as the whole cap spent. */
export async function dayUse(admin: Admin, dayStart: Date): Promise<{ pence: number; valuations: number }> {
  const { data, error } = await admin.from('marketplace_runs').select('summary').eq('kind', BTL_SCREEN_KIND).eq('dry', false).gte('started_at', dayStart.toISOString()).limit(200);
  if (error) return { pence: Number.POSITIVE_INFINITY, valuations: Number.POSITIVE_INFINITY };
  let pence = 0;
  let valuations = 0;
  for (const r of (data ?? []) as { summary: { rawCostPence?: unknown; valuations?: unknown } | null }[]) {
    pence += Number(r.summary?.rawCostPence ?? 0) || 0;
    valuations += Number(r.summary?.valuations ?? 0) || 0;
  }
  return { pence, valuations };
}

/** Deals opened in the last days whose buy-to-let lens has no EPC yet. */
async function openedWithoutEpc(admin: Admin, now: Date, epcs: Map<string, EpcRating>): Promise<string[]> {
  const { data, error } = await admin.from('deal_opens').select('canonical_url').eq('status', 'open').gte('opened_at', daysAgo(now, OPENED_EPC_DAYS)).limit(500);
  if (error) return [];
  const urls = [...new Set(((data ?? []) as { canonical_url: string }[]).map((r) => r.canonical_url))].filter((u) => !epcs.has(u));
  if (urls.length === 0) return [];
  const { data: rows } = await admin.from('marketplace_deals').select('canonical_url').in('canonical_url', urls.slice(0, URL_CHUNK)).eq('btl_pass', true);
  return ((rows ?? []) as { canonical_url: string }[]).map((r) => r.canonical_url);
}

function count<K extends string>(into: Partial<Record<K, number>>, key: K): void {
  into[key] = (into[key] ?? 0) + 1;
}

export async function runBtlScreen(opts: BtlScreenOptions): Promise<BtlScreenResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const { settings, buyingCosts } = await readBtlSettings(admin);
  const [sales, rentals, districts, rates, wanted] = await Promise.all([
    loadSales(admin, now),
    loadRentals(admin, now, settings.rent.compsMaxAgeDays),
    loadDistricts(),
    ask(pdMortgageRates, {}, { mode: 'cron', cacheOnly: true }),
    wantedAreas(admin),
  ]);
  if (!sales || !rentals) return { status: 500, body: { error: 'listings unreadable' } };
  const live = liveMortgageRate(rates.value);
  const listings = sales.map((r) => ({ ...r.snapshot, canonicalUrl: r.canonical_url }) as SourcedListing);
  const byUrl = new Map(listings.map((l) => [l.canonicalUrl, l]));
  const firstSeen = new Map(sales.map((r) => [r.canonical_url, r.first_seen_at]));
  const pool = await loadPoolRows(admin, listings.map((l) => l.canonicalUrl));
  if (!pool) return { status: 503, body: { error: 'marketplace_deals has no buy-to-let columns yet: run the "Batch 28: buy-to-let" section of supabase/schema.sql' } };
  const epcs = await cachedEpcs(admin, listings);
  // A valuation an earlier run bought stays with the deal (rent does not move with the price), so a later run
  // never rewrites its lens without it, and it is never bought twice.
  const valuations = new Map<string, Valuation>();
  for (const row of pool.values()) if (row.valuation !== null) valuations.set(row.url, { monthly: row.valuation });

  const ctx: BtlScreenContext = {
    settings,
    buyingCosts,
    ratePct: live?.ratePct ?? null,
    rateDate: live?.date ?? null,
    district: (oc) => (oc ? (districts.get(oc) ?? null) : null),
    rentals: (area) => (area ? (rentals.get(area) ?? []) : []),
    epc: (url) => epcs.get(url) ?? null,
    valuation: (url) => valuations.get(url) ?? null,
    now,
  };
  const screens = new Map<string, BtlScreen>(listings.map((l) => [l.canonicalUrl, screenForBtl(l, ctx)]));

  // ── The paid shortlist: rent valuations and EPCs, inside the day's line ──
  const dayStart = ukDayStart(now);
  const used = await dayUse(admin, dayStart);
  const allowance = settings.allowance;
  const valuationsLeft = Math.max(0, allowance.valuations - used.valuations);
  const candidates: ShortlistCandidate[] = [];
  for (const sc of screens.values()) {
    const l = byUrl.get(sc.url);
    if (!sc.card || !l) continue;
    candidates.push({ url: sc.url, postcode: l.postcode, postcodeArea: l.postcodeArea, card: sc.card, valued: sc.card.rent.valuation !== null });
  }
  const pencesLeft = Math.max(0, allowance.capPence - used.pence);
  const affordable = Math.floor(pencesLeft / WORST_PENCE_EACH);
  const shortlist = pickShortlist(candidates, wanted, Math.min(valuationsLeft, affordable));
  const openedEpcs = (await openedWithoutEpc(admin, now, epcs)).slice(0, Math.max(0, Math.floor((pencesLeft - shortlist.length * WORST_PENCE_EACH) / COST_PENCE.propertydataCall)));
  let spentPence = 0;
  let bought = 0;
  let epcsBought = 0;
  let runId: string | null = null;
  if (!opts.dry && (shortlist.length > 0 || openedEpcs.length > 0)) {
    // On the record with its worst case before anything is spent, so an overlapping run cannot spend the same cap.
    const worst = shortlist.length * WORST_PENCE_EACH + openedEpcs.length * COST_PENCE.propertydataCall;
    const { data, error } = await admin.from('marketplace_runs').insert({ kind: BTL_SCREEN_KIND, dry: false, started_at: now.toISOString(), finished_at: null, summary: { rawCostPence: worst, valuations: shortlist.length, open: true } }).select('id').single();
    if (error) console.error('[btl-screen] run open failed:', error.message);
    else runId = (data?.id as string | undefined) ?? null;
    if (runId) {
      const actionId = newActionId();
      const timeLeft = () => Date.now() - started < PAID_BUDGET_MS;
      await runMetered({ userId: null, admin: false, action: 'btl_shortlist', actionId }, async () => {
        await runPool(shortlist, WORKERS, () => !timeLeft(), async (c) => {
          const l = byUrl.get(c.url);
          if (!l?.postcode || l.bedrooms === null) return;
          const r = await ask(pdLongLetRent, { postcode: l.postcode, bedrooms: l.bedrooms, options: { propertyType: valuationPropertyType(l.rawType, listingKind(l)) }, maxAttempts: 3 }, { mode: 'cron' });
          bought += 1;
          if (r.value) {
            valuations.set(c.url, { monthly: r.value.monthlyRent });
            if (!r.cached) spentPence += COST_PENCE.propertydataCall;
          }
          if (!epcs.has(c.url) && l.address) {
            const e = await ask(pdEnergyEfficiency, { postcode: l.postcode }, { mode: 'cron' });
            const rating = pickEpc(e.value, l.address)?.rating;
            if (isEpcRating(rating)) epcs.set(c.url, rating);
            if (e.value && !e.cached) {
              spentPence += COST_PENCE.propertydataCall;
              epcsBought += 1;
            }
          }
        });
        // Opened buy-to-let deals: their EPC, so the deal page can warn (the open read their page, so the address is ours).
        const { data: rows } = openedEpcs.length > 0 ? await admin.from('sourced_listings').select('canonical_url, snapshot').in('canonical_url', openedEpcs) : { data: [] };
        await runPool((rows ?? []) as { canonical_url: string; snapshot: SourcedListing }[], WORKERS, () => !timeLeft(), async (row) => {
          const l = row.snapshot;
          if (!l?.postcode || !l.address) return;
          const e = await ask(pdEnergyEfficiency, { postcode: l.postcode }, { mode: 'cron' });
          const rating = pickEpc(e.value, l.address)?.rating;
          if (isEpcRating(rating)) epcs.set(row.canonical_url, rating);
          if (e.value && !e.cached) {
            spentPence += COST_PENCE.propertydataCall;
            epcsBought += 1;
          }
        });
      });
      // What the meter recorded for this run is what it cost (every charged attempt, not just the answered ones);
      // the line's next run reads it from this run's record.
      const metered = await meteredPence(admin, actionId);
      if (metered !== null) spentPence = Math.max(spentPence, metered);
      // The shortlist re-screened on what was bought.
      for (const c of shortlist) {
        const l = byUrl.get(c.url);
        if (l) screens.set(c.url, screenForBtl(l, ctx));
      }
    }
  }

  // ── What each row needs ──
  const actions: Partial<Record<BtlRowAction, number>> = {};
  const unsuitable: Partial<Record<string, number>> = {};
  const passByBand: Partial<Record<string, number>> = {};
  const confidence: Partial<Record<string, number>> = {};
  const lens: { canonical_url: string; btl: unknown; pass: boolean }[] = [];
  const revive: PoolRow[] = [];
  const retire: string[] = [];
  const insertCandidates: SourcedListing[] = [];
  let withFigure = 0;
  let passing = 0;
  for (const sc of screens.values()) {
    const l = byUrl.get(sc.url) as SourcedListing;
    if (sc.suitability !== 'ok') count(unsuitable, sc.suitability);
    if (sc.card) {
      withFigure += 1;
      count(confidence, sc.card.rent.confidence);
    }
    if (sc.pass) {
      passing += 1;
      if (sc.card?.band) count(passByBand, sc.card.band);
    }
    const row = pool.get(sc.url) ?? null;
    const feedGone = retiredReasonFor(feedStatusOf(l)) !== null;
    if (!row) {
      // Whether it would qualify as a short let is only worked out for a listing that might be let in.
      if (sc.pass && !feedGone) insertCandidates.push(l);
      continue;
    }
    const action = btlRowAction(row, sc.pass, false, feedGone);
    count(actions, action);
    if (action === 'skip') continue;
    lens.push({ canonical_url: sc.url, btl: sc.card, pass: sc.pass });
    if (action === 'revive') revive.push(row);
    if (action === 'retire') retire.push(sc.url);
  }

  // A listing with no row is let in only if it would not qualify as a short let (that one is the short-let intake's).
  let screenCtx: ScreenContext | null = null;
  const inserts: Record<string, unknown>[] = [];
  if (insertCandidates.length > 0) screenCtx = await loadScreenContext();
  for (const l of insertCandidates) {
    if (!screenCtx) break;
    const card = (l.postcodeArea ? screenCtx.cardByCode.get(l.postcodeArea) : null) ?? null;
    const rec = buildDealRecord(l, { card, rentTable: screenCtx.rentTable, r2rBar: screenCtx.r2rBar, rules: screenCtx.rules, check: null, firstSeenAt: firstSeen.get(l.canonicalUrl) ?? now.toISOString(), cohort: null, now });
    const action = btlRowAction(null, true, qualifiesForMarketplace(rec), false);
    count(actions, action);
    if (action !== 'insert') continue;
    const sc = screens.get(l.canonicalUrl) as BtlScreen;
    const fetchable = serverFetchEnabled(l.source);
    const stamp = now.toISOString();
    inserts.push({
      canonical_url: l.canonicalUrl,
      ...recordColumns(l, rec),
      band: btlOnlyBand(rec.band),
      photos: l.photo ? [l.photo] : null,
      // Read once before it goes live, as every newcomer is; Zoopla is never fetched.
      status: fetchable ? 'pending_verify' : 'live',
      first_seen_at: firstSeen.get(l.canonicalUrl) ?? stamp,
      last_seen_at: stamp,
      last_confirmed_at: stamp,
      last_confirmed_via: 'feed',
      next_check_due_at: fetchable ? stamp : nextCheckDueAt(l.kind, rec.annualProfit, now),
      created_at: stamp,
      updated_at: stamp,
      btl: sc.card,
      btl_pass: true,
      btl_screened_at: stamp,
    });
  }

  // ── Benchmarks: every postcode area's centre × every cash band ──
  const benchDeals = [...screens.values()].map((sc) => sc.benchmark).filter((b): b is BenchmarkDeal => b !== null);
  const computedAt = now.toISOString();
  const benchmarks = Object.entries(AREA_CENTROIDS).flatMap(([area, c]) =>
    CASH_BANDS.map((band) => {
      const b = benchmarkFor(benchDeals, { lat: c.lat, lng: c.lng, region: pdRegionForArea(area) }, band, settings.benchmark);
      return { area_code: area, band, step: b.step, radius_miles: b.radiusMiles, deal_count: b.count, roi_median: b.roiMedianPct, roi_p40: b.roiP40Pct, growth_median: b.growthMedianPct, growth_p40: b.growthP40Pct, thin: b.thin, no_compare: b.none, steps: b.steps, computed_at: computedAt };
    }),
  );

  const summary: Record<string, unknown> = {
    triggeredBy: opts.triggeredBy,
    dry: opts.dry,
    rate: live ? { ratePct: live.ratePct, product: live.product, date: live.date } : null,
    screened: screens.size,
    unsuitable,
    withFigure,
    passing,
    passByBand,
    confidence,
    rows: actions,
    inserts: inserts.length,
    revive: revive.length,
    retire: retire.length,
    benchmarks: benchmarks.length,
    shortlist: { picked: shortlist.length, valuationsLeft, capPence: allowance.capPence, spentBeforePence: Number.isFinite(used.pence) ? Math.round(used.pence * 100) / 100 : null, openedEpcs: openedEpcs.length },
  };

  if (opts.dry) {
    // Never an address: the area, size and why it was picked.
    summary.wouldBuy = shortlist.map((c) => ({ outcode: c.card.outcode, bedrooms: c.card.bedrooms, lowCashflow: c.card.cashflowMonthly.low, confidence: c.card.rent.confidence }));
    summary.ms = Date.now() - started;
    console.log('[btl-screen] dry run', JSON.stringify(summary));
    return { status: 200, body: summary };
  }

  // ── Writes ──
  let written = 0;
  for (const some of chunk(lens, WRITE_CHUNK)) {
    const { data, error } = await admin.rpc('btl_apply_screen', { p_rows: some });
    if (error) console.error('[btl-screen] lens write failed:', error.message);
    else written += Number(data ?? 0);
  }
  const stamp = now.toISOString();
  let revived = 0;
  for (const row of revive) {
    const l = byUrl.get(row.url);
    if (!l) continue;
    const fetchable = serverFetchEnabled(l.source);
    const { error, count: n } = await admin
      .from('marketplace_deals')
      .update({ status: fetchable ? 'pending_verify' : 'live', retired_reason: null, retired_at: null, band: btlOnlyBand(row.band), last_seen_at: stamp, last_confirmed_at: stamp, last_confirmed_via: 'feed', next_check_due_at: stamp, check_failures: 0, updated_at: stamp }, { count: 'exact' })
      .eq('canonical_url', row.url)
      .eq('status', 'retired');
    if (error) console.error('[btl-screen] revive failed:', error.message);
    else revived += n ?? 0;
  }
  let retired = 0;
  for (const some of chunk(retire, URL_CHUNK)) {
    // Only a row that is a buy-to-let deal and nothing else: a short-let or BRRR row is never retired here.
    const { error, count: n } = await admin
      .from('marketplace_deals')
      .update({ status: 'retired', retired_reason: 'unqualified', retired_at: stamp, next_check_due_at: null, check_requested_at: null, updated_at: stamp }, { count: 'exact' })
      .in('canonical_url', some)
      .neq('status', 'retired')
      .neq('band', 'qualified')
      .is('project', null)
      .eq('btl_pass', false);
    if (error) console.error('[btl-screen] retire failed:', error.message);
    else retired += n ?? 0;
  }
  let inserted = 0;
  if (inserts.length > 0) {
    const { data, error } = await writeWithoutMissing(inserts, (rows) => admin.from('marketplace_deals').upsert(rows, { onConflict: 'canonical_url', ignoreDuplicates: true }).select('canonical_url'), 'btl-screen');
    if (error) console.error('[btl-screen] insert failed:', error.message);
    else inserted = data?.length ?? 0;
  }
  for (const some of chunk(benchmarks, 200)) {
    const { error } = await admin.from('btl_benchmarks').upsert(some, { onConflict: 'area_code,band' });
    if (error) {
      console.error('[btl-screen] benchmarks write failed:', error.message);
      break;
    }
  }
  if (revived + retired + inserted > 0) revalidateDeals();

  Object.assign(summary, { written, revived, retired, inserted, valuations: bought, epcsBought, rawCostPence: Math.round(spentPence * 100) / 100, ms: Date.now() - started });
  if (runId) {
    const { error } = await admin.from('marketplace_runs').update({ finished_at: new Date().toISOString(), summary }).eq('id', runId);
    if (error) console.error('[btl-screen] run close failed:', error.message);
  } else {
    const { error } = await admin.from('marketplace_runs').insert({ kind: BTL_SCREEN_KIND, dry: false, started_at: now.toISOString(), finished_at: new Date().toISOString(), summary });
    if (error) console.error('[btl-screen] run record failed:', error.message);
  }
  console.log('[btl-screen] run', JSON.stringify(summary));
  return { status: 200, body: summary };
}
