/**
 * The one-off interest-only backfill (Batch 16b), the rules only. Every
 * screen already reads a stored purchase deal at the current mortgage
 * (listing/deal.ts atCurrentMortgage, at the parse points); this job
 * rewrites the stored JSON to match, so anything that reads the rows later
 * (Batch 17's refinance, Batch 28's buy-to-let, SQL) sees the same figures.
 * The dry run doubles as the before/after report Zac asked for: what the
 * live sale deals do on the repayment formula they were saved with, and on
 * the interest-only one, on the same inputs the cards use.
 *
 * Pure: no network, no database, no `server-only`. The job itself is in
 * mortgage-backfill-run.ts.
 */
import { atCurrentMortgage, interestOnlyMortgage, maxPriceForProfit, monthlyMortgage, type MortgageType, type PurchaseDeal } from './deal.ts';
import { profitRange } from '../marketplace/profit-range.ts';
import { ROUND_TO } from '../pipeline/offer-range.ts';
import { TAILORING } from '../tailoring/config.ts';

export const MORTGAGE_BACKFILL_KIND = 'mortgage_backfill';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A stored purchase deal carrying every field the refresh reads; null for a rental, junk or an older shape. */
export function storedPurchase(raw: unknown): PurchaseDeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.kind !== 'purchase') return null;
  for (const k of ['askingPrice', 'depositPct', 'mortgageRatePct', 'termYears', 'netOperating', 'cashRequired']) if (num(d[k]) === null) return null;
  return raw as PurchaseDeal;
}

/** The deal to write back when the stored one is not at the current mortgage; null when there is nothing to change. */
export function refreshedDeal(raw: unknown): PurchaseDeal | null {
  const d = storedPurchase(raw);
  if (!d) return null;
  const fresh = atCurrentMortgage(d);
  return fresh === d ? null : fresh;
}

// ── The before/after report ──

/** One live sale deal as the grid holds it: no address, no link. */
export interface LiveSaleRow {
  area: string | null;
  bedrooms: number | null;
  confidence: string | null;
  deal: unknown;
}

export interface Widths {
  high: number;
  medium: number;
  low: number;
}

export interface BeforeAfter {
  before: number;
  after: number;
}

export interface LiveSaleReport {
  /** Live sale deals with a stored purchase deal. */
  deals: number;
  /** Counts on the model's monthly cash flow, repayment → interest-only. */
  cashflowPositive: BeforeAfter;
  atLeast500: BeforeAfter;
  atLeast1000: BeforeAfter;
  /** Batch 14's profit check (the range's low end at or above the minimum) at each minimum in force, on the house finance. */
  profitCheck: { minProfitPcm: number; before: number; after: number }[];
  /** How much a month each deal gains: the smallest, the middle and the largest. */
  gainPcm: { min: number; median: number; max: number } | null;
}

/** The card's range for a deal at one mortgage type, on the house finance: the same call the grid makes. */
function rangeAt(row: LiveSaleRow, d: PurchaseDeal, mortgageType: MortgageType, widths: Widths) {
  return profitRange({ kind: 'sale', priceAmount: d.askingPrice, pricePeriod: 'total', bedrooms: row.bedrooms, grossRevenue: d.grossRevenue, confidence: row.confidence, finance: { mortgageType }, widths });
}

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * The live sale deals on the repayment formula and on interest-only, on the
 * same inputs the cards use (the deal's income, the house deposit and rate,
 * the range width for its confidence). `minimums`: the £500 default and
 * every minimum a member has set.
 */
export function liveSaleReport(rows: LiveSaleRow[], minimums: number[], widths: Widths): LiveSaleReport {
  const mins = [...new Set(minimums.filter((m) => Number.isFinite(m)))].sort((a, b) => a - b);
  if (mins.length === 0) mins.push(TAILORING.fallbackMinProfitPcm);
  const out: LiveSaleReport = {
    deals: 0,
    cashflowPositive: { before: 0, after: 0 },
    atLeast500: { before: 0, after: 0 },
    atLeast1000: { before: 0, after: 0 },
    profitCheck: mins.map((minProfitPcm) => ({ minProfitPcm, before: 0, after: 0 })),
    gainPcm: null,
  };
  const gains: number[] = [];
  for (const row of rows) {
    const d = storedPurchase(row.deal);
    if (!d) continue;
    const before = rangeAt(row, d, 'repayment', widths);
    const after = rangeAt(row, d, 'interest_only', widths);
    if (!before || !after) continue;
    out.deals += 1;
    const tally = (k: 'cashflowPositive' | 'atLeast500' | 'atLeast1000', floor: number, strict: boolean) => {
      if (strict ? before.midPcm > floor : before.midPcm >= floor) out[k].before += 1;
      if (strict ? after.midPcm > floor : after.midPcm >= floor) out[k].after += 1;
    };
    tally('cashflowPositive', 0, true);
    tally('atLeast500', 500, false);
    tally('atLeast1000', 1000, false);
    for (const check of out.profitCheck) {
      if (before.lowPcm >= check.minProfitPcm) check.before += 1;
      if (after.lowPcm >= check.minProfitPcm) check.after += 1;
    }
    gains.push(after.midPcm - before.midPcm);
  }
  if (gains.length > 0) {
    gains.sort((a, b) => a - b);
    out.gainPcm = { min: gains[0], median: Math.round(median(gains)), max: gains[gains.length - 1] };
  }
  return out;
}

