import 'server-only';

/**
 * The income screening report: every listing the deal finder has ever stored,
 * run through the screening tests in ./screen.ts, ranked and summarised.
 *
 * This is a MEASUREMENT tool, not part of the send path. It reads
 * `sourced_listings` and the market snapshot, and writes nothing, sends nothing
 * and charges nobody. Nothing here touches picks-run.ts.
 *
 * It makes no provider calls OF ITS OWN, but it is not unconditionally free:
 * `getAreaCards()` reads the shared market snapshot, and on a COLD cache that
 * read builds it, which is dozens of PropertyData calls (see the note on
 * `getAreaCardsWithin` in ../market/cached.ts). In practice the snapshot is warm
 * — the market-warm cron builds it daily and it is cached for an hour — so
 * repeated runs while tuning cost nothing. The first run after an hour of
 * inactivity may pay for the snapshot that every other page then shares.
 *
 * Why the whole stored pool rather than a live run: screening only what today's
 * members' filters return is a small, filter-biased sample and costs PMI credit
 * on the query phase. Every row of `sourced_listings` carries a full listing
 * snapshot already, so the distribution covers every area and bedroom count the
 * finder has touched, for nothing.
 *
 * The rent ladder used here has two tiers of KNOWN provenance:
 *
 *   advertised        rent-to-rent only — the listing's own asking rent, which
 *                     IS the market rent the operator would pay. Confirmed.
 *   stored-reports    the mean long-let rent from analyser reports we already
 *                     ran for that area and bedroom count. Real and local.
 *   national-ladder   last resort, always `low` confidence.
 *
 * The market snapshot's own area-average rent (`card.verdict.longLetMonthlyRent`)
 * is deliberately NOT used: `getLongLetData` silently substitutes a national
 * median when PropertyData has no answer or no key is set, so a figure taken from
 * the snapshot cannot be told apart from a national median. Adding that tier
 * needs provenance fields on AreaVerdict first.
 *
 * EXPECTED DISTRIBUTION. The same tier logic was run in SQL against the live
 * data before this was written, over 1,507 stored listings in 30 areas. A run
 * should land near these figures; a wide divergence means this disagrees with
 * the arithmetic and is worth chasing before the numbers are trusted:
 *
 *   sale   ~887 screened · ~445 qualified (~50%) · ~193 medium
 *          stored-reports tier: 607 screened, 353 qualified, mean uplift 45.7%
 *          national-ladder tier: 280 screened, 92 qualified, mean uplift 21.4%
 *   rent   ~519 screened · ~86 qualified (~17%) · ~112 medium
 *          advertised tier: 325 screened, 45 qualified, mean profit -£5,827
 *          stored-reports tier: 141 screened, 27 qualified, mean profit £4,383
 *          national-ladder tier: 53 screened, 14 qualified, mean profit £883
 *
 * Two things those numbers say. The ladder tier's uplift is far lower than the
 * stored-reports tier's (21.4% against 45.7%) because national median rents run
 * above real local rents in the areas the finder covers — which is why those rows
 * are marked `low` confidence rather than trusted. And rent-to-rent looks WORSE
 * on the advertised rent than on an estimated one, because a real asking rent is
 * higher than an area average; that is the honest figure, since an operator pays
 * the advertised rent and not an average.
 *
 * Expect `missing.noAreaCard` to exceed what the SQL implied: the SQL counted any
 * area with a single report, whereas the market snapshot only builds a card once
 * an area clears its sample threshold.
 */

import { createAdminClient } from '../supabase/admin';
import { getAreaCards, getAreaCardsWithin } from '../market/cached';
import { storedAreaRentTable, areaRentKey } from '../broker/providers/internal';
import { csvRow } from '../api/csv';
import { areaRevenueFor, rentPcm, type AreaFigures, type SourcedListing, type SourcingKind } from './sourcing';
import { screen, bandRank, marketRentFor, grossRevenueFor, type Figure, type RentTier, type Screening } from './screen';

