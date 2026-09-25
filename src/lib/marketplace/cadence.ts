/**
 * When a live deal is looked at again, and when it is let go without looking.
 *
 * Every deal on the marketplace is a claim that a property is still on the
 * market. The claim is kept honest by page fetches, and page fetches are the
 * scarce thing: the portals block a source for six hours after a burst (see
 * listing/fetch.ts), so an hour's fetches are capped per portal and spent
 * where they matter — on what members are looking at, on rentals that go
 * let-agreed in days, and on the deals worth most to open. Sales in the long
 * tail wait about a week; the paid open still checks live first.
 *
 * Pure: no network, no database, so it runs under `node --test`.
 */
import type { SourcingKind } from '../listing/sourcing.ts';
import type { ListingSource } from '../listing/types.ts';
import type { RetiredReason } from './types.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Annual profit from which a deal is checked daily whatever its kind (the top two ladder bands). */
export const TOP_BAND_PROFIT = 40_000;

export const RENT_CHECK_MS = 2 * DAY_MS;
export const SALE_CHECK_MS = 7 * DAY_MS;
export const TOP_BAND_CHECK_MS = 1 * DAY_MS;

/** A blocked or unreadable page is tried again after this. */
export const FAILED_CHECK_RETRY_MS = 6 * HOUR_MS;
/** A pending_verify deal that fails this many fetches goes live on the feed rather than never appearing. */
export const MAX_ENTRY_FAILURES = 3;

/** Listed this long ago (the portal's date, else our first sighting) → retired without a fetch. */
export const MAX_LISTED_MS = 90 * DAY_MS;
/** Neither the feed nor a page has confirmed it for this long → retired without a fetch. */
export const MAX_UNCONFIRMED_MS = 21 * DAY_MS;

/** A deal shown to a member this recently is checked ahead of the tail. */
export const SHOWN_RECENTLY_MS = 24 * HOUR_MS;
/** ...provided it has not had a live check this recently. */
export const SHOWN_UNCHECKED_MS = 48 * HOUR_MS;

/** Fetches per portal per hourly run. Rightmove blocks harder, so it gets fewer. */
export const SOURCE_HOURLY_CAPS: Record<string, number> = { rightmove: 30, onthemarket: 60 };

export function checkIntervalMs(kind: SourcingKind, annualProfit: number | null | undefined): number {
  if (typeof annualProfit === 'number' && annualProfit >= TOP_BAND_PROFIT) return TOP_BAND_CHECK_MS;
  return kind === 'rent' ? RENT_CHECK_MS : SALE_CHECK_MS;
}

export function nextCheckDueAt(kind: SourcingKind, annualProfit: number | null | undefined, from: Date = new Date()): string {
  return new Date(from.getTime() + checkIntervalMs(kind, annualProfit)).toISOString();
}

export interface RetirementInput {
  listed_date: string | null;
  first_seen_at: string;
  last_confirmed_at: string;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Why a deal should be retired without spending a fetch on it, or null. The
 * portal's own listing date is preferred; our first sighting is the floor.
 */
export function retirementFor(row: RetirementInput, now: Date = new Date()): Extract<RetiredReason, 'stale_listed' | 'stale_unseen'> | null {
  const t = now.getTime();
  const listed = ms(row.listed_date) ?? ms(row.first_seen_at);
  if (listed !== null && t - listed > MAX_LISTED_MS) return 'stale_listed';
  const confirmed = ms(row.last_confirmed_at);
  if (confirmed !== null && t - confirmed > MAX_UNCONFIRMED_MS) return 'stale_unseen';
  return null;
}

export interface DueRow {
  canonical_url: string;
  source: ListingSource;
  kind: SourcingKind;
  status: 'pending_verify' | 'live';
  annual_profit: number | null;
  last_checked_live_at: string | null;
  last_confirmed_at: string;
  next_check_due_at: string | null;
  check_requested_at: string | null;
  last_shown_at: string | null;
}

/** Lower is sooner. Exported so the admin page can say why a row is where it is. */
export function dueTier(row: DueRow, now: Date = new Date()): number {
  const t = now.getTime();
  if (row.status === 'pending_verify') return 0;
  if (row.check_requested_at) return 1;
  const shown = ms(row.last_shown_at);
  const checked = ms(row.last_checked_live_at);
  if (shown !== null && t - shown <= SHOWN_RECENTLY_MS && (checked === null || t - checked >= SHOWN_UNCHECKED_MS)) return 2;
  const due = ms(row.next_check_due_at);
  const isDue = due === null || due <= t;
  if (isDue && row.kind === 'rent') return 3;
  if (isDue && typeof row.annual_profit === 'number' && row.annual_profit >= TOP_BAND_PROFIT) return 4;
  if (isDue) return 5;
  return 6;
}

/** True when the row should be fetched this run at all (a tier below "not due"). */
export function isDue(row: DueRow, now: Date = new Date()): boolean {
  return dueTier(row, now) < 6;
}

/**
 * The rows to fetch this run, in order: entry verifications, members' explicit
 * requests, what members have been looking at, rentals, the top bands, then
 * the tail oldest-confirmed first. Each portal is capped so one run can never
 * be the burst that trips its breaker.
 */
export function orderDueQueue<R extends DueRow>(rows: R[], now: Date = new Date(), caps: Record<string, number> = SOURCE_HOURLY_CAPS): R[] {
  const ranked = rows
    .filter((r) => isDue(r, now))
    .map((r) => ({ r, tier: dueTier(r, now), confirmed: ms(r.last_confirmed_at) ?? 0 }))
    .sort((a, b) => a.tier - b.tier || a.confirmed - b.confirmed);
  const taken: Record<string, number> = {};
  const out: R[] = [];
  for (const { r } of ranked) {
    const cap = caps[r.source];
    if (cap === undefined) continue; // not a portal we fetch
    const n = taken[r.source] ?? 0;
    if (n >= cap) continue;
    taken[r.source] = n + 1;
    out.push(r);
  }
  return out;
}
