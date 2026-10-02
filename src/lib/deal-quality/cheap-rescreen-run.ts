import 'server-only';

/**
 * The cheap re-screen (Batch 22c, Part B.4b; the rules are in
 * cheap-rescreen.ts). Stored sale listings at a cheap price, seen by the feed
 * in the last few days, that never became a deal are screened again on
 * today's figures; those that now qualify and are low entry are folded into
 * the pool by the absorber every search uses (as pending_check with the
 * daily checks on, else pending_verify for their page read, as any
 * newcomer). Entry points: /api/internal/cheap-rescreen (secret-gated,
 * ?dry=1) and the /admin/deals buttons.
 *
 * No spend: nothing is asked of a provider, and the absorber gets no
 * cohorts to buy. The dry run is the report (how many candidates, how each
 * screens, the ones a run would add with their return on cash; never an
 * address or a URL) and writes nothing. Idempotent: a listing that became a
 * deal is never a candidate again. Every run is recorded in marketplace_runs
 * (kind 'cheap_rescreen').
 */
import { createAdminClient } from '../supabase/admin';
import { areaMetaForCode } from '../market/areas';
import { queryKey, type SourcedListing } from '../listing/sourcing';
import { buildDealRecord, feedStatusOf, qualifiesForMarketplace } from '../marketplace/record';
import { retiredReasonFor } from '../marketplace/status';
import { absorbListings, emptyAbsorbCounters } from '../marketplace/absorb';
import { chunk, loadScreenContext, revalidateDeals, type Admin } from '../marketplace/server';
import type { CohortMember } from '../listing/cohorts';
import { readDealQualitySettings } from './settings-server';
import { addsByArea, CHEAP_RESCREEN_KIND, isRescreenCandidate, RESCREEN_SEEN_DAYS, rescreenReport, type RescreenOutcome, type StoredSaleRow } from './cheap-rescreen';

const PAGE = 1000;
const URL_CHUNK = 150;
const SNAPSHOT_WAIT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CheapRescreenResult {
  status: number;
  body: Record<string, unknown>;
}

