/**
 * The three deal streams (Batch 16, Part F). A deal belongs to one stream
 * from the moment it is screened, whichever search found it:
 *
 *   r2r        a rental: rent-to-rent, judged on the £6,000 bar
 *   low_entry  a sale the house deal model gets into for at most the
 *              low-entry cash (auction lots at their auction price, with
 *              the bridging cash)
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

export type Stream = 'top60' | 'low_entry' | 'r2r';

export const STREAMS: readonly Stream[] = ['top60', 'low_entry', 'r2r'];

export const STREAM_LABELS: Record<Stream, string> = {
  top60: 'Top areas',
  low_entry: 'Low entry',
  r2r: 'Rent-to-rent',
};

export function isStream(v: unknown): v is Stream {
  return typeof v === 'string' && (STREAMS as readonly string[]).includes(v);
}

/** The stream a deal record belongs to, from its kind and its house-finance deal. */
export function streamFor(kind: SourcingKind, deal: Deal | null, s: Pick<LowEntrySettings, 'maxCashIn'>): Stream {
  if (kind === 'rent') return 'r2r';
  if (deal && deal.kind === 'purchase' && Number.isFinite(deal.cashRequired) && deal.cashRequired > 0 && deal.cashRequired <= s.maxCashIn) return 'low_entry';
  return 'top60';
}

/** A stored deal row's stream: the column when it has one, else worked out as the record would. */
export function streamOfRow(row: { kind: SourcingKind; stream?: unknown; deal?: unknown }, s: Pick<LowEntrySettings, 'maxCashIn'>): Stream {
  if (isStream(row.stream)) return row.stream;
  const d = row.deal && typeof row.deal === 'object' ? (row.deal as { kind?: unknown; cashRequired?: unknown }) : null;
  const cash = d?.kind === 'purchase' ? Number(d.cashRequired) : Number.NaN;
  return streamFor(row.kind, Number.isFinite(cash) ? ({ kind: 'purchase', cashRequired: cash } as Deal) : null, s);
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
