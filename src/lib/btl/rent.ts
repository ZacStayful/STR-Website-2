/**
 * A sale listing's long-let rent as a range (Batch 28, Part A; the rule
 * decided 16 Oct, Q4).
 *
 *   THE BASE        The district's average rent (PropertyData key stats,
 *                   monthly) read as a 2-bed and moved to the listing's
 *                   bedrooms by the rent ladder's ratio.
 *   COMPARABLES     Live rental listings in the same postcode area, with the
 *                   same bedrooms and the same type (flat or house), within
 *                   5 km. A plain radius crosses rivers and city lines: in
 *                   Birkenhead it pulled Liverpool flats at £1,475 into a
 *                   2-bed house whose own street lets at about £675.
 *   THE MIDDLE      With 5+ comparables, the average of the base and their
 *                   median; otherwise the base alone (or, with no district
 *                   figure, the comparables alone). Neither: no figure, never
 *                   the national ladder.
 *   THE WIDTH       ± the larger of 10% and half the comparables' spread,
 *                   capped at 25%. Low confidence is ±20%. When the base and
 *                   the comparables differ by more than 25%, the range
 *                   stretches to cover both.
 *   CONFIDENCE      High: 8+ comparables agreeing with the district within
 *                   15%, and a district yield. Medium: 5+ agreeing within
 *                   25%, and a district yield. Low otherwise.
 *
 * A paid rent valuation (the shortlist, or the £2 report) narrows the range;
 * it never replaces the comparables (narrowWithValuation).
 *
 * Pure: no network, no database, no server-only.
 */

import type { Confidence } from '../listing/screen.ts';
import { scaleRentToBedrooms, rungFor } from '../market/rent-ladder.ts';
import { haversineMiles } from '../market/geo.ts';
import { DEFAULT_BTL_RENT, type BtlRentSettings } from './config.ts';

export type ListingKind = 'flat' | 'house' | 'unknown';

