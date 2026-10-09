/**
 * Batch 26: how the chat writes money. Pure.
 */

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
