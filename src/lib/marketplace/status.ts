/**
 * What a listing's status means for the marketplace, and the decision behind
 * a paid open.
 *
 * VERIFY BEFORE CHARGE. A member is never charged for a dead listing. The
 * open reads the page first when it can; when it cannot (the portal is
 * blocking us, the source is Zoopla which the server never fetches) it falls
 * back to a recent confirmation, and if there is none it says "checking" and
 * queues a fetch rather than take the money on stale evidence.
 *
 * UNDER OFFER RETIRES. Daily picks deliberately keep under-offer listings
 * (chains collapse — see GONE_STATUSES in picks-run.ts). The marketplace does
 * not: a grid promising "deals you can act on today" must not carry a card
 * whose seller has already accepted an offer. Both are intentional.
 *
 * Pure: no network, no database.
 */
import type { ListingStatus } from '../listing/types.ts';
import type { RetiredReason, VerifiedVia } from './types.ts';

export const RETIRING_STATUSES: ReadonlySet<ListingStatus> = new Set<ListingStatus>(['sold', 'under_offer', 'let_agreed', 'removed']);

export function retiredReasonFor(status: ListingStatus | null | undefined): RetiredReason | null {
  if (!status || !RETIRING_STATUSES.has(status)) return null;
  return status as RetiredReason;
}

const HOUR_MS = 60 * 60 * 1000;

/** A live check this recent is reused on open instead of fetching the page again. */
export const RECENT_LIVE_MS = 6 * HOUR_MS;
/** Without a live check, a feed confirmation this recent is enough to charge on when the page cannot be read. */
export const RECENT_CONFIRM_MS = 24 * HOUR_MS;

export type FetchOutcome = 'ok_live' | 'ok_gone' | 'not_found' | 'unavailable';

export interface OpenDecisionInput {
  /** Whether the server can fetch this source at all (rightmove / onthemarket with fetching on). */
  fetchable: boolean;
  /** The result of the live fetch, or null when none was attempted. */
  fetch: FetchOutcome | null;
  /** The status the fetch saw, for the reason on a retirement. */
  status?: ListingStatus | null;
  lastCheckedLiveAt: string | null;
  lastConfirmedAt: string | null;
  now: Date;
}

export type OpenDecision =
  | { kind: 'charge'; verifiedVia: Extract<VerifiedVia, 'live' | 'recent_live' | 'recent_confirm'> }
  | { kind: 'just_gone'; reason: RetiredReason }
  | { kind: 'checking' };

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** True when a live check within RECENT_LIVE_MS makes a fresh fetch unnecessary. */
export function hasRecentLiveCheck(lastCheckedLiveAt: string | null, now: Date = new Date()): boolean {
  const t = ms(lastCheckedLiveAt);
  return t !== null && now.getTime() - t <= RECENT_LIVE_MS;
}

export function openDecision(input: OpenDecisionInput): OpenDecision {
  const { now } = input;
  if (input.fetch === 'ok_gone') return { kind: 'just_gone', reason: retiredReasonFor(input.status ?? null) ?? 'removed' };
  if (input.fetch === 'not_found') return { kind: 'just_gone', reason: 'removed' };
  if (input.fetch === 'ok_live') return { kind: 'charge', verifiedVia: 'live' };
  // No usable fetch: unavailable (blocked / paused / timed out) or never attempted.
  if (hasRecentLiveCheck(input.lastCheckedLiveAt, now)) return { kind: 'charge', verifiedVia: 'recent_live' };
  const confirmed = ms(input.lastConfirmedAt);
  if (confirmed !== null && now.getTime() - confirmed <= RECENT_CONFIRM_MS) return { kind: 'charge', verifiedVia: 'recent_confirm' };
  return { kind: 'checking' };
}
