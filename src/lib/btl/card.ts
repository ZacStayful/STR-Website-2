/**
 * A deal's buy-to-let lens as stored on its marketplace_deals row (the `btl`
 * column), and what a card shows from it (Batch 28, Parts A and F).
 *
 * The stored card holds the deal-level figures only: the rent range and its
 * confidence, every BTL figure as a range, the lender test, growth, and the
 * flags. Nothing here can identify the home: no address, postcode, link,
 * photo or coordinates (the outcode is already public on the row). What
 * depends on the member (their priority, their cash band, the benchmark
 * near them) is worked out when the card is shown, from this and the
 * stored benchmarks.
 *
 *   THE THREE NUMBERS (Part F), by "What are you after?":
 *     Money each month   cash in · £/month · ROI
 *     Value going up     cash in · 5-yr value · £/month
 *     A bit of both      cash in · ROI · 5-yr growth
 *   Every number is a range. Flags where they apply: "Service charge not
 *   confirmed", "EPC below C", "Short lease", "Rough rent estimate", and
 *   "24 miles from Leeds" when the search widened.
 *
 * Pure: no network, no database, no server-only.
 */

import type { Confidence } from '../listing/screen.ts';
import type { TaxCountry, TaxName } from '../listing/stamp-duty.ts';
import { formatRange, moneyRange } from '../marketplace/profit-range.ts';
import type { BtlDeal, CashBand, EpcRating, Range3, RentTest } from './deal.ts';
import { isEpcRating } from './deal.ts';
import type { BtlGrowth } from './growth.ts';
import type { ListingKind, RentRange } from './rent.ts';
import { floorsPass, type BtlJudged, type BtlPriority } from './rules.ts';

export const BTL_CARD_VERSION = 1;

export interface BtlCard {
  v: number;
  computedAt: string;
  price: number;
  bedrooms: number;
  kind: ListingKind;
  country: TaxCountry;
  outcode: string | null;
  region: string | null;
  rent: Pick<RentRange, 'low' | 'mid' | 'high' | 'confidence' | 'compCount' | 'valuation'> & { base: number | null; compsMedian: number | null };
  ratePct: number;
  rateFallback: boolean;
  rateDate: string | null;
  loan: number;
  mortgageMonthly: number;
  monthlyCosts: Range3;
  costLines: BtlDeal['costLines'];
  cashflowMonthly: Range3;
  grossYieldPct: Range3;
  netYieldPct: Range3;
  cashIn: Range3;
  deposit: number;
  tax: number;
  taxName: TaxName;
  buyingCosts: number;
  epcAllowance: number;
  roiPct: Range3;
  rentTest: RentTest;
  growth: { annualPct: Range3; value5y: { low: number; high: number }; growth5yPct: number; growth1yPct: number | null; turning: boolean } | null;
  /** The cash band the middle cash in falls in. */
  band: CashBand | null;
  flags: {
    /** null for a house. */
    serviceChargeConfirmed: boolean | null;
    epc: EpcRating | null;
    epcChecked: boolean;
    shortLease: boolean;
  };
  /** The hard rules: the lender test on the middle rent, and low-end cashflow ≥ £0. */
  floorsOk: boolean;
}

export function judgedOf(card: Pick<BtlCard, 'roiPct' | 'growth' | 'cashflowMonthly' | 'rentTest'>): BtlJudged {
  return { roiPct: card.roiPct, growthPct: card.growth?.annualPct ?? null, cashflowLow: card.cashflowMonthly.low, rentTestPass: card.rentTest.pass };
}

export interface BuildCardInput {
  computedAt: string;
  bedrooms: number;
  kind: ListingKind;
  country: TaxCountry;
  outcode: string | null;
  region: string | null;
  rent: RentRange;
  deal: BtlDeal;
  growth: BtlGrowth | null;
  rateDate: string | null;
  band: CashBand | null;
  serviceChargeConfirmed: boolean | null;
  epc: EpcRating | null;
  shortLease: boolean;
}

