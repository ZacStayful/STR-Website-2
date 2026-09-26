import 'server-only';

/**
 * The marketplace sweep: every top scored area, both kinds, through the same
 * broker path the daily picks use, screened into the pool.
 *
 * Runs as several short cron passes (the route is capped at 60 s and PMI
 * paces listings calls ~5 s apart). Each pass asks the broker for every
 * query in order; answers already given today come back from the cache in
 * milliseconds, so later passes finish what earlier ones started. A listing
 * seen in today's feed is confirmed live for free; one the feed marks sold
 * or let agreed is retired for free; a qualified newcomer is inserted as
 * pending_verify and the hourly recheck reads its page before it goes live.
 *
 * Entry points: /api/internal/marketplace-sweep (cron, secret-gated) and the
 * /admin/deals buttons (session-gated). MARKETPLACE_SWEEP_ENABLED=false is
 * the kill switch for the cron.
 */
import { createAdminClient } from '../supabase/admin';
import { ask, marketplaceListings } from '../broker';
import { runMetered, newActionId } from '../credit/context';
import { pmiAccount, pmiConfigured } from '../broker/providers/pmi';
import { COST_PENCE } from '../broker/config';
import { areaCentroid } from '../market/area-centroids';
import { topScoredAreas, type HouseAreaCard } from '../listing/picks';
import { queryKey, type SourcedListing, type SourcingKind, type SourcingQuery } from '../listing/sourcing';
import { fetchCohorts, sourcedPropertiesConfigured } from '../apis/propertydata-sourced';
import { indexCohorts, lookupCohorts, type CohortMember } from '../listing/cohorts';
import { buildDealRecord, feedStatusOf, qualifiesForMarketplace, type AreaCardLike } from './record';
import { retiredReasonFor } from './status';
import { nextCheckDueAt } from './cadence';
import { REACTIVATABLE_REASONS, RETURNING_REASONS, type DealRow } from './types';
import { chunk, loadDealsByUrls, loadScreenContext, priceChangeColumns, recordColumns, recordRun, retireDeal, revalidateDeals, DEAL_COLUMNS, type Admin } from './server';
import { serverFetchEnabled } from '../listing/fetch';
import type { Band } from '../listing/screen';
import type { UnsuitableReason } from '../listing/suitability';

const TIME_BUDGET_MS = 50_000;
const SNAPSHOT_WAIT_MS = 20_000;
const QUERY_BUDGET_MS = 44_000;
const COHORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COHORT_RADIUS_MILES = 10;
const COHORT_AREAS_PER_PASS = 4;
const URL_CHUNK = 150;

