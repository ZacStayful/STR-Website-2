/**
 * The free order candidates are checked in (Part B): only the day's
 * allowance of photo checks is spent, so the likeliest Project deals go
 * first. Strongest first on each key in turn:
 *
 *   1. the best-case value added (estimate.ts bestCase): the most a listing
 *      could honestly add before anything is spent;
 *   2. how strongly its own words say it needs work (needs-work.ts score);
 *   3. how motivated its seller looks (the existing motivation score);
 *   4. its price a bedroom against the area's median: cheaper first.
 *
 * Pure: no network, no database, no server-only.
 */

export interface CandidateKey {
  bestCaseValueAdded: number;
  wordingScore: number;
  motivationScore: number | null;
  /** Price a bedroom ÷ the area's median price a bedroom; null when either is unknown. */
  priceToAreaMedian: number | null;
}

export function compareCandidates(a: CandidateKey, b: CandidateKey): number {
  if (a.bestCaseValueAdded !== b.bestCaseValueAdded) return b.bestCaseValueAdded - a.bestCaseValueAdded;
  if (a.wordingScore !== b.wordingScore) return b.wordingScore - a.wordingScore;
  const ma = a.motivationScore ?? -1;
  const mb = b.motivationScore ?? -1;
  if (ma !== mb) return mb - ma;
  const pa = a.priceToAreaMedian ?? Number.POSITIVE_INFINITY;
  const pb = b.priceToAreaMedian ?? Number.POSITIVE_INFINITY;
  return pa - pb;
}

export function rankCandidates<T extends { key: CandidateKey }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compareCandidates(a.key, b.key));
}

/** A listing's price a bedroom against its area's median price a bedroom. */
export function priceToAreaMedian(price: number | null, bedrooms: number | null, areaMedianPerBedroom: number | null): number | null {
  if (price === null || !(price > 0) || areaMedianPerBedroom === null || !(areaMedianPerBedroom > 0)) return null;
  const beds = bedrooms !== null && bedrooms > 0 ? bedrooms : 1;
  return Math.round((price / beds / areaMedianPerBedroom) * 1000) / 1000;
}