/** One live rental listing, as the screen reads it. */
export interface RentComp {
  pcm: number;
  bedrooms: number;
  kind: ListingKind;
  postcodeArea: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RentSubject {
  bedrooms: number;
  kind: ListingKind;
  postcodeArea: string | null;
  lat: number | null;
  lng: number | null;
  /** The district's average monthly rent (key stats), all sizes. */
  districtRentPcm: number | null;
  /** The district's gross yield, %: missing means the district is thinly covered. */
  districtYieldPct: number | null;
}

export type RentSource = 'district' | 'comparables' | 'valuation';

export interface RentRange {
  low: number;
  mid: number;
  high: number;
  confidence: Confidence;
  /** Comparables used. */
  compCount: number;
  /** The district figure at this size, when there is one. */
  base: number | null;
  compsMedian: number | null;
  /** The district and the comparables differ by more than the setting. */
  disagree: boolean;
  /** A rent valuation folded in, monthly. */
  valuation: number | null;
  sources: RentSource[];
}

const KM_PER_MILE = 1.609344;
const MIN_RENT = 250;
const MAX_RENT = 15_000;

/** Linear interpolation between ranks, as Postgres percentile_cont. `sorted` ascending, non-empty. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = Math.min(Math.max(q, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The comparables the rule allows for this subject, nearest first. */
export function comparablesFor(subject: Omit<RentSubject, 'districtRentPcm' | 'districtYieldPct'>, comps: readonly RentComp[], s: BtlRentSettings = DEFAULT_BTL_RENT): RentComp[] {
  if (subject.lat === null || subject.lng === null || !subject.postcodeArea) return [];
  const here = { lat: subject.lat, lng: subject.lng };
  const rung = rungFor(subject.bedrooms);
  const area = subject.postcodeArea.toUpperCase();
  return comps
    .filter((c) => c.lat !== null && c.lng !== null && Number.isFinite(c.pcm) && c.pcm >= MIN_RENT && c.pcm <= MAX_RENT)
    .filter((c) => (c.postcodeArea ?? '').toUpperCase() === area && rungFor(c.bedrooms) === rung)
    // A subject of unknown type takes either; a known type takes its own.
    .filter((c) => subject.kind === 'unknown' || c.kind === subject.kind)
    .map((c) => ({ c, km: haversineMiles(here, { lat: c.lat as number, lng: c.lng as number }) * KM_PER_MILE }))
    .filter((x) => x.km <= s.compsRadiusKm)
    .sort((a, b) => a.km - b.km)
    .map((x) => x.c);
}

function finish(low: number, mid: number, high: number): { low: number; mid: number; high: number } {
  const m = Math.round(mid);
  return { low: Math.min(Math.round(low), m), mid: m, high: Math.max(Math.round(high), m) };
}

/** The rent range, or null when neither the district nor the comparables can speak for it. */
export function rentRangeFor(subject: RentSubject, comps: readonly RentComp[], s: BtlRentSettings = DEFAULT_BTL_RENT): RentRange | null {
  if (!Number.isFinite(subject.bedrooms) || subject.bedrooms < 0) return null;
  const base = subject.districtRentPcm && subject.districtRentPcm > 0 ? scaleRentToBedrooms(subject.districtRentPcm, s.ladderBaseBedrooms, subject.bedrooms) || null : null;
  const used = comparablesFor(subject, comps, s);
  const enough = used.length >= s.compsMin;
  const sorted = used.map((c) => c.pcm).sort((a, b) => a - b);
  const p25 = enough ? percentile(sorted, 0.25) : null;
  const p50 = enough ? percentile(sorted, 0.5) : null;
  const p75 = enough ? percentile(sorted, 0.75) : null;
  const hasYield = subject.districtYieldPct !== null && Number.isFinite(subject.districtYieldPct);
  const sources: RentSource[] = [];
  if (base !== null) sources.push('district');
  if (enough) sources.push('comparables');

  if (base !== null && p25 !== null && p50 !== null && p75 !== null) {
    const mid = (base + p50) / 2;
    const gap = Math.abs(p50 / base - 1) * 100;
    const disagree = gap > s.disagreePct;
    if (disagree) {
      const w = s.lowWidthPct / 100;
      const r = finish(Math.min(mid * (1 - w), base, p25), mid, Math.max(mid * (1 + w), base, p75));
      return { ...r, confidence: 'low', compCount: used.length, base, compsMedian: Math.round(p50), disagree: true, valuation: null, sources };
    }
    const spread = (p75 - p25) / (2 * p50);
    const w = Math.min(Math.max(spread * 100, s.minWidthPct), s.maxWidthPct) / 100;
    const confidence: Confidence = !hasYield ? 'low' : used.length >= s.compsHigh && gap <= s.agreeHighPct ? 'high' : 'medium';
    const width = confidence === 'low' ? Math.max(w, s.lowWidthPct / 100) : w;
    const r = finish(mid * (1 - width), mid, mid * (1 + width));
    return { ...r, confidence, compCount: used.length, base, compsMedian: Math.round(p50), disagree: false, valuation: null, sources };
  }
  if (base !== null) {
    const w = s.lowWidthPct / 100;
    const r = finish(base * (1 - w), base, base * (1 + w));
    return { ...r, confidence: 'low', compCount: used.length, base, compsMedian: null, disagree: false, valuation: null, sources };
  }
  if (p25 !== null && p50 !== null && p75 !== null) {
    const spread = ((p75 - p25) / (2 * p50)) * 100;
    const w = Math.min(Math.max(spread, s.lowWidthPct), s.maxWidthPct) / 100;
    const r = finish(p50 * (1 - w), p50, p50 * (1 + w));
    return { ...r, confidence: 'low', compCount: used.length, base: null, compsMedian: Math.round(p50), disagree: false, valuation: null, sources };
  }
  return null;
}

const UP: Record<Confidence, Confidence> = { low: 'medium', medium: 'high', high: 'high' };

/**
 * Fold a paid rent valuation in. The middle moves halfway to it. Inside the
 * range: the range narrows to the overlap with the valuation's own estimate
 * (never below the minimum width) and confidence goes up a level. Outside:
 * the range stretches to include it and confidence stays.
 */
export function narrowWithValuation(range: RentRange, valuation: { monthly: number; low?: number | null; high?: number | null }, s: BtlRentSettings = DEFAULT_BTL_RENT): RentRange {
  const v = valuation.monthly;
  if (!Number.isFinite(v) || v <= 0) return range;
  const mid = (range.mid + v) / 2;
  const minW = s.valuationMinWidthPct / 100;
  const sources: RentSource[] = range.sources.includes('valuation') ? range.sources : [...range.sources, 'valuation'];
  if (v >= range.low && v <= range.high) {
    const vLow = valuation.low && valuation.low > 0 ? valuation.low : v * (1 - minW);
    const vHigh = valuation.high && valuation.high > 0 ? valuation.high : v * (1 + minW);
    const low = Math.min(Math.max(range.low, vLow), mid * (1 - minW));
    const high = Math.max(Math.min(range.high, vHigh), mid * (1 + minW));
    return { ...range, ...finish(low, mid, high), confidence: UP[range.confidence], valuation: Math.round(v), sources };
  }
  return { ...range, ...finish(Math.min(range.low, v), mid, Math.max(range.high, v)), valuation: Math.round(v), sources };
}