export function sweepEnabled(): boolean {
  return process.env.MARKETPLACE_SWEEP_ENABLED !== 'false';
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface SweepOptions {
  dry: boolean;
  maxQueries?: number;
  areas?: number;
}

export interface SweepSummary {
  dry: boolean;
  enabled: boolean;
  areas: number;
  queries: number;
  answered: number;
  cached: number;
  unavailable: number;
  listings: number;
  screened: Partial<Record<Band, number>>;
  unsuitable: Partial<Record<UnsuitableReason, number>>;
  newDeals: number;
  confirmed: number;
  repriced: number;
  retired: Partial<Record<string, number>>;
  reactivated: number;
  cohortAreas: number;
  rawCostPence: number;
  ranOutOfTime: boolean;
  ms?: number;
  [k: string]: unknown;
}

export interface SweepResult {
  status: number;
  body: SweepSummary | { error: string; detail?: string };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The searches for one pass: every top area × both kinds, unbounded. */
export function sweepQueries(cards: HouseAreaCard[], areas: number, maxQueries: number): SourcingQuery[] {
  const out: SourcingQuery[] = [];
  for (const a of topScoredAreas(cards, areas)) {
    for (const kind of ['sale', 'rent'] as SourcingKind[]) {
      out.push({ key: queryKey(kind, a.code, null, null, null), kind, area: a.code, areaName: a.name, areaSlug: a.slug, minPrice: null, maxPrice: null, minBedrooms: null });
    }
  }
  return out.slice(0, maxQueries);
}

export async function runSweep(opts: SweepOptions): Promise<SweepResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: SweepResult): SweepResult => {
    const body = result.body as Record<string, unknown>;
    const { wouldQuery: _w, ...rest } = body;
    void _w;
    console.log('[marketplace-sweep] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: 'Storage not configured' } });
  }
  const ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
  if (ctx === null) return done({ status: 503, body: { error: 'snapshot_warming', detail: 'Market snapshot still building; the next pass will use it' } });
  const areas = opts.areas ?? envInt('MARKETPLACE_SWEEP_AREAS', 60);
  const maxQueries = opts.maxQueries ?? envInt('MARKETPLACE_SWEEP_MAX_QUERIES', 120);
  const queries = sweepQueries(ctx.cards, areas, maxQueries);

  const summary: SweepSummary = {
    dry: opts.dry,
    enabled: sweepEnabled(),
    areas: new Set(queries.map((q) => q.area)).size,
    queries: queries.length,
    answered: 0,
    cached: 0,
    unavailable: 0,
    listings: 0,
    screened: {},
    unsuitable: {},
    newDeals: 0,
    confirmed: 0,
    repriced: 0,
    retired: {},
    reactivated: 0,
    cohortAreas: 0,
    rawCostPence: 0,
    ranOutOfTime: false,
  };

  if (opts.dry) {
    const account = pmiConfigured() ? await pmiAccount().catch(() => null) : null;
    return done({
      status: 200,
      body: {
        ...summary,
        estimatedRawPence: queries.length * COST_PENCE.pmiListings,
        pmi: account ? { plan: account.plan ?? null, creditsMonthly: account.credits_monthly ?? null, creditsRemaining: account.credits_remaining ?? null } : null,
        wouldQuery: queries.map((q) => q.key),
      },
    });
  }

  const cohortIndex = new Map<string, CohortMember>();
  const cohortsLoaded = new Set<string>();
  // The cohort feed for an area, from the weekly cache or a fresh (paid) read.
  const cohortsFor = async (area: string): Promise<void> => {
    if (cohortsLoaded.has(area)) return;
    cohortsLoaded.add(area);
    const { data } = await admin.from('marketplace_cohorts').select('payload, fetched_at').eq('postcode_area', area).maybeSingle();
    const fresh = data && Date.now() - new Date(String(data.fetched_at)).getTime() < COHORT_MAX_AGE_MS;
    let rows: CohortMember[] = [];
    if (fresh) {
      rows = Array.isArray(data.payload) ? (data.payload as CohortMember[]) : [];
    } else if (sourcedPropertiesConfigured() && summary.cohortAreas < COHORT_AREAS_PER_PASS) {
      const c = areaCentroid(area);
      if (!c) return;
      try {
        rows = await runMetered({ userId: null, admin: false, action: 'cron:marketplace-sweep', actionId: newActionId() }, () => fetchCohorts({ lat: c.lat, lng: c.lng }, COHORT_RADIUS_MILES));
        summary.cohortAreas += 1;
        const { error } = await admin.from('marketplace_cohorts').upsert({ postcode_area: area, payload: rows, fetched_at: nowIso() }, { onConflict: 'postcode_area' });
        if (error) console.error('[marketplace-sweep] cohort cache write failed:', error.message);
      } catch (err) {
        console.warn('[marketplace-sweep] cohort feed failed for', area, (err as Error)?.message ?? err);
      }
    }
    for (const [k, v] of indexCohorts(rows)) if (!cohortIndex.has(k)) cohortIndex.set(k, v);
  };

  for (const query of queries) {
    if (elapsed() > QUERY_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const res = await runMetered({ userId: null, admin: false, action: 'cron:marketplace-sweep', actionId: newActionId() }, () => ask(marketplaceListings, query, { mode: 'cron' }));
    if (!res.value) {
      summary.unavailable += 1;
      continue;
    }
    summary.answered += 1;
    if (res.cached) summary.cached += 1;
    summary.rawCostPence += res.costPence ?? 0;
    const listings = res.value;
    summary.listings += listings.length;
    if (listings.length === 0) continue;
    await cohortsFor(query.area);
    await absorb(admin, ctx.cardByCode, ctx.rentTable, cohortIndex, query, listings, summary);
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
  }

  summary.ms = elapsed();
  await recordRun(admin, 'sweep', false, startedAt, summary);
  revalidateDeals();
  return done({ status: 200, body: summary });
}

/** Folds one query's listings into sourced_listings and the pool. */
async function absorb(admin: Admin, cardByCode: Map<string, AreaCardLike>, rentTable: Map<string, { monthlyRent: number; samples: number }>, cohortIndex: Map<string, CohortMember>, query: SourcingQuery, listings: SourcedListing[], summary: SweepSummary): Promise<void> {
  const now = new Date();
  const stamp = now.toISOString();
  const rows = listings.map((l) => ({ canonical_url: l.canonicalUrl, source: l.source, kind: l.kind, query_key: query.key, postcode_area: l.postcodeArea ?? query.area, snapshot: l, first_seen_at: stamp, last_seen_at: stamp }));
  const { error: insErr } = await admin.from('sourced_listings').upsert(rows, { onConflict: 'canonical_url', ignoreDuplicates: true });
  if (insErr) console.error('[marketplace-sweep] sourced_listings insert failed:', insErr.message);
  const urls = rows.map((r) => r.canonical_url);
  for (const some of chunk(urls, URL_CHUNK)) {
    const { error } = await admin.from('sourced_listings').update({ last_seen_at: stamp }).in('canonical_url', some);
    if (error) console.error('[marketplace-sweep] last_seen update failed:', error.message);
  }
  const firstSeen = new Map<string, string>();
  for (const some of chunk(urls, URL_CHUNK)) {
    const { data } = await admin.from('sourced_listings').select('canonical_url, first_seen_at').in('canonical_url', some);
    for (const r of (data ?? []) as { canonical_url: string; first_seen_at: string }[]) firstSeen.set(r.canonical_url, r.first_seen_at);
  }
  const existing = await loadDealsByUrls(admin, urls);
  const card = cardByCode.get(query.area) ?? null;

  const inserts: Record<string, unknown>[] = [];
  for (const l of listings) {
    const deal = existing.get(l.canonicalUrl);
    const listingCard = (l.postcodeArea ? cardByCode.get(l.postcodeArea) : null) ?? card;
    const rec = buildDealRecord(l, { card: listingCard, rentTable, firstSeenAt: firstSeen.get(l.canonicalUrl) ?? stamp, cohort: lookupCohorts(cohortIndex, { uprn: l.uprn, postcode: l.postcode, address: l.address }), now });
    const feedGone = retiredReasonFor(feedStatusOf(l));
    if (!deal) {
      summary.screened[rec.band] = (summary.screened[rec.band] ?? 0) + 1;
      if (rec.suitability !== 'ok' && rec.suitability !== 'unknown') summary.unsuitable[rec.suitability] = (summary.unsuitable[rec.suitability] ?? 0) + 1;
      if (!qualifiesForMarketplace(rec) || feedGone) continue;
      const fetchable = serverFetchEnabled(l.source);
      inserts.push({
        canonical_url: l.canonicalUrl,
        ...recordColumns(l, rec),
        photos: l.photo ? [l.photo] : null,
        // Zoopla is never fetched: it goes live on the feed with a placeholder photo.
        status: fetchable ? 'pending_verify' : 'live',
        first_seen_at: firstSeen.get(l.canonicalUrl) ?? stamp,
        last_seen_at: stamp,
        last_confirmed_at: stamp,
        last_confirmed_via: 'feed',
        next_check_due_at: fetchable ? stamp : nextCheckDueAt(l.kind, rec.annualProfit, now),
        created_at: stamp,
        updated_at: stamp,
      });
      continue;
    }
    await reconcile(admin, deal, l, rec, feedGone, now, summary);
  }
  if (inserts.length > 0) {
    // ignoreDuplicates: a row that appeared between the read and the write keeps its state.
    const { error, data } = await admin.from('marketplace_deals').upsert(inserts, { onConflict: 'canonical_url', ignoreDuplicates: true }).select('canonical_url');
    if (error) console.error('[marketplace-sweep] deals insert failed:', error.message);
    else summary.newDeals += data?.length ?? inserts.length;
  }
}

/** An existing row against what today's feed says about it. */
async function reconcile(admin: Admin, deal: DealRow, l: SourcedListing, rec: ReturnType<typeof buildDealRecord>, feedGone: ReturnType<typeof retiredReasonFor>, now: Date, summary: SweepSummary): Promise<void> {
  const stamp = now.toISOString();
  const count = (reason: string) => (summary.retired[reason] = (summary.retired[reason] ?? 0) + 1);
  if (deal.status === 'retired') {
    // Back in the feed and qualifying again: same row, same id. A retirement
    // the feed can undo (unqualified, stale) or — Batch 6 — one that meant the
    // listing went (sold / under offer / let agreed / removed), which is then
    // "back on the market": stamped, and confirmed by a page read before it
    // goes live wherever the source can be read.
    const reason = deal.retired_reason;
    const returning = Boolean(reason && RETURNING_REASONS.has(reason));
    if (reason && (REACTIVATABLE_REASONS.has(reason) || returning) && qualifiesForMarketplace(rec) && !feedGone) {
      const fetchable = serverFetchEnabled(l.source);
      // The price may have moved while it was off the market: record it, as any reprice is.
      const { columns: priceCols } = priceChangeColumns(deal, rec, stamp);
      const revive = { ...recordColumns(l, rec), ...priceCols, status: fetchable ? 'pending_verify' : 'live', retired_reason: null, retired_at: null, last_seen_at: stamp, last_confirmed_at: stamp, last_confirmed_via: 'feed', next_check_due_at: stamp, check_failures: 0, updated_at: stamp };
      const run = (columns: Record<string, unknown>) => admin.from('marketplace_deals').update(columns).eq('canonical_url', deal.canonical_url);
      let { error } = await run(returning ? { ...revive, revived_at: stamp, revived_from: reason } : revive);
      if (error && returning) {
        // A database without the Batch 6 columns still revives the deal; it just cannot say it came back.
        console.warn('[marketplace-sweep] revival stamp failed (schema behind?):', error.message);
        ({ error } = await run(revive));
      }
      if (error) console.error('[marketplace-sweep] reactivate failed:', error.message);
      else summary.reactivated += 1;
    }
    return;
  }
  if (feedGone) {
    await retireDeal(admin, deal.canonical_url, feedGone, now);
    count(feedGone);
    return;
  }
  const { columns: priceCols } = priceChangeColumns(deal, rec, stamp);
  const repriced = Object.keys(priceCols).length > 0;
  if (repriced && !qualifiesForMarketplace(rec)) {
    await retireDeal(admin, deal.canonical_url, 'unqualified', now);
    count('unqualified');
    return;
  }
  const update: Record<string, unknown> = { last_seen_at: stamp, last_confirmed_at: stamp, updated_at: stamp };
  // A live check within the day is the stronger claim; the feed does not overwrite it.
  if (!(deal.last_confirmed_via === 'live' && deal.last_checked_live_at && now.getTime() - new Date(deal.last_checked_live_at).getTime() < 24 * 60 * 60 * 1000)) update.last_confirmed_via = 'feed';
  if (repriced) {
    Object.assign(update, priceCols, { price_amount: rec.priceAmount, price_period: rec.pricePeriod, screening: rec.screening, deal: rec.deal, annual_profit: rec.annualProfit, uplift_pct: rec.upliftPct, band: rec.band, next_check_due_at: nextCheckDueAt(l.kind, rec.annualProfit, now) });
    summary.repriced += 1;
  }
  const { error } = await admin.from('marketplace_deals').update(update).eq('canonical_url', deal.canonical_url);
  if (error) console.error('[marketplace-sweep] confirm update failed:', error.message);
  else summary.confirmed += 1;
}

export { DEAL_COLUMNS };