/** Every sale seen within the window, light columns only (the price, never the snapshot). Null when unreadable. */
async function loadRecentSales(admin: Admin, now: Date): Promise<StoredSaleRow[] | null> {
  const since = new Date(now.getTime() - RESCREEN_SEEN_DAYS * DAY_MS).toISOString();
  const out: StoredSaleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('sourced_listings')
      .select('canonical_url, kind, postcode_area, last_seen_at, price:snapshot->price')
      .eq('kind', 'sale')
      .gte('last_seen_at', since)
      .order('canonical_url', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[cheap-rescreen] sourced_listings unreadable:', error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as StoredSaleRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Of `urls`, those that already have a marketplace_deals row (any status). Null when unreadable. */
async function urlsWithDeals(admin: Admin, urls: readonly string[]): Promise<Set<string> | null> {
  const have = new Set<string>();
  for (const some of chunk([...urls], URL_CHUNK)) {
    const { data, error } = await admin.from('marketplace_deals').select('canonical_url').in('canonical_url', some);
    if (error) {
      console.error('[cheap-rescreen] marketplace_deals unreadable:', error.message);
      return null;
    }
    for (const r of (data ?? []) as { canonical_url: string }[]) have.add(r.canonical_url);
  }
  return have;
}

async function loadSnapshots(admin: Admin, urls: readonly string[]): Promise<{ url: string; area: string | null; firstSeen: string; listing: SourcedListing }[] | null> {
  const out: { url: string; area: string | null; firstSeen: string; listing: SourcedListing }[] = [];
  for (const some of chunk([...urls], URL_CHUNK)) {
    const { data, error } = await admin.from('sourced_listings').select('canonical_url, postcode_area, first_seen_at, snapshot').in('canonical_url', some);
    if (error) {
      console.error('[cheap-rescreen] snapshots unreadable:', error.message);
      return null;
    }
    for (const r of (data ?? []) as { canonical_url: string; postcode_area: string | null; first_seen_at: string; snapshot: unknown }[]) {
      if (r.snapshot && typeof r.snapshot === 'object') out.push({ url: r.canonical_url, area: r.postcode_area, firstSeen: r.first_seen_at, listing: r.snapshot as SourcedListing });
    }
  }
  return out;
}

async function recordRun(admin: Admin, dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: CHEAP_RESCREEN_KIND, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[cheap-rescreen] run record failed:', error.message);
}

export async function runCheapRescreen(opts: { dry: boolean; triggeredBy: string }): Promise<CheapRescreenResult> {
  const startedAt = new Date();
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
  if (ctx === null) return { status: 503, body: { error: 'snapshot_warming', detail: 'Market snapshot still building; try again shortly' } };
  const settings = (await readDealQualitySettings(admin)).lowEntry;

  const recent = await loadRecentSales(admin, startedAt);
  if (!recent) return { status: 500, body: { error: 'sourced_listings unreadable' } };
  const sieved = recent.filter((r) => isRescreenCandidate(r, settings, startedAt));
  const dealt = await urlsWithDeals(admin, sieved.map((r) => r.canonical_url));
  if (!dealt) return { status: 500, body: { error: 'marketplace_deals unreadable' } };
  const snapshots = await loadSnapshots(admin, sieved.filter((r) => !dealt.has(r.canonical_url)).map((r) => r.canonical_url));
  if (!snapshots) return { status: 500, body: { error: 'snapshots unreadable' } };

  const outcomes: RescreenOutcome[] = snapshots.map(({ area: rowArea, firstSeen, listing }) => {
    const area = listing.postcodeArea ?? rowArea;
    const card = area ? (ctx.cardByCode.get(area) ?? null) : null;
    const price = listing.price && listing.price.period === 'total' ? listing.price.amount : null;
    if (!card) return { listing, area, bedrooms: listing.bedrooms, price, band: null, stream: null, annualProfit: null, cashIn: null, wouldAdd: false, unscreenable: true };
    const rec = buildDealRecord(listing, { card, rentTable: ctx.rentTable, r2rBar: ctx.r2rBar, rules: ctx.rules, firstSeenAt: firstSeen, now: startedAt });
    const cashIn = rec.deal?.kind === 'purchase' ? rec.deal.cashRequired : null;
    const wouldAdd = qualifiesForMarketplace(rec) && rec.stream === 'low_entry' && retiredReasonFor(feedStatusOf(listing)) === null;
    return { listing, area, bedrooms: listing.bedrooms, price, band: rec.band, stream: rec.stream, annualProfit: rec.annualProfit, cashIn, wouldAdd, unscreenable: false };
  });
  const report = rescreenReport(outcomes);
  const summary: Record<string, unknown> = {
    triggeredBy: opts.triggeredBy,
    dry: opts.dry,
    cheapMaxPrice: settings.cheapMaxPrice,
    seenWithinDays: RESCREEN_SEEN_DAYS,
    recentSales: recent.length,
    cheapListed: sieved.length,
    alreadyDeals: sieved.length - snapshots.length,
    candidates: report.candidates,
    unscreenable: report.unscreenable,
    byBand: report.byBand,
    wouldAdd: report.wouldAdd,
    rawCostPence: 0,
  };

  if (opts.dry) {
    await recordRun(admin, true, startedAt, summary);
    return { status: 200, body: { ...summary, sample: report.sample } };
  }

  const counters = emptyAbsorbCounters();
  const noCohorts = new Map<string, CohortMember>();
  for (const [area, listings] of addsByArea(outcomes)) {
    const meta = areaMetaForCode(area);
    // Keyed apart from every search, so nothing reads it as a provider query.
    const query = { key: `rescreen|${queryKey('sale', meta.code, null, settings.cheapMaxPrice, null)}`, kind: 'sale' as const, area: meta.code, areaName: meta.name, areaSlug: meta.slug, minPrice: null, maxPrice: settings.cheapMaxPrice, minBedrooms: null };
    await absorbListings(admin, ctx.cardByCode, ctx.rentTable, ctx.r2rBar, noCohorts, query, listings, counters, 'cheap-rescreen', ctx.rules);
  }
  if (counters.newDeals > 0) revalidateDeals();
  const done = { ...summary, newDeals: counters.newDeals, shortlisted: counters.shortlisted, projectHeld: counters.projectHeld, retired: counters.retired };
  await recordRun(admin, false, startedAt, done);
  return { status: 200, body: { ...done, sample: report.sample } };
}
