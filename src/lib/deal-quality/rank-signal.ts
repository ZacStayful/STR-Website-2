/**
 * The deal check as a ranking signal (Batch 16, Part C): a deal shown on
 * its own comparables, at high or medium confidence, is a surer thing than
 * one on the area's average, so the tailored order ("Best for you", Today)
 * lifts it a little — one adjustment among Batch 14's, inside the same
 * caps, with a reason a member can read. The untailored order is untouched.
 *
 * Pure: no network, no database, no server-only.
 */

export interface CheckSignalPoints {
  high: number;
  medium: number;
  low: number;
}

export interface CheckSignal {
  points: number;
  /** "checked on 12 similar Airbnbs nearby": the count only, never the radius or a place. */
  reason: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * The signal for a deal, or null when it has not been checked (no
 * comparables count) or the check is low confidence (no lift: the wide
 * range already says so).
 */
export function checkSignal(confidence: string | null | undefined, compCount: number | string | null | undefined, points: CheckSignalPoints): CheckSignal | null {
  const n = num(compCount);
  if (n === null || n <= 0) return null;
  const p = confidence === 'high' ? points.high : confidence === 'medium' ? points.medium : confidence === 'low' ? points.low : 0;
  if (!(p > 0)) return null;
  return { points: p, reason: `checked on ${n} similar Airbnb${n === 1 ? '' : 's'} nearby` };
}
