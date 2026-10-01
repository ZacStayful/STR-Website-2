/**
 * Batch 22, Part G: the deep search's price.
 *
 *   quote   "about £X, up to £Y": the planned steps' raw cost, and the cap,
 *           each × deep_search_markup, less the first-time discount
 *   charge  at the end, once: actual raw cost × markup, less the discount,
 *           never more than the "up to" (which was reserved first)
 *
 * Pure: no network, no database, no server-only.
 */

export interface DeepQuote {
  aboutBasePence: number;
  upToBasePence: number;
  discountPct: number;
  /** The raw cap the search runs under. */
  capRawPence: number;
}

const pence = (n: number) => Math.round(Math.max(0, n));

export function deepQuote(p: { estimateRawPence: number; maxRawPence: number; markup: number; discountPct: number }): DeepQuote {
  const off = 1 - Math.min(100, Math.max(0, p.discountPct)) / 100;
  const cap = Math.max(0, p.maxRawPence);
  const est = Math.min(Math.max(0, p.estimateRawPence), cap);
  const upTo = pence(cap * p.markup * off);
  return { aboutBasePence: Math.min(pence(est * p.markup * off), upTo), upToBasePence: upTo, discountPct: Math.min(100, Math.max(0, p.discountPct)), capRawPence: cap };
}

/** What the finished search charges, in base pence: never above the "up to". */
export function deepCharge(actualRawPence: number, q: Pick<DeepQuote, 'upToBasePence' | 'discountPct'>, markup: number): number {
  const off = 1 - q.discountPct / 100;
  return Math.min(pence(Math.max(0, actualRawPence) * markup * off), q.upToBasePence);
}

/** The raw cost of the planned first steps: each a page from its source. */
export function estimateRaw(steps: readonly { source: 'onthemarket' | 'pmi' }[], unit: { onthemarket: number; pmi: number }, incomeChecks: number, checkPence: number): number {
  const pages = steps.reduce((s, x) => s + (x.source === 'pmi' ? unit.pmi : unit.onthemarket), 0);
  return Math.round((pages + Math.max(0, incomeChecks) * checkPence) * 10_000) / 10_000;
}
