/**
 * Auction lots: telling one from an ordinary sale, and what one really
 * costs.
 *
 * DETECTION. "Guide price" alone is NOT an auction: agents use it on
 * ordinary sales (of the 13 live "Guide price" deals on 28 Sep, one was an
 * auction). A listing is an auction lot when:
 *   - Rightmove flags it (`auctionOnly`), or
 *   - its text says so in context ("for sale by auction", "scheduled for
 *     online auction", "modern method of auction", "auction date", "legal
 *     pack" …), or
 *   - PropertyData puts it in its auction cohort.
 * The wording needs context because plenty of homes sit on Auction Close or
 * in The Old Auction House.
 *
 * COST. The guide is a starting point, not a price: the model buys at the
 * guide plus the usual uplift, pays the auction house's premium, and
 * completes in weeks on a bridging loan before refinancing onto the member's
 * own mortgage. Cash in is the bridging deposit, stamp duty on the price,
 * the premium, the bridging fees and the setup; the cash flow shown is the
 * member's own mortgage after the refinance, with the bridging interest as
 * its own line. The terms are a setting (billing_settings.auction_model).
 *
 * Pure: no network, no database, no server-only.
 */

export const AUCTION_MODEL_KEY = 'auction_model';

/** Auction wording, in context (see above). Also motivation.ts's auction signal. */
export const AUCTION_WORDING =
  /\b(?:by|via|at|for sale by|sold by|going to|scheduled for(?: an?)?(?: online)?) auction\b|\bonline auction\b|\bmodern method of auction\b|\bauction (?:guide|lot|date|ends?|end date|terms|legal pack|day)\b|\bunder the hammer\b|\blegal pack\b|\bbuyer'?s premium\b/i;

/** The modern method: a reservation fee instead of a fixed premium. Online auctions are nearly all run this way. */
const MODERN_METHOD = /\bmodern method\b|\breservation fee\b|\bonline auction\b|\biam ?sold\b/i;

export type AuctionMethod = 'traditional' | 'modern';

export interface AuctionEvidence {
  /** Rightmove's `auctionOnly`; null when the page was not read or does not say. */
  flag?: boolean | null;
  /** Title, qualifier, features and (on a page read) the description. */
  text?: string | null;
  /** PropertyData's auction cohort. */
  inCohort?: boolean;
}

export function isAuctionLot(e: AuctionEvidence): boolean {
  if (e.flag === true || e.inCohort === true) return true;
  return AUCTION_WORDING.test(e.text ?? '');
}

export function auctionMethod(text: string | null | undefined): AuctionMethod {
  return MODERN_METHOD.test(text ?? '') ? 'modern' : 'traditional';
}

export interface AuctionTerms {
  /** How far over the guide a lot usually goes, %. */
  upliftPct: number;
  /** A traditional room's buyer's premium, £ including VAT. */
  traditionalPremium: number;
  /** The modern method's reservation fee, % of the price before VAT … */
  modernPremiumPct: number;
  /** … VAT on it, % … */
  vatPct: number;
  /** … and its floor, £ including VAT. */
  modernPremiumMin: number;
  /** Bridging loan to value, %. */
  bridgingLtvPct: number;
  /** Bridging interest a month, %. */
  bridgingMonthlyPct: number;
  /** Arrangement fee, % of the loan. */
  arrangementPct: number;
  /** Legal and valuation for the bridge, £. */
  legalAndValuation: number;
  /** Months on the bridge before the refinance. */
  termMonths: number;
}

export const DEFAULT_AUCTION_TERMS: AuctionTerms = {
  upliftPct: 15,
  traditionalPremium: 1_500,
  modernPremiumPct: 4.5,
  vatPct: 20,
  modernPremiumMin: 6_000,
  bridgingLtvPct: 70,
  bridgingMonthlyPct: 0.85,
  arrangementPct: 2,
  legalAndValuation: 2_000,
  termMonths: 12,
};

const BOUNDS: { [K in keyof AuctionTerms]: [number, number] } = {
  upliftPct: [0, 100],
  traditionalPremium: [0, 50_000],
  modernPremiumPct: [0, 20],
  vatPct: [0, 50],
  modernPremiumMin: [0, 50_000],
  bridgingLtvPct: [0, 100],
  bridgingMonthlyPct: [0, 5],
  arrangementPct: [0, 10],
  legalAndValuation: [0, 50_000],
  termMonths: [1, 36],
};

/** The stored terms (an object, or its JSON); a missing or out-of-bounds field keeps its default. */
export function parseAuctionTerms(raw: unknown): AuctionTerms {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      o = null;
    }
  }
  const src = o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  const out = { ...DEFAULT_AUCTION_TERMS };
  for (const key of Object.keys(BOUNDS) as (keyof AuctionTerms)[]) {
    const v = typeof src[key] === 'number' ? (src[key] as number) : typeof src[key] === 'string' && src[key] !== '' ? Number(src[key]) : Number.NaN;
    const [min, max] = BOUNDS[key];
    if (Number.isFinite(v) && v >= min && v <= max) out[key] = v;
  }
  return out;
}

/** The price the model buys at: the guide plus the usual uplift, to the pound. */
export function auctionPrice(guide: number, t: AuctionTerms = DEFAULT_AUCTION_TERMS): number {
  return Math.round(guide * (1 + t.upliftPct / 100));
}

/** The auction house's fee on top of the price, £ including VAT. */
export function buyersPremium(price: number, method: AuctionMethod, t: AuctionTerms = DEFAULT_AUCTION_TERMS): number {
  if (method === 'traditional') return Math.round(t.traditionalPremium);
  return Math.round(Math.max(t.modernPremiumMin, price * (t.modernPremiumPct / 100) * (1 + t.vatPct / 100)));
}

export interface AuctionCash {
  price: number;
  premium: number;
  /** Paid in at completion: the price less the bridging loan. */
  deposit: number;
  loan: number;
  /** Arrangement fee plus legal and valuation. */
  fees: number;
  /** Interest over the bridge, paid off from the refinance: the bridging-cost line. */
  interest: number;
  /** Deposit + stamp duty + premium + fees + setup. */
  cashRequired: number;
}

/** What buying at auction takes up front, on a bridging loan. */
export function auctionCash(price: number, stampDuty: number, setupCost: number, method: AuctionMethod, t: AuctionTerms = DEFAULT_AUCTION_TERMS): AuctionCash {
  const loan = price * (t.bridgingLtvPct / 100);
  const deposit = price - loan;
  const premium = buyersPremium(price, method, t);
  const fees = loan * (t.arrangementPct / 100) + t.legalAndValuation;
  const interest = loan * (t.bridgingMonthlyPct / 100) * t.termMonths;
  return {
    price,
    premium,
    deposit: Math.round(deposit),
    loan: Math.round(loan),
    fees: Math.round(fees),
    interest: Math.round(interest),
    cashRequired: Math.round(deposit + stampDuty + premium + fees + setupCost),
  };
}
