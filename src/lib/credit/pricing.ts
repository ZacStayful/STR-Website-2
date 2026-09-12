/**
 * Pure pricing maths. Two units run through the whole system:
 *   base pence  = raw cost × markup (the "×5" price every action is quoted in)
 *   grant pence = what a member paid; each grant spends at its own rate
 *                 (plan / welcome 1.0, top-up / adjustment 1.5)
 */

import { unitKey, type UnitCostTable, DEFAULT_MARKUP } from './costs.ts';

export interface Price {
  rawPence: number;
  basePence: number;
  unitCostPence: number;
  markup: number;
  /** False when the (provider, unit) has no row — priced at 0 and logged. */
  found: boolean;
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function priceFor(table: UnitCostTable, provider: string, unit: string, quantity = 1): Price {
  const row = table.get(unitKey(provider, unit));
  if (!row) return { rawPence: 0, basePence: 0, unitCostPence: 0, markup: DEFAULT_MARKUP, found: false };
  const raw = round4(row.unitCostPence * quantity);
  return { rawPence: raw, basePence: round4(raw * row.markup), unitCostPence: row.unitCostPence, markup: row.markup, found: true };
}

export interface SpendRates {
  plan: number;
  welcome: number;
  topup: number;
  adjustment: number;
}

export const DEFAULT_SPEND_RATES: SpendRates = { plan: 1, welcome: 1, topup: 1.5, adjustment: 1.5 };

export interface Buckets {
  planPence: number;
  welcomePence: number;
  topupPence: number;
  adjustmentPence: number;
}

/** Grant pence a debit of `basePence` removes from a bucket at `rate`. */
export function toGrantPence(basePence: number, rate: number): number {
  return round4(basePence * rate);
}

/** How much base-pence spending the buckets cover (ignoring reservations). */
export function spendableBase(b: Buckets, rates: SpendRates = DEFAULT_SPEND_RATES): number {
  return round4(b.planPence / rates.plan + b.welcomePence / rates.welcome + b.topupPence / rates.topup + b.adjustmentPence / rates.adjustment);
}

/**
 * Which bucket the next `basePence` would come from, for wording the estimate:
 * 'plan' | 'welcome' | 'topup' | 'mixed' | 'none'.
 */
export function paidFrom(b: Buckets, basePence: number, rates: SpendRates = DEFAULT_SPEND_RATES): 'plan' | 'welcome' | 'topup' | 'mixed' | 'none' {
  const order: { name: 'plan' | 'welcome' | 'topup'; base: number }[] = [
    { name: 'plan', base: b.planPence / rates.plan },
    { name: 'welcome', base: b.welcomePence / rates.welcome },
    { name: 'topup', base: (b.topupPence + b.adjustmentPence) / rates.topup },
  ];
  let remaining = basePence;
  const used: string[] = [];
  for (const o of order) {
    if (remaining <= 0) break;
    if (o.base <= 0) continue;
    used.push(o.name);
    remaining -= o.base;
  }
  if (used.length === 0) return 'none';
  if (used.length === 1) return used[0] as 'plan' | 'welcome' | 'topup';
  return 'mixed';
}

export type BalanceState = 'ok' | 'low' | 'out';

/**
 * Banner / modal state. `low` once the cycle's allowance is ≥ ratio used and
 * there is no other credit to fall back on beyond a small margin; `out` when
 * nothing spendable is left.
 */
export function lowBalanceState(input: { cycleAllowancePence: number; cycleUsedPence: number; spendableBasePence: number; ratio?: number }): BalanceState {
  const ratio = input.ratio ?? 0.8;
  if (input.spendableBasePence <= 0.5) return 'out';
  if (input.cycleAllowancePence > 0 && input.cycleUsedPence / input.cycleAllowancePence >= ratio) return 'low';
  return 'ok';
}

export function formatGbp(pence: number, opts: { compact?: boolean } = {}): string {
  const pounds = pence / 100;
  if (opts.compact && Math.abs(pounds) >= 100) return `£${Math.round(pounds).toLocaleString('en-GB')}`;
  return `${pounds < 0 ? '-' : ''}£${Math.abs(pounds).toFixed(2)}`;
}
