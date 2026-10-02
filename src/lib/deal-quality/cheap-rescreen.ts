/**
 * The cheap re-screen's rules (Batch 22c, Part B.4b). The sweep, the demand
 * searches and the members' own searches already keep every sale listing
 * they were shown in sourced_listings, qualifying or not. Those at a cheap
 * price that never became a deal are screened again, free, on today's area
 * figures, rent table and rules: any that now qualify and are low entry go
 * into the pool through the same absorber every search uses.
 *
 * No provider is asked anything: the listings are already stored, the
 * screen is pure, and the absorber is given no cohorts to buy. Only listings
 * the feed showed within the last RESCREEN_SEEN_DAYS are taken (the absorber
 * marks what it folds in as seen now, so an older one would look fresher than
 * it is).
 *
 * The report says what it is, never where it is: the postcode area, bedrooms,
 * price and figures, no address and no URL.
 *
 * Pure: no network, no database, no server-only.
 */
import type { SourcedListing } from '../listing/sourcing.ts';
import type { Band } from '../listing/screen.ts';
import type { LowEntrySettings } from './config.ts';
import type { Stream } from './streams.ts';

export const CHEAP_RESCREEN_KIND = 'cheap_rescreen';
/** Only listings the feed showed this recently are screened again. */
export const RESCREEN_SEEN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A sourced_listings row's light columns: enough to choose candidates before reading their snapshots. */
export interface StoredSaleRow {
  canonical_url: string;
  kind: string;
  postcode_area: string | null;
  last_seen_at: string;
  /** snapshot->price */
  price: unknown;
}

/** The listed total price of a stored sale, or null (a rental, a price a month, no price). */
export function storedSalePrice(row: Pick<StoredSaleRow, 'kind' | 'price'>): number | null {
  if (row.kind !== 'sale' || !row.price || typeof row.price !== 'object') return null;
  const p = row.price as { amount?: unknown; period?: unknown };
  if (p.period !== 'total') return null;
  const n = typeof p.amount === 'number' ? p.amount : typeof p.amount === 'string' && p.amount.trim() !== '' ? Number(p.amount) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whether a stored row is worth screening again: a sale at a cheap listed
 * price, seen within the window. An auction lot's listed guide is below its
 * auction price, so this is a sieve: the record's own stream decides.
 */
export function isRescreenCandidate(row: StoredSaleRow, s: Pick<LowEntrySettings, 'cheapMaxPrice'>, now: Date): boolean {
  const price = storedSalePrice(row);
  if (price === null || price > s.cheapMaxPrice) return false;
  const seen = Date.parse(row.last_seen_at);
  return Number.isFinite(seen) && now.getTime() - seen <= RESCREEN_SEEN_DAYS * DAY_MS;
}

/** What the screen made of one candidate. */
export interface RescreenOutcome {
  listing: SourcedListing;
  area: string | null;
  bedrooms: number | null;
  price: number | null;
  band: Band | null;
  stream: Stream | null;
  annualProfit: number | null;
  cashIn: number | null;
  /** Qualified, suitable, not gone from the feed, and low entry: what a real run would fold in. */
  wouldAdd: boolean;
  /** No area figures to screen it on. */
  unscreenable: boolean;
}

export interface RescreenReport {
  candidates: number;
  unscreenable: number;
  byBand: Partial<Record<Band, number>>;
  wouldAdd: number;
  /** "CA 3-bed £115,000: £7,555 a year on £61,860 in (12.2%)", the best return first. */
  sample: string[];
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export function rescreenReport(outcomes: readonly RescreenOutcome[], sampleSize = 20): RescreenReport {
  const byBand: Partial<Record<Band, number>> = {};
  let unscreenable = 0;
  for (const o of outcomes) {
    if (o.unscreenable) unscreenable += 1;
    else if (o.band) byBand[o.band] = (byBand[o.band] ?? 0) + 1;
  }
  const adds = outcomes.filter((o) => o.wouldAdd);
  const roc = (o: RescreenOutcome) => (o.annualProfit !== null && o.cashIn !== null && o.cashIn > 0 ? o.annualProfit / o.cashIn : Number.NEGATIVE_INFINITY);
  const sample = [...adds]
    .sort((a, b) => roc(b) - roc(a))
    .slice(0, sampleSize)
    .map((o) => {
      const r = roc(o);
      const money = o.annualProfit !== null && o.cashIn !== null ? `: ${gbp(o.annualProfit)} a year on ${gbp(o.cashIn)} in${Number.isFinite(r) ? ` (${(r * 100).toFixed(1)}%)` : ''}` : '';
      return `${o.area ?? '?'} ${o.bedrooms ?? '?'}-bed ${o.price === null ? '?' : gbp(o.price)}${money}`;
    });
  return { candidates: outcomes.length, unscreenable, byBand, wouldAdd: adds.length, sample };
}

/** The candidates a real run folds in, by the postcode area the absorber screens them under. */
export function addsByArea(outcomes: readonly RescreenOutcome[]): Map<string, SourcedListing[]> {
  const out = new Map<string, SourcedListing[]>();
  for (const o of outcomes) {
    if (!o.wouldAdd || !o.area) continue;
    const list = out.get(o.area) ?? [];
    list.push(o.listing);
    out.set(o.area, list);
  }
  return out;
}