export interface ScreenReportRow {
  canonicalUrl: string;
  source: string;
  kind: SourcingKind;
  address: string | null;
  postcodeArea: string | null;
  areaName: string | null;
  bedrooms: number | null;
  /** Asking price for a sale, advertised rent pcm for a rental. Not in the test; context for a human. */
  askingPrice: number | null;
  advertisedRentPcm: number | null;
  rentTier: RentTier | null;
  screening: Screening;
}

export interface BandCounts {
  qualified: number;
  medium: number;
  unqualified: number;
  'insufficient-data': number;
}

export interface Distribution {
  n: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

export interface ScreenReportSummary {
  listings: number;
  byKind: Record<'sale' | 'rent', { total: number; bands: BandCounts; passRatePct: number | null }>;
  /** Why a listing could not be banded. The funnel is thin BEFORE the test applies. */
  missing: { noBedrooms: number; noAreaCard: number; noAreaRevenue: number; noRent: number };
  rentTiers: Record<RentTier, number>;
  /** Purchase uplift %, and rent-to-rent annual profit £, over the banded rows only. */
  buyUpliftPct: Distribution;
  r2rProfit: Distribution;
  /** Rows the £20,000 cash route qualified that the percentage route would not have. */
  qualifiedByAbsolute: number;
  byArea: { area: string; areaName: string | null; kind: SourcingKind; screened: number; qualified: number; passRatePct: number }[];
  byBedrooms: { bedrooms: number; kind: SourcingKind; screened: number; qualified: number; passRatePct: number }[];
}

export interface ScreenReport {
  generatedAt: string;
  /** True when the market snapshot was already cached, so this run triggered no provider calls at all. */
  snapshotWasWarm: boolean;
  note: string;
  summary: ScreenReportSummary;
  rows: ScreenReportRow[];
}

const PAGE = 1000;
/** A cached snapshot returns well inside this; a cold one cannot. */
const SNAPSHOT_WARM_PROBE_MS = 2_000;

function emptyBands(): BandCounts {
  return { qualified: 0, medium: 0, unqualified: 0, 'insufficient-data': 0 };
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const v = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  return Math.round(v * 10) / 10;
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    min: sorted.length ? Math.round(sorted[0]) : null,
    max: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
  };
}

function rate(qualified: number, screened: number): number {
  return screened === 0 ? 0 : Math.round((qualified / screened) * 1000) / 10;
}

/**
 * Screens every stored listing. `limit` caps the rows returned (the summary
 * always covers everything read).
 */
