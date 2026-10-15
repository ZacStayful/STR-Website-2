/**
 * Batch 26: how the chat writes money. Pure.
 */
import { paidFrom, type Buckets, type SpendRates } from '../credit/pricing.ts';

/**
 * Review R3 (R3-30): a hint as it will come off this member's balance. The
 * settings are base pence; top-up (and adjustment) credit is spent at its
 * rate, so "about 8p" is about 10.4p to a member whose next pence are
 * top-up credit. Without the member's credit, the base figure.
 */
export function faceHintPence(basePence: number, credit: { buckets: Buckets; rates: SpendRates } | null | undefined): number {
  if (!credit || !Number.isFinite(basePence) || basePence <= 0) return basePence;
  const from = paidFrom(credit.buckets, basePence, credit.rates);
  const rate = from === 'plan' ? credit.rates.plan : from === 'welcome' ? credit.rates.welcome : from === 'none' ? 1 : credit.rates.topup;
  return Math.round(basePence * rate * 10) / 10;
}

/** A question's charge: "0.8p", "7.6p", "£1.20" (a tenth of a penny matters here). */
export function chargeLabel(pence: number): string {
  const p = Number.isFinite(pence) ? Math.max(0, pence) : 0;
  if (p >= 100) return `£${(p / 100).toFixed(2)}`;
  const tenths = Math.round(p * 10) / 10;
  return `${tenths % 1 === 0 ? tenths.toFixed(0) : tenths.toFixed(1)}p`;
}

/** A price hint: "about 1p", "about 8p". */
export function hintLabel(pence: number): string {
  return `about ${chargeLabel(pence)}`;
}

/** A balance as the header chip writes it: "£12.40". */
export function balanceLabel(pence: number): string {
  const p = Number.isFinite(pence) ? pence : 0;
  return `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;
}