export function buildBtlCard(i: BuildCardInput): BtlCard {
  const d = i.deal;
  const card: BtlCard = {
    v: BTL_CARD_VERSION,
    computedAt: i.computedAt,
    price: d.price,
    bedrooms: i.bedrooms,
    kind: i.kind,
    country: i.country,
    outcode: i.outcode,
    region: i.region,
    rent: { low: i.rent.low, mid: i.rent.mid, high: i.rent.high, confidence: i.rent.confidence, compCount: i.rent.compCount, valuation: i.rent.valuation, base: i.rent.base, compsMedian: i.rent.compsMedian },
    ratePct: d.ratePct,
    rateFallback: d.rateFallback,
    rateDate: i.rateDate,
    loan: d.loan,
    mortgageMonthly: d.mortgageMonthly,
    monthlyCosts: d.monthlyCosts,
    costLines: d.costLines,
    cashflowMonthly: d.cashflowMonthly,
    grossYieldPct: d.grossYieldPct,
    netYieldPct: d.netYieldPct,
    cashIn: d.cashIn,
    deposit: d.deposit,
    tax: d.tax,
    taxName: d.taxName,
    buyingCosts: d.buyingCosts,
    epcAllowance: d.epcAllowance,
    roiPct: d.roiPct,
    rentTest: d.rentTest,
    growth: i.growth
      ? { annualPct: i.growth.annualPct, value5y: { low: i.growth.value5y.low, high: i.growth.value5y.high }, growth5yPct: i.growth.value5y.historicGrowthPct, growth1yPct: i.growth.growth1yPct, turning: i.growth.turning }
      : null,
    band: i.band,
    flags: { serviceChargeConfirmed: i.serviceChargeConfirmed, epc: i.epc, epcChecked: i.epc !== null, shortLease: i.shortLease },
    floorsOk: false,
  };
  card.floorsOk = floorsPass(judgedOf(card));
  return card;
}