// ── Five worked examples ──

export interface WorkedExample {
  area: string | null;
  bedrooms: number | null;
  price: number;
  loan: number;
  repaymentPcm: number;
  interestOnlyPcm: number;
  cashflowBefore: number;
  cashflowAfter: number;
  cashOnCashBefore: number;
  cashOnCashAfter: number;
  /** "£454,000", "none" or "any": the most you can pay for the minimum, rounded down to the offer step, on each formula. */
  mostYouCanPayBefore: string;
  mostYouCanPayAfter: string;
}

function payAt(d: PurchaseDeal, minProfitPcm: number, mortgageType: MortgageType): string {
  const r = maxPriceForProfit(d.netOperating, minProfitPcm, d.depositPct, d.mortgageRatePct, d.termYears, mortgageType);
  if ('none' in r) return 'none';
  if ('any' in r) return 'any';
  const step = ROUND_TO.purchase;
  const amount = Math.floor(r.price / step) * step;
  return amount > 0 ? `£${amount.toLocaleString('en-GB')}` : 'none';
}

/** The lowest-priced, the quartiles, the middle and the highest-priced live sale deal, each worked both ways at the minimum. */
export function workedExamples(rows: LiveSaleRow[], minProfitPcm: number = TAILORING.fallbackMinProfitPcm): WorkedExample[] {
  const deals = rows
    .map((row) => ({ row, d: storedPurchase(row.deal) }))
    .filter((x): x is { row: LiveSaleRow; d: PurchaseDeal } => x.d !== null && x.d.askingPrice > 0)
    .sort((a, b) => a.d.askingPrice - b.d.askingPrice);
  const n = deals.length;
  if (n === 0) return [];
  const at = (q: number) => Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))));
  const picks = [...new Set([0, at(0.25), at(0.5), at(0.75), n - 1])];
  return picks.map((i) => {
    const { row, d } = deals[i];
    const loan = d.askingPrice * (1 - d.depositPct / 100);
    const repayment = monthlyMortgage(loan, d.mortgageRatePct, d.termYears);
    const interestOnly = interestOnlyMortgage(loan, d.mortgageRatePct);
    const cfBefore = d.netOperating / 12 - repayment;
    const cfAfter = d.netOperating / 12 - interestOnly;
    const coc = (cf: number) => (d.cashRequired > 0 ? round1(((cf * 12) / d.cashRequired) * 100) : 0);
    return {
      area: row.area,
      bedrooms: row.bedrooms,
      price: d.askingPrice,
      loan: Math.round(loan),
      repaymentPcm: Math.round(repayment),
      interestOnlyPcm: Math.round(interestOnly),
      cashflowBefore: Math.round(cfBefore),
      cashflowAfter: Math.round(cfAfter),
      cashOnCashBefore: coc(cfBefore),
      cashOnCashAfter: coc(cfAfter),
      mostYouCanPayBefore: payAt(d, minProfitPcm, 'repayment'),
      mostYouCanPayAfter: payAt(d, minProfitPcm, 'interest_only'),
    };
  });
}

/** One line per example, for a run summary that keeps no lists. */
export function exampleLine(e: WorkedExample): string {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
  const signed = (n: number) => `${n < 0 ? '−' : ''}${gbp(Math.abs(n))}`;
  return `${e.area ?? '?'} · ${e.bedrooms ?? '?'} bed · ${gbp(e.price)}: loan ${gbp(e.loan)}, repayment ${gbp(e.repaymentPcm)}/mo → interest-only ${gbp(e.interestOnlyPcm)}/mo; cash flow ${signed(e.cashflowBefore)} → ${signed(e.cashflowAfter)}; cash on cash ${e.cashOnCashBefore}% → ${e.cashOnCashAfter}%; most you can pay ${e.mostYouCanPayBefore} → ${e.mostYouCanPayAfter}`;
}
