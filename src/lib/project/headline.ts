/**
 * What a Project deal shows before it is opened (Part F): the "Project" badge
 * and exactly three numbers,
 *
 *   Works ~£14k–£26k · £22k value added · £550–£750/mo after works
 *
 * plus Batch 16's cash line as the project's own cash needed, a range ("£45k–
 * £58k cash in", Q26). Numbers only: no line, reason, photo number or place
 * ever leaves the private estimate before the deal is opened.
 *
 * `ProjectCardData` is what marketplace_deals.project holds (card-safe by
 * construction). The profit after works is worked out per member at render
 * time, from their own finance and the deal's own income, like every other
 * range.
 *
 * Pure: no network, no database, no server-only.
 */

import { shortMoney } from '../deal-quality/streams.ts';
import type { FinanceDefaults } from '../listing/deal.ts';
import { rangeCaption, type ProfitRangeInput } from '../marketplace/profit-range.ts';
import type { ProjectLevel } from './costing.ts';
import type { ProjectEstimate } from './estimate.ts';
import { profitAfterWorksRange, type ProjectProfitRange } from './finance.ts';

export interface ProjectCardData {
  v: 1;
  level: ProjectLevel;
  /** The price the estimate was made at: a different price on the row means it needs re-costing. */
  price: number;
  bedrooms: number;
  worksLow: number;
  worksHigh: number;
  /** Value after works (estimate). */
  value: number;
  valueAdded: number;
  valueAddedPct: number;
  ceilingApplied: boolean;
  months: number;
  /** Cash needed at the house finance (a 25% deposit, or the bridge), works low / high. */
  cashLow: number;
  cashHigh: number;
  /** A full project's money left in after the refinance; null for a light refresh. */
  moneyLeftInLow: number | null;
  moneyLeftInHigh: number | null;
  refinancePct: number | null;
  estimatedAt: string;
}

export function projectCardData(e: ProjectEstimate, bedrooms: number, now: Date): ProjectCardData {
  return {
    v: 1,
    level: e.level,
    price: e.finance.price,
    bedrooms,
    worksLow: e.works.low,
    worksHigh: e.works.high,
    value: e.value.value,
    valueAdded: e.test.valueAdded,
    valueAddedPct: e.test.valueAddedPct,
    ceilingApplied: e.value.ceilingApplied,
    months: e.finance.months,
    cashLow: e.finance.cash.low,
    cashHigh: e.finance.cash.high,
    moneyLeftInLow: e.finance.refinance?.moneyLeftIn.low ?? null,
    moneyLeftInHigh: e.finance.refinance?.moneyLeftIn.high ?? null,
    refinancePct: e.finance.refinance?.pct ?? null,
    estimatedAt: now.toISOString(),
  };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Tolerant read of the stored column: anything unusable reads as "not a Project deal". */
export function parseProjectCard(raw: unknown): ProjectCardData | null {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.v !== 1 || (r.level !== 'light' && r.level !== 'full')) return null;
  const need = ['price', 'bedrooms', 'worksLow', 'worksHigh', 'value', 'valueAdded', 'valueAddedPct', 'months', 'cashLow', 'cashHigh'] as const;
  const got: Record<string, number> = {};
  for (const k of need) {
    const n = num(r[k]);
    if (n === null) return null;
    got[k] = n;
  }
  return {
    v: 1,
    level: r.level,
    price: got.price,
    bedrooms: got.bedrooms,
    worksLow: got.worksLow,
    worksHigh: got.worksHigh,
    value: got.value,
    valueAdded: got.valueAdded,
    valueAddedPct: got.valueAddedPct,
    ceilingApplied: r.ceilingApplied === true,
    months: got.months,
    cashLow: got.cashLow,
    cashHigh: got.cashHigh,
    moneyLeftInLow: num(r.moneyLeftInLow),
    moneyLeftInHigh: num(r.moneyLeftInHigh),
    refinancePct: num(r.refinancePct),
    estimatedAt: typeof r.estimatedAt === 'string' ? r.estimatedAt : '',
  };
}

/** "Works ~£14k–£26k". */
export function worksLabel(low: number, high: number): string {
  return low === high ? `Works ~${shortMoney(low)}` : `Works ~${shortMoney(low)}–${shortMoney(high)}`;
}

/** "£22k value added". */
export function valueAddedLabel(n: number): string {
  return `${n < 0 ? '−' : ''}${shortMoney(n)} value added`;
}

/** "£45k–£58k cash in": Batch 16's cash line, as the project's range. */
export function projectCashLine(card: Pick<ProjectCardData, 'cashLow' | 'cashHigh'>): string | null {
  if (!(card.cashHigh > 0)) return null;
  const low = shortMoney(Math.max(0, card.cashLow));
  const high = shortMoney(card.cashHigh);
  return low === high ? `${high} cash in` : `${low}–${high} cash in`;
}

/** "Money left in after refinance: £28k–£41k" (full projects), or null. */
export function moneyLeftInLine(card: Pick<ProjectCardData, 'moneyLeftInLow' | 'moneyLeftInHigh'>): string | null {
  if (card.moneyLeftInLow === null || card.moneyLeftInHigh === null) return null;
  const f = (n: number) => (n <= 0 ? '£0' : shortMoney(n));
  const low = f(card.moneyLeftInLow);
  const high = f(card.moneyLeftInHigh);
  return `${low === high ? high : `${low}–${high}`} left in after refinance`;
}

export interface ProjectNumbers {
  works: string;
  valueAdded: string;
  /** "£550–£750/mo after works"; null without an income figure. */
  profit: string | null;
  range: ProjectProfitRange | null;
  /** "based on 12 similar Airbnbs nearby" / "area estimate", under the profit. */
  caption: string;
  cash: string | null;
}

/** The card's three numbers at this member's finance (the house figures without them). */
export function projectNumbers(card: ProjectCardData, income: { grossRevenue: number | null; confidence: string | null; compCount?: number | string | null }, finance: Partial<FinanceDefaults> | null | undefined, widths: ProfitRangeInput['widths']): ProjectNumbers {
  const range =
    income.grossRevenue !== null && income.grossRevenue > 0
      ? profitAfterWorksRange({ level: card.level, price: card.price, value: card.value, bedrooms: card.bedrooms, grossRevenue: income.grossRevenue, finance: finance ?? null, refinancePct: card.refinancePct ?? undefined, confidence: income.confidence, widths })
      : null;
  return {
    works: worksLabel(card.worksLow, card.worksHigh),
    valueAdded: valueAddedLabel(card.valueAdded),
    profit: range ? `${range.label} after works` : null,
    range,
    caption: rangeCaption(income.compCount ?? null),
    cash: projectCashLine(card),
  };
}

/** The badge. */
export const PROJECT_BADGE = 'Project';

/** Where the working section starts: said plainly, every time. */
export const WORKS_DISCLAIMER = 'A guide from the photos, including VAT. Get your own quotes and a survey.';
export const VALUE_DISCLAIMER = 'Value after works (estimate). Works estimated from photos. Get a survey.';
