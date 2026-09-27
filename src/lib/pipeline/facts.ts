/**
 * A tracked deal's facts, turned into the words the next-step text uses:
 * "£185,000", "2-bedroom", "7 months", "twice". Every formatter answers null
 * when the fact is missing or makes no sense, so the text drops it (see
 * render.ts) instead of printing a blank, a zero or a made-up figure.
 *
 * The listing's own facts only: the address is passed in by the caller and
 * only for a deal the member may see the whole of (Batch 5's address rule).
 *
 * Pure: no network, no database, no `server-only`.
 */
import { ageFromDates, type ListingAge } from '../listing/sourcing.ts';
import { parseMotivation } from '../listing/motivation.ts';
import { recordedCuts } from '../marketplace/motivation-line.ts';
import { cleanValue } from './render.ts';
import type { Fields, MessageField, StepKind } from './types.ts';

export interface DealFacts {
  /** The listing's kind as stored: 'sale' or 'rent' (anything else has no next step). */
  kind: string;
  /** Only for a deal the member may see the whole of. */
  address: string | null;
  town: string | null;
  bedrooms: number | null;
  /** The asking price ('total') or rent ('pcm', or 'pw' on a listing the member added). */
  price: { amount: number; period: string } | null;
  /** The portal's own listing date. */
  listedDate: string | null;
  /** When we first saw the listing: a floor for its age, never the age. */
  firstSeenAt: string | null;
  /** marketplace_deals.price_history, as stored. */
  priceHistory?: unknown;
  /** marketplace_deals.motivation, as stored. */
  motivation?: unknown;
  /** The marketplace deal's state; null for a listing the member added. */
  dealStatus: 'live' | 'retired' | 'pending_verify' | null;
  retiredReason: string | null;
  /** When the listing was last confirmed live, which is when its price was last read. */
  lastConfirmedAt: string | null;
  postcodeArea: string | null;
  /** A marketplace deal (key `d-…`), not a listing the member added (`l-…`). */
  marketplace: boolean;
}

export function stepKindOf(kind: string): StepKind | null {
  if (kind === 'sale') return 'purchase';
  if (kind === 'rent') return 'rent-to-rent';
  return null;
}

export function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

/** The asking price (purchase) or monthly rent (rent-to-rent), or null when there is no sensible one. */
export function askingAmount(facts: Pick<DealFacts, 'price'>, kind: StepKind): number | null {
  const p = facts.price;
  if (!p || typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount <= 0) return null;
  if (kind === 'purchase') return p.period === 'total' ? p.amount : null;
  if (p.period === 'pcm') return Math.round(p.amount);
  if (p.period === 'pw') return Math.round((p.amount * 52) / 12);
  return null;
}

/** How long it has been listed: the portal's date when there is one, else our first sighting (a floor). */
export function timeOnMarket(facts: Pick<DealFacts, 'listedDate' | 'firstSeenAt'>, now: Date): ListingAge | null {
  return ageFromDates(facts.listedDate, facts.firstSeenAt, now);
}

const DAY = 1;
const WEEK = 7 * DAY;

/**
 * "5 weeks" / "7 months", with "at least" when the age is our own first
 * sighting. Under two weeks says nothing worth saying, so it is missing.
 */
export function formatAge(age: ListingAge | null, kind: StepKind): string | null {
  if (!age || !Number.isFinite(age.days) || age.days < 2 * WEEK) return null;
  // Lets move faster than sales, so rent-to-rent stays in weeks for longer.
  const weeksUntil = kind === 'rent-to-rent' ? 12 * WEEK : 8 * WEEK;
  let text: string;
  if (age.days < weeksUntil) {
    const w = Math.floor(age.days / WEEK);
    text = `${w} week${w === 1 ? '' : 's'}`;
  } else {
    const m = Math.floor(age.days / 30.44);
    text = `${m} month${m === 1 ? '' : 's'}`;
  }
  return age.source === 'sighting' ? `at least ${text}` : text;
}

/**
 * How many times the price has been cut: our own recorded cuts, with the
 * stored motivation verdict as a floor (it may have seen a cut from before
 * we started watching). Rises never count.
 */
export function reductionCount(facts: Pick<DealFacts, 'priceHistory' | 'motivation'>): number {
  const cuts = recordedCuts(facts.priceHistory);
  const fired = parseMotivation(facts.motivation)?.fired ?? [];
  const floor = fired.includes('reduced_repeatedly') ? 2 : fired.includes('price_reduced') ? 1 : 0;
  return Math.max(cuts, floor);
}

/** "once", "twice", "3 times"; null for none. */
export function countWord(n: number): string | null {
  if (!Number.isInteger(n) || n <= 0) return null;
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/** "2-bedroom", "studio" for 0, null when unknown or nonsense. */
export function bedroomsText(n: number | null): string | null {
  if (n === null || !Number.isInteger(n) || n < 0 || n > 20) return null;
  return n === 0 ? 'studio' : `${n}-bedroom`;
}

/** The member's name for a sign-off. An email address is not a name. */
export function memberNameText(name: string | null | undefined): string | null {
  const v = cleanValue(name);
  if (!v || v.includes('@') || v.length > 80) return null;
  return v;
}

/** Which way the listing has gone off the market, when it has. "Listed too long" is still on the market. */
export type OffMarketReason = 'sold' | 'under_offer' | 'let_agreed' | 'removed';

export function offMarketReason(facts: Pick<DealFacts, 'dealStatus' | 'retiredReason'>): OffMarketReason | null {
  if (facts.dealStatus !== 'retired') return null;
  const r = facts.retiredReason;
  return r === 'sold' || r === 'under_offer' || r === 'let_agreed' || r === 'removed' ? r : null;
}

/** The price was last read more than a week ago. */
export const STALE_PRICE_DAYS = 7;

export function priceIsStale(facts: Pick<DealFacts, 'lastConfirmedAt'>, now: Date): boolean {
  if (!facts.lastConfirmedAt) return false;
  const t = Date.parse(facts.lastConfirmedAt);
  return Number.isFinite(t) && now.getTime() - t > STALE_PRICE_DAYS * 24 * 60 * 60 * 1000;
}

/** Every field a message may use, each null when this deal does not have it. */
export function messageFields(facts: DealFacts, kind: StepKind, memberName: string | null, now: Date): Record<MessageField, string | null> & Fields {
  const asking = askingAmount(facts, kind);
  return {
    address: cleanValue(facts.address),
    town: cleanValue(facts.town),
    bedrooms: bedroomsText(facts.bedrooms),
    askingPrice: kind === 'purchase' && asking !== null ? gbp(asking) : null,
    askingRent: kind === 'rent-to-rent' && asking !== null ? `${gbp(asking)} a month` : null,
    timeOnMarket: formatAge(timeOnMarket(facts, now), kind),
    memberName: memberNameText(memberName),
    // Filled in the browser from the amount the member types (offer-amount.ts).
    offerAmount: null,
  };
}