function obj(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return obj(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function range(raw: unknown): Range3 | null {
  const o = obj(raw);
  if (!o) return null;
  const [low, mid, high] = [o.low, o.mid, o.high].map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  return low === null || mid === null || high === null ? null : { low, mid, high };
}

/** A stored card, or null when it is missing, from another version, or damaged: nothing downstream ever crashes on one. */
export function parseBtlCard(raw: unknown): BtlCard | null {
  const o = obj(raw);
  if (!o || o.v !== BTL_CARD_VERSION) return null;
  const needed = ['monthlyCosts', 'cashflowMonthly', 'grossYieldPct', 'netYieldPct', 'cashIn', 'roiPct'].map((k) => range(o[k]));
  if (needed.some((r) => r === null)) return null;
  const rent = obj(o.rent);
  const test = obj(o.rentTest);
  if (!rent || !range(rent) || !test || typeof test.pass !== 'boolean' || typeof o.price !== 'number') return null;
  const flags = obj(o.flags) ?? {};
  const card = o as unknown as BtlCard;
  return {
    ...card,
    growth: card.growth && range((card.growth as unknown as Record<string, unknown>).annualPct) ? card.growth : null,
    flags: {
      serviceChargeConfirmed: typeof flags.serviceChargeConfirmed === 'boolean' ? flags.serviceChargeConfirmed : null,
      epc: isEpcRating(flags.epc) ? flags.epc : null,
      epcChecked: flags.epcChecked === true,
      shortLease: flags.shortLease === true,
    },
  };
}

// ─── What a card shows ────────────────────────────────────────────────

export type BtlNumberKey = 'btlCash' | 'btlMonthly' | 'btlRoi' | 'btlValue5y' | 'btlGrowth';

export interface BtlCardNumber {
  key: BtlNumberKey;
  label: string;
  value: string;
  help: string;
}

const PLAN: Record<BtlPriority, BtlNumberKey[]> = {
  income: ['btlCash', 'btlMonthly', 'btlRoi'],
  growth: ['btlCash', 'btlValue5y', 'btlMonthly'],
  both: ['btlCash', 'btlRoi', 'btlGrowth'],
};

export const BTL_NUMBER_HELP: Record<BtlNumberKey, string> = {
  btlCash: 'Deposit, the tax on a second home and buying costs. The top end adds an energy upgrade allowance.',
  btlMonthly: 'Rent less the running costs and the mortgage interest, before tax.',
  btlRoi: 'A year’s cashflow as a share of the cash you put in, before tax.',
  btlValue5y: 'The price in five years if the area repeats its last five years, and at half that pace. History, not a forecast.',
  btlGrowth: 'How fast prices here rose a year over the last five, and half that pace. History, not a forecast.',
};

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

function pctRange(r: Pick<Range3, 'low' | 'high'>, suffix = ''): string {
  const sep = r.low < 0 || r.high < 0 ? ' to ' : '–';
  return `${pct1(r.low)}${sep}${pct1(r.high)}${suffix}`;
}

function numberFor(card: BtlCard, key: BtlNumberKey): BtlCardNumber | null {
  const help = BTL_NUMBER_HELP[key];
  switch (key) {
    case 'btlCash':
      return { key, label: 'Cash in', value: card.cashIn.low === card.cashIn.high ? gbp(card.cashIn.low) : moneyRange([card.cashIn.low, card.cashIn.high]), help };
    case 'btlMonthly':
      return { key, label: 'A month', value: formatRange(card.cashflowMonthly.low, card.cashflowMonthly.high), help };
    case 'btlRoi':
      return { key, label: 'ROI', value: pctRange(card.roiPct), help };
    case 'btlValue5y':
      return card.growth ? { key, label: 'Value in 5 years', value: moneyRange([card.growth.value5y.low, card.growth.value5y.high]), help } : null;
    case 'btlGrowth':
      return card.growth ? { key, label: '5-yr growth', value: pctRange(card.growth.annualPct, ' a year'), help } : null;
  }
}

/** Exactly three numbers when the figures allow (a missing growth figure falls back to the next useful number). */
export function btlNumbers(card: BtlCard, priority: BtlPriority): BtlCardNumber[] {
  const keys = [...PLAN[priority], 'btlMonthly', 'btlRoi'] as BtlNumberKey[];
  const out: BtlCardNumber[] = [];
  for (const k of keys) {
    if (out.length === 3) break;
    if (out.some((n) => n.key === k)) continue;
    const n = numberFor(card, k);
    if (n) out.push(n);
  }
  return out;
}

const BELOW_C = new Set<EpcRating>(['D', 'E', 'F', 'G']);

/** The flags a card shows. `distance` is "24 miles from Leeds" when the deal is outside the member's own areas. */
export function btlFlags(card: BtlCard, distance: string | null = null): string[] {
  const out: string[] = [];
  if (card.flags.serviceChargeConfirmed === false) out.push('Service charge not confirmed');
  if (card.flags.epc && BELOW_C.has(card.flags.epc)) out.push('EPC below C');
  // The top of the cash in carries an upgrade allowance until the rating is known (decided, Q10).
  else if (!card.flags.epcChecked) out.push('EPC not checked');
  if (card.flags.shortLease) out.push('Short lease');
  if (card.rent.confidence === 'low') out.push('Rough rent estimate');
  if (distance) out.push(distance);
  return out;
}

/** Confidence words the deal page uses. */
export const RENT_CONFIDENCE_WORDS: Record<Confidence, string> = {
  high: 'Good rent evidence',
  medium: 'Some rent evidence',
  low: 'Rough rent estimate',
};

/**
 * A buy-to-let deal's one line in an email or a list: its cashflow and cash
 * in, both ranges, from the stored card ("£315–£511/mo · £51,200–£56,200 cash
 * in · buy to let, before tax").
 */
export function btlFigureLine(card: { btl?: BtlCard | null }): string {
  const c = card.btl ?? null;
  if (!c) return 'Buy to let: figures being updated';
  return `${formatRange(c.cashflowMonthly.low, c.cashflowMonthly.high)} · ${btlNumbers(c, 'income')[0].value} cash in · buy to let, before tax`;
}
