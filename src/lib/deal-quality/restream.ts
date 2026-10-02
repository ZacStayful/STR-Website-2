/**
 * The re-stream backfill's rules (Batch 22c, Part A). The low-entry stream
 * now means a cheap price (an asking price at most low_entry.cheapMaxPrice;
 * an auction lot at its auction price) instead of a small cash in, so every
 * stored deal still in play has its `stream` column worked out again from
 * the deal it carries. A Project deal keeps its stream: only its hold sets
 * or clears that.
 *
 * The report says what it is and where it goes, never where it is: an id,
 * the postcode area, bedrooms and price, no address and no URL.
 *
 * Pure: no network, no database, no server-only.
 */
import type { SourcingKind } from '../listing/sourcing.ts';
import type { LowEntrySettings } from './config.ts';
import { derivedStreamOfRow, isStream, STREAMS, type Stream } from './streams.ts';

export const RESTREAM_KIND = 'restream_backfill';

/** The statuses whose stream still matters: live, and the two waits before it. Retired rows are left as they are. */
export const RESTREAM_STATUSES = ['live', 'pending_check', 'pending_verify'] as const;

export interface RestreamRow {
  id: string;
  kind: SourcingKind;
  status: string;
  stream: unknown;
  deal: unknown;
  postcode_area: string | null;
  bedrooms: number | null;
  price_amount: number | string | null;
}

export interface RestreamMove {
  id: string;
  area: string | null;
  bedrooms: number | null;
  price: number | null;
  status: string;
  /** The column as it is; null when the row has none. */
  from: Stream | null;
  to: Stream;
}

/** Counts per stream, plus the rows with no stream column yet. */
export type StreamTally = Record<Stream | 'none', number>;

export interface RestreamReport {
  /** Every row considered, Project rows included in the counts. */
  rows: number;
  before: { all: StreamTally; live: StreamTally };
  after: { all: StreamTally; live: StreamTally };
  moves: RestreamMove[];
}

const tally = (): StreamTally => ({ top60: 0, low_entry: 0, r2r: 0, project: 0, none: 0 });

/** The stream a row should have now: a Project row keeps its stream, every other is worked out from its deal. */
export function targetStream(row: Pick<RestreamRow, 'kind' | 'stream' | 'deal'>, s: Pick<LowEntrySettings, 'cheapMaxPrice'>): Stream {
  if (row.stream === 'project') return 'project';
  return derivedStreamOfRow(row, s);
}

/** What the backfill would do: the counts before and after, and each row that moves. */
export function restreamPlan(rows: readonly RestreamRow[], s: Pick<LowEntrySettings, 'cheapMaxPrice'>): RestreamReport {
  const report: RestreamReport = { rows: rows.length, before: { all: tally(), live: tally() }, after: { all: tally(), live: tally() }, moves: [] };
  for (const r of rows) {
    const from = isStream(r.stream) ? r.stream : null;
    const to = targetStream(r, s);
    report.before.all[from ?? 'none'] += 1;
    report.after.all[to] += 1;
    if (r.status === 'live') {
      report.before.live[from ?? 'none'] += 1;
      report.after.live[to] += 1;
    }
    if (from !== to) {
      const price = r.price_amount === null || r.price_amount === '' ? null : Number(r.price_amount);
      report.moves.push({ id: r.id, area: r.postcode_area, bedrooms: r.bedrooms, price: Number.isFinite(price) ? price : null, status: r.status, from, to });
    }
  }
  return report;
}

/** The moves grouped by the stream they go to, for one update per stream. */
export function movesByTarget(moves: readonly RestreamMove[]): Partial<Record<Stream, string[]>> {
  const out: Partial<Record<Stream, string[]>> = {};
  for (const m of moves) (out[m.to] ??= []).push(m.id);
  return out;
}

/** "low_entry 1 → 13 · top60 272 → 260": one line per tally, for the admin box. */
export function tallyLine(before: StreamTally, after: StreamTally): string {
  return [...STREAMS, 'none' as const]
    .filter((k) => before[k] !== 0 || after[k] !== 0)
    .map((k) => `${k} ${before[k]} → ${after[k]}`)
    .join(' · ');
}
