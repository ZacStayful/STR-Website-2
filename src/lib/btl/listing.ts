/**
 * Which sale listings can be a buy-to-let deal at all (Batch 28, Part A; Q9),
 * and the listing's own facts the maths needs: flat or house, and a flat's
 * service charge and ground rent.
 *
 * A BTL purchase is a whole home bought with a 75% mortgage and let to
 * long-term tenants, so the short-let rules do not apply (a leasehold flat
 * that is silent on short lets is fine), but a lender's do:
 *
 *   never   rooms and house shares, shared ownership, retirement / age-
 *           restricted homes, park homes, anything priced below a whole
 *           home (the short-let filter's own rules, reused), auction lots,
 *           "cash buyers only" and other unmortgageable listings, non-
 *           standard construction, and a lease shorter than 70 years;
 *   flagged a lease shorter than 85 years ("Short lease").
 *
 * Pure: no network, no database, no server-only.
 */

import { judge, propertyKind, tenureOf, isFlatLike } from '../listing/suitability.ts';
import type { SourcedListing } from '../listing/sourcing.ts';
import { DEFAULT_BTL_FLATS, DEFAULT_BTL_LISTING, type BtlFlatSettings, type BtlListingSettings } from './config.ts';
import type { ListingKind } from './rent.ts';

export const BTL_UNSUITABLE_REASONS = {
  room: 'Room or house share',
  shared_ownership: 'Shared ownership',
  age_restricted: 'Retirement or age-restricted',
  park_home: 'Park home or holiday-park lodge',
  low_price: 'Sale price too low for a whole property',
  auction: 'Auction lot',
  cash_only: 'Cash buyers only (no mortgage)',
  non_standard: 'Non-standard construction',
  short_lease: 'Lease too short for a mortgage',
} as const;

export type BtlUnsuitable = keyof typeof BTL_UNSUITABLE_REASONS;
export type BtlSuitability = 'ok' | BtlUnsuitable;

const CASH_ONLY = /cash (?:buyers?|purchasers?|purchase) only|cash only|un-?mortgageable|non-?mortgageable|not (?:suitable|eligible) for (?:a )?mortgage|mortgage (?:lenders? )?may not lend/i;
const NON_STANDARD = /non[- ]?standard construction|pre-?fab(?:ricated)?\b|\bairey\b|no[- ]fines|cornish unit|\breema\b|steel[- ]framed house/i;
const AUCTION = /\bauction\b|modern method of (?:sale|auction)/i;

type ListingFacts = Pick<SourcedListing, 'kind' | 'title' | 'rawType' | 'priceQualifier' | 'tenure' | 'features' | 'price' | 'sharedOwnership' | 'auction' | 'yearsRemainingOnLease'>;

function textOf(l: ListingFacts): string {
  return [l.title, l.rawType, l.priceQualifier ?? null, l.tenure ?? null, ...(l.features ?? [])].filter(Boolean).join(' | ');
}

/** Whether this sale can be a BTL deal: 'ok', or the first reason it cannot. */
export function btlSuitability(l: ListingFacts, s: BtlListingSettings = DEFAULT_BTL_LISTING): BtlSuitability {
  if (l.kind !== 'sale') return 'room';
  const text = textOf(l);
  const tenureLine = (l.features ?? []).find((x) => /tenure/i.test(x)) ?? null;
  // The whole-home rules are the short-let filter's own. Short-let permission
  // is irrelevant to a long let, so it is passed as given and the leasehold
  // and "no short lets" verdicts can never come back.
  const base = judge({
    kind: 'sale',
    text,
    tenure: tenureOf(l.tenure ?? null, tenureLine),
    flatLike: isFlatLike(l.rawType ?? null, l.title),
    salePrice: l.price?.period === 'total' ? l.price.amount : null,
    sharedOwnership: l.sharedOwnership ?? null,
    shortLetsPermitted: true,
    pageChecked: l.sharedOwnership !== null && l.sharedOwnership !== undefined,
  });
  if (base === 'room' || base === 'shared_ownership' || base === 'age_restricted' || base === 'park_home' || base === 'low_price') return base;
  if (l.auction === true || AUCTION.test(text)) return 'auction';
  if (CASH_ONLY.test(text)) return 'cash_only';
  if (NON_STANDARD.test(text)) return 'non_standard';
  const lease = l.yearsRemainingOnLease ?? null;
  if (lease !== null && lease > 0 && lease < s.minLeaseYears) return 'short_lease';
  return 'ok';
}

/** A lease short enough to warn about (but not to refuse). */
export function shortLeaseFlag(l: Pick<SourcedListing, 'yearsRemainingOnLease'>, s: BtlListingSettings = DEFAULT_BTL_LISTING): boolean {
  const lease = l.yearsRemainingOnLease ?? null;
  return lease !== null && lease > 0 && lease < s.shortLeaseYears;
}

export function listingKind(l: Pick<SourcedListing, 'rawType' | 'title'>): ListingKind {
  return propertyKind(l.rawType ?? null, l.title ?? null);
}

/** A £ a year figure as low / middle / high. */
export interface YearRange {
  low: number;
  mid: number;
  high: number;
}

export interface FlatCharges {
  serviceCharge: YearRange;
  groundRent: YearRange;
  /** The service charge came from the listing (ground rent may still be the estimate). */
  confirmed: boolean;
}

/**
 * A flat's yearly service charge and ground rent: the listing's own figures
 * when the page gave them (exact), otherwise the estimate (±spread), and
 * the card says "Service charge not confirmed". Houses carry neither.
 */
export function flatCharges(kind: ListingKind, listed: { serviceChargeYear?: number | null; groundRentYear?: number | null }, londonish: boolean, s: BtlFlatSettings = DEFAULT_BTL_FLATS): FlatCharges | null {
  if (kind !== 'flat') return null;
  const spread = s.spreadPct / 100;
  const sc = listed.serviceChargeYear ?? null;
  const gr = listed.groundRentYear ?? null;
  const scEst = londonish ? s.serviceChargeLondonYear : s.serviceChargeYear;
  const exact = (n: number): YearRange => ({ low: n, mid: n, high: n });
  const est = (n: number): YearRange => ({ low: Math.round(n * (1 - spread)), mid: n, high: Math.round(n * (1 + spread)) });
  const serviceCharge = sc !== null && sc >= 0 ? exact(sc) : est(scEst);
  const groundRent = gr !== null && gr >= 0 ? exact(gr) : { low: 0, mid: s.groundRentYear, high: s.groundRentYear * 2 };
  return { serviceCharge, groundRent, confirmed: sc !== null && sc >= 0 };
}
