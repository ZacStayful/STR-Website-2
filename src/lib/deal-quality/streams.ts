/**
 * The three deal streams (Batch 16, Part F). A deal belongs to one stream
 * from the moment it is screened, whichever search found it:
 *
 *   r2r        a rental: rent-to-rent, judged on the £6,000 bar
 *   low_entry  a cheap sale: an asking price of at most £150,000
 *              (low_entry.cheapMaxPrice; Batch 22c), auction lots at their
 *              auction price. Before Batch 22c: a cash in of at most £50,000
 *   top60      every other sale: the classic purchase in the sweep's areas
 *
 * The daily checks (Part B) take their slots by stream, and every card says
 * what the deal takes to get into: "£38k cash in" for a purchase, "£12k to
 * start" (the setup cost) for rent-to-rent.
 *
 * Pure: no network, no database, no server-only.
 */
import type { Deal } from '../listing/deal.ts';
import type { SourcingKind } from '../listing/sourcing.ts';
import type { LowEntrySettings } from './config.ts';

/**
 * Batch 17 adds `project`: a sale whose wording says it needs work, held on
 * the shortlist for its comparables check and then the Project photo check
 * (src/lib/project). It is only ever set by that hold, never by streamFor.
 */
export type Stream = 'top60' | 'low_entry' | 'r2r' | 'project';

export const STREAMS: readonly Stream[] = ['top60', 'low_entry', 'r2r', 'project'];

export const STREAM_LABELS: Record<Stream, string> = {
  top60: 'Top areas',
  low_entry: 'Low entry',
  r2r: 'Rent-to-rent',
  project: 'Project',
};

/**
 * Batch 16's streams, which share the day's checks (`perDay`). The Project
 * stream has its own count a day (`split.project`), on top, under the same
 * spend cap: holding Project candidates never takes a slot from these.
 */
export const DAY_STREAMS: readonly Stream[] = ['top60', 'low_entry', 'r2r'];

/** One value for every stream. */
export function perStream<T>(make: (s: Stream) => T): Record<Stream, T> {
  const out = {} as Record<Stream, T>;
  for (const s of STREAMS) out[s] = make(s);
  return out;
}

export function isStream(v: unknown): v is Stream {
  return typeof v === 'string' && (STREAMS as readonly string[]).includes(v);
}

/**
 * Whether a purchase price is cheap (Batch 22c): above zero and at most
 * `cheapMaxPrice`. The price is the deal's own asking price, which for an
 * auction lot is the auction price (the guide plus the usual uplift).
 */
export function isCheapPrice(price: number | null | undefined, s: Pick<LowEntrySettings, 'cheapMaxPrice'>): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= s.cheapMaxPrice;
}

/** The stream a deal record belongs to, from its kind and its house-finance deal: a cheap purchase is low entry. */
export function streamFor(kind: SourcingKind, deal: Deal | null, s: Pick<LowEntrySettings, 'cheapMaxPrice'>): Stream {
  if (kind === 'rent') return 'r2r';
  if (deal && deal.kind === 'purchase' && isCheapPrice(deal.askingPrice, s)) return 'low_entry';
  return 'top60';
}

/** A stored deal's stream worked out afresh from the deal it carries, ignoring the column: what the re-stream backfill compares against. */
export function derivedStreamOfRow(row: { kind: SourcingKind; deal?: unknown }, s: Pick<LowEntrySettings, 'cheapMaxPrice'>): Stream {
  const d = row.deal && typeof row.deal === 'object' ? (row.deal as { kind?: unknown; askingPrice?: unknown }) : null;
  const price = d?.kind === 'purchase' && d.askingPrice !== null && d.askingPrice !== '' ? Number(d.askingPrice) : Number.NaN;
  return streamFor(row.kind, Number.isFinite(price) ? ({ kind: 'purchase', askingPrice: price } as Deal) : null, s);
}

/** A stored deal row's stream: the column when it has one, else worked out as the record would. */
export function streamOfRow(row: { kind: SourcingKind; stream?: unknown; deal?: unknown }, s: Pick<LowEntrySettings, 'cheapMaxPrice'>): Stream {
  if (isStream(row.stream)) return row.stream;
  return derivedStreamOfRow(row, s);
}

/**
 * Batch 22c, Part E: the one plain note a very cheap purchase carries on its
 * card and deal sheet. Some lenders will not lend under about £75,000
 * (low_entry.lenderMinPrice). Null at or above it, without a price, or for a
 * member who buys with cash. The figures are never changed by it.
 */
export function lenderNote(price: number | null | undefined, s: Pick<LowEntrySettings, 'lenderMinPrice'>, cashBuyer = false): string | null {
  if (cashBuyer || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price >= s.lenderMinPrice) return null;
  return `Some lenders won't lend under about ${shortMoney(s.lenderMinPrice)}. Check with a broker, or plan it as a cash buy.`;
}

/** "£38k", "£9.5k", "£1.2m": money to the nearest thousand (or hundred under £10,000). */
export function shortMoney(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (v >= 10_000) return `£${Math.round(v / 1_000)}k`;
  if (v >= 1_000) return `£${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `£${Math.round(v)}`;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * What the deal takes to get into, for a card or the deal sheet: a
 * purchase's cash in (deposit, tax, setup; the bridging cash for an auction
 * lot), a rental's setup cost. Null without a figure.
 */
export function cashLine(kind: SourcingKind, cash: number | string | null | undefined): string | null {
  const n = num(cash);
  if (n === null || n <= 0) return null;
  return kind === 'rent' ? `${shortMoney(n)} to start` : `${shortMoney(n)} cash in`;
}
