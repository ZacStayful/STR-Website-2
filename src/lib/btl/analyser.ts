/**
 * The Full analysis's "Buy to let instead?" (Batch 28, Part H): the same
 * btlDeal() on the report's own long-let valuation (already bought, so no
 * extra charge), its EPC and its outcode's growth. It sits beside the
 * existing short-let vs long-let comparison and does not repeat it: this is
 * what the home makes let to long-term tenants on a buy-to-let mortgage.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AnalysisResult } from '../types.ts';
import { countryForPostcode } from '../listing/stamp-duty.ts';
import { buildBtlCard, type BtlCard } from './card.ts';
import { DEFAULT_BTL_SETTINGS } from './config.ts';
import { btlDeal, cashBandFor, isEpcRating } from './deal.ts';
import { growthRange } from './growth.ts';
import type { RentRange } from './rent.ts';
import { DEFAULT_PROJECT_COSTS } from '../project/config.ts';

/** The price the report was worked at: the asking price, else the listing's, else PropertyData's value. */
export function analysedPrice(r: Pick<AnalysisResult, 'deal' | 'sourceListing' | 'propertyValuation'>): number | null {
  if (r.deal && r.deal.kind === 'purchase' && r.deal.askingPrice > 0) return r.deal.askingPrice;
  const p = r.sourceListing?.price;
  if (p && p.period === 'total' && p.amount > 0) return p.amount;
  const v = r.propertyValuation?.estimatedValue ?? null;
  return v !== null && v > 0 ? v : null;
}

/**
 * The report's long-let valuation as a rent range: PropertyData's own low
 * and high, never narrower than ±10% around its figure (the buy-to-let
 * rent rule's minimum width).
 */
export function rentFromLongLet(l: AnalysisResult['longLet'] | null | undefined, minWidthPct = DEFAULT_BTL_SETTINGS.rent.minWidthPct): RentRange | null {
  const mid = l?.monthlyRent ?? 0;
  if (!(mid > 0)) return null;
  const w = minWidthPct / 100;
  const low = Math.round(Math.min(l!.estimateLow > 0 ? l!.estimateLow : mid, mid * (1 - w)));
  const high = Math.round(Math.max(l!.estimateHigh > 0 ? l!.estimateHigh : mid, mid * (1 + w)));
  return { low, mid: Math.round(mid), high, confidence: (l!.comparables?.length ?? 0) >= 5 ? 'medium' : 'low', compCount: l!.comparables?.length ?? 0, base: null, compsMedian: null, disagree: false, valuation: Math.round(mid), sources: ['valuation'] };
}

/** "Buy to let instead?": its figures as a buy-to-let card, or null when the report has no price or rent. */
export function btlInsteadFor(r: AnalysisResult, now: Date = new Date()): BtlCard | null {
  const price = analysedPrice(r);
  const rent = rentFromLongLet(r.longLet);
  if (price === null || !rent) return null;
  const country = countryForPostcode(r.property.postcode);
  const epc = r.epc?.rating?.toUpperCase() ?? null;
  const rating = isEpcRating(epc) ? epc : null;
  const live = r.deal && r.deal.kind === 'purchase' ? (r.deal.mortgageRateLive ?? null) : null;
  const s = DEFAULT_BTL_SETTINGS;
  const deal = btlDeal(price, rent, { ratePct: live?.ratePct ?? null, country, buyingCosts: DEFAULT_PROJECT_COSTS.buyingCosts, flat: null, epc: rating, finance: s.finance, costs: s.costs, epcSettings: s.epc });
  if (!deal) return null;
  const outcode = r.growth?.outcode ?? null;
  const growth = growthRange(price, r.growth?.growth5y ?? null, r.growth?.growth1y ?? null, outcode ?? '', r.growth?.asOf ?? null);
  return buildBtlCard({
    computedAt: now.toISOString(),
    bedrooms: r.property.bedrooms,
    kind: 'unknown',
    country,
    outcode,
    region: r.growth?.region ?? null,
    rent,
    deal,
    growth,
    rateDate: live?.date ?? null,
    band: cashBandFor(deal.cashIn.mid, s.bands),
    serviceChargeConfirmed: null,
    epc: rating,
    shortLease: false,
  });
}