export async function buildScreenReport(options: { limit?: number } = {}): Promise<ScreenReport> {
  const admin = createAdminClient();
  // A cached snapshot answers effectively instantly; a cold one has to be built.
  // Asking with a short deadline first tells the caller which happened, so the
  // report can say honestly whether it triggered any provider calls.
  const warm = await getAreaCardsWithin(SNAPSHOT_WARM_PROBE_MS);
  const snapshotWasWarm = warm !== null && warm.length > 0;
  const [cards, rentTable] = await Promise.all([snapshotWasWarm ? warm : getAreaCards(), storedAreaRentTable()]);
  const cardByCode = new Map(cards.map((c) => [c.code, c]));

  const rows: ScreenReportRow[] = [];
  const missing = { noBedrooms: 0, noAreaCard: 0, noAreaRevenue: 0, noRent: 0 };
  const rentTiers: Record<RentTier, number> = { advertised: 0, 'stored-reports': 0, 'national-ladder': 0 };

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('sourced_listings')
      .select('canonical_url, source, kind, postcode_area, snapshot')
      .order('canonical_url', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sourced_listings read failed: ${error.message}`);
    const batch = (data ?? []) as { canonical_url: string; source: string; kind: string; postcode_area: string | null; snapshot: SourcedListing }[];

    for (const r of batch) {
      const l = r.snapshot;
      if (!l) continue;
      const kind: SourcingKind = r.kind === 'rent' ? 'rent' : 'sale';
      const area = l.postcodeArea ?? r.postcode_area;
      const card = area ? cardByCode.get(area) ?? null : null;
      const bedrooms = typeof l.bedrooms === 'number' ? l.bedrooms : null;
      const advertised = kind === 'rent' ? rentPcm(l.price) : null;

      if (bedrooms === null) missing.noBedrooms += 1;
      if (!card) missing.noAreaCard += 1;

      // Short-let revenue: the same area-average-for-this-size figure the deal
      // finder already prices every candidate on (areaRevenueFor).
      let grossRevenue: Figure | null = null;
      if (card) {
        const figures: AreaFigures = {
          byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })),
          headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr },
        };
        const rev = areaRevenueFor(figures, bedrooms);
        const exact = bedrooms !== null && card.byBedrooms.some((b) => b.bedrooms === bedrooms && b.grossRevenue);
        grossRevenue = grossRevenueFor(rev?.grossRevenue ?? null, exact);
        if (!grossRevenue) missing.noAreaRevenue += 1;
      }

      // Market rent, resolved by the same helper the daily-picks gate uses.
      const rent = marketRentFor({
        kind,
        bedrooms,
        advertisedRentPcm: advertised,
        storedRent: area && bedrooms !== null ? rentTable.get(areaRentKey(area, bedrooms)) ?? null : null,
      });
      const marketRent = rent?.figure ?? null;
      const rentTier: RentTier | null = rent?.tier ?? null;
      if (!marketRent) missing.noRent += 1;
      if (rentTier) rentTiers[rentTier] += 1;

      const screening = screen(kind, { bedrooms, grossRevenue, marketRent });
      rows.push({
        canonicalUrl: r.canonical_url,
        source: r.source,
        kind,
        address: l.address ?? l.title ?? null,
        postcodeArea: area,
        areaName: card?.name ?? null,
        bedrooms,
        askingPrice: kind === 'sale' && l.price?.period === 'total' ? l.price.amount : null,
        advertisedRentPcm: advertised,
        rentTier,
        screening,
      });
    }
    if (batch.length < PAGE) break;
  }

  // ── Summary ──
  const byKind: ScreenReportSummary['byKind'] = {
    sale: { total: 0, bands: emptyBands(), passRatePct: null },
    rent: { total: 0, bands: emptyBands(), passRatePct: null },
  };
  const buyUplift: number[] = [];
  const r2rProfit: number[] = [];
  let qualifiedByAbsolute = 0;
  const areaAcc = new Map<string, { area: string; areaName: string | null; kind: SourcingKind; screened: number; qualified: number }>();
  const bedAcc = new Map<string, { bedrooms: number; kind: SourcingKind; screened: number; qualified: number }>();

  for (const row of rows) {
    const k = byKind[row.kind];
    k.total += 1;
    k.bands[row.screening.band] += 1;
    if (row.screening.byAbsolute) qualifiedByAbsolute += 1;
    if (row.screening.band === 'insufficient-data') continue;

    if (row.screening.kind === 'purchase' && row.screening.upliftPct !== null) buyUplift.push(row.screening.upliftPct);
    if (row.screening.kind === 'rent-to-rent' && row.screening.annualProfit !== null) r2rProfit.push(row.screening.annualProfit);

    const won = row.screening.band === 'qualified' ? 1 : 0;
    if (row.postcodeArea) {
      const key = `${row.postcodeArea}|${row.kind}`;
      const a = areaAcc.get(key) ?? { area: row.postcodeArea, areaName: row.areaName, kind: row.kind, screened: 0, qualified: 0 };
      a.screened += 1;
      a.qualified += won;
      areaAcc.set(key, a);
    }
    if (row.bedrooms !== null) {
      const key = `${row.bedrooms}|${row.kind}`;
      const b = bedAcc.get(key) ?? { bedrooms: row.bedrooms, kind: row.kind, screened: 0, qualified: 0 };
      b.screened += 1;
      b.qualified += won;
      bedAcc.set(key, b);
    }
  }
  for (const kind of ['sale', 'rent'] as const) {
    const k = byKind[kind];
    const banded = k.total - k.bands['insufficient-data'];
    k.passRatePct = banded === 0 ? null : rate(k.bands.qualified, banded);
  }

  // Best band first, then the strongest figure within it, so the head of the
  // list is what a member would actually be sent.
  rows.sort((a, b) => {
    const band = bandRank(a.screening.band) - bandRank(b.screening.band);
    if (band !== 0) return band;
    return (b.screening.surplus ?? -Infinity) - (a.screening.surplus ?? -Infinity);
  });

  const summary: ScreenReportSummary = {
    listings: rows.length,
    byKind,
    missing,
    rentTiers,
    buyUpliftPct: distribution(buyUplift),
    r2rProfit: distribution(r2rProfit),
    qualifiedByAbsolute,
    byArea: [...areaAcc.values()].map((a) => ({ ...a, passRatePct: rate(a.qualified, a.screened) })).sort((a, b) => b.screened - a.screened),
    byBedrooms: [...bedAcc.values()].map((b) => ({ ...b, passRatePct: rate(b.qualified, b.screened) })).sort((a, b) => a.kind.localeCompare(b.kind) || a.bedrooms - b.bedrooms),
  };

  return {
    generatedAt: new Date().toISOString(),
    snapshotWasWarm,
    note: snapshotWasWarm
      ? 'Measurement only: no provider calls, no writes, no sends, no charges. Screened every stored listing against the cached market snapshot.'
      : 'Measurement only: no writes, no sends, no charges — but the market snapshot was cold, so reading it rebuilt it (dozens of PropertyData calls). It is cached for an hour now, so a re-run is free.',
    summary,
    rows: options.limit ? rows.slice(0, options.limit) : rows,
  };
}

const CSV_COLUMNS = [
  'band', 'band_reason', 'kind', 'address', 'postcode_area', 'area_name', 'bedrooms',
  'asking_price', 'advertised_rent_pcm', 'rent_tier', 'market_rent_pcm', 'rent_source',
  'gross_revenue', 'gross_revenue_source', 'str_net', 'fixed_costs', 'ltl_net', 'annual_rent',
  'surplus', 'uplift_pct', 'annual_profit', 'revenue_multiple', 'required_gross', 'gap',
  'qualified_by_cash_route', 'confidence', 'url',
] as const;

/** The same rows as a spreadsheet, for sorting and pivoting by hand. */
export function screenReportCsv(report: ScreenReport): string {
  const lines = [csvRow(CSV_COLUMNS)];
  for (const r of report.rows) {
    const s = r.screening;
    lines.push(csvRow([
      s.band,
      s.reason,
      s.kind,
      r.address,
      r.postcodeArea,
      r.areaName,
      r.bedrooms,
      r.askingPrice,
      r.advertisedRentPcm,
      r.rentTier,
      s.marketRent?.value ?? null,
      s.marketRent?.source ?? null,
      s.grossRevenue?.value ?? null,
      s.grossRevenue?.source ?? null,
      s.strNet,
      s.fixedCosts,
      s.kind === 'purchase' ? s.ltlNet : null,
      s.kind === 'rent-to-rent' ? s.annualRent : null,
      s.surplus,
      s.kind === 'purchase' ? s.upliftPct : null,
      s.kind === 'rent-to-rent' ? s.annualProfit : null,
      s.kind === 'rent-to-rent' ? s.revenueMultiple : null,
      s.requiredGross,
      s.gap,
      s.byAbsolute,
      s.confidence,
      r.canonicalUrl,
    ]));
  }
  return lines.join('\r\n');
}

/** Band counts as a percentage of the banded rows, for a quick read. */
export function passRateLine(report: ScreenReport): string {
  return (['sale', 'rent'] as const)
    .map((k) => {
      const b = report.summary.byKind[k];
      return `${k}: ${b.bands.qualified} qualified / ${b.bands.medium} medium / ${b.bands.unqualified} unqualified (${b.passRatePct ?? 0}% pass, ${b.bands['insufficient-data']} unbanded)`;
    })
    .join(' · ');
}
