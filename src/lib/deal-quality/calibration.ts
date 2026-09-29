/**
 * Step 0 of the deal checks: before any deal is checked, re-run past full
 * analyses through the deal check's own search and see how far the new
 * figure lands from the stored one. If the typical gap is over the gate,
 * the checks are not built on it.
 *
 * Twenty-four stored analyser reports — eight urban, eight rural, eight
 * coastal, one to five bedrooms, one per postcode area within each class —
 * are searched again at their own location with the same bedrooms and
 * guests. Each result is computed four ways from the same comparables, so
 * the choices the plan left to this comparison are settled by it at no
 * extra cost.
 *
 * Pure: no network, no database, no server-only.
 */

export const CALIBRATION_KIND = 'deal_calibration';
export const CALIBRATION_CLASSES = ['urban', 'rural_village', 'coastal'] as const;
export type CalibrationClass = (typeof CALIBRATION_CLASSES)[number];
export const CASES_PER_CLASS = 8;
/** 24 cases × 3 calls: £3.60 at 5p a call, the most the comparison can spend. */
export const CALIBRATION_MAX_CALLS = CALIBRATION_CLASSES.length * CASES_PER_CLASS * 3;
/** Results older than this start a new comparison. */
export const CALIBRATION_WINDOW_DAYS = 14;
/**
 * The gate: stop if the typical gap is over this. The brief set 10%. Two
 * runs on 29 Sep 2026 read 11.7% and then 11.5% (urban 7.6%, rural 11.9%,
 * coastal 14.8%; signed median −2%, so no lean), against 16.7% for the area
 * average every live deal used until then, measured the same way on the same
 * fresh reports; the stored reports are themselves estimates on twelve
 * comparables with spreads of 20–160%, so two honest readings of one
 * property differ by about this much. Zac chose to accept the check at that
 * accuracy and let the ranges on the cards carry the error, so the gate is
 * 15% (the PR #104 description holds both runs' figures).
 */
export const CALIBRATION_GATE_PCT = 15;
/** Enough cases for the gate to be read. */
export const CALIBRATION_MIN_CASES = 20;
/** The bedroom mix each class is filled in. */
const BEDROOM_ORDER = [1, 2, 3, 4, 5, 2, 3, 4];

export type VariantKey = 'planned' | 'nearest12' | 'nearest20' | 'withDates' | 'bothCurves' | 'setting';
export const VARIANTS: VariantKey[] = ['planned', 'nearest12', 'nearest20', 'withDates', 'bothCurves', 'setting'];
export const VARIANT_LABELS: Record<VariantKey, string> = {
  planned: 'As planned (up to 40 nearest similar homes, listing dates dropped, seasonal fix)',
  nearest12: 'The 12 nearest similar homes only',
  nearest20: 'The 20 nearest similar homes only',
  withDates: 'Keep listing dates (young listings annualised)',
  bothCurves: 'No seasonal fix (UK curve on ADR and occupancy)',
  setting: 'As planned, plus the setting check',
};

/** A "start again" marker in the run history: the comparison begins afresh after it, on the cases it names. */
export interface RunLike {
  summary: { reset?: unknown; caseIds?: unknown; results?: readonly CaseResult[]; calls?: unknown; pence?: unknown } | null | undefined;
}

function caseIdsOf(run: RunLike | null | undefined): string[] {
  const ids = run?.summary?.caseIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/**
 * The runs of the comparison under way (after the last "start again"
 * marker), the runs of the one before it, and the case list: the marker's
 * own (the same cases again), else the first run's that named one.
 */
export function splitAtReset<T extends RunLike>(runs: readonly T[]): { current: T[]; previous: T[]; caseIds: string[] } {
  let at = -1;
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    if (runs[i].summary?.reset === true) {
      at = i;
      break;
    }
  }
  if (at < 0) return { current: [...runs], previous: [], caseIds: runs.map(caseIdsOf).find((l) => l.length > 0) ?? [] };
  const current = runs.slice(at + 1);
  const fromMarker = caseIdsOf(runs[at]);
  return { current, previous: splitAtReset(runs.slice(0, at)).current, caseIds: fromMarker.length > 0 ? fromMarker : (current.map(caseIdsOf).find((l) => l.length > 0) ?? []) };
}

export interface CandidateRow {
  id: string;
  created_at: string;
  postcode_area: string | null;
  bedrooms: number | null;
  location_class: string | null;
}

/** The comparison's cases: per class, the newest report of each size in turn, one per postcode area. */
export function chooseCases<T extends CandidateRow>(rows: readonly T[], perClass = CASES_PER_CLASS): T[] {
  const newest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const out: T[] = [];
  for (const cls of CALIBRATION_CLASSES) {
    const pool = newest.filter((r) => r.location_class === cls && r.postcode_area && r.bedrooms !== null && r.bedrooms >= 1 && r.bedrooms <= 5);
    const areas = new Set<string>();
    const chosen: T[] = [];
    const take = (r: T | undefined) => {
      if (!r) return false;
      chosen.push(r);
      areas.add(r.postcode_area!);
      return true;
    };
    for (const beds of BEDROOM_ORDER) {
      if (chosen.length >= perClass) break;
      const free = (r: T) => !areas.has(r.postcode_area!) && !chosen.includes(r);
      if (!take(pool.find((r) => r.bedrooms === beds && free(r)))) take(pool.find(free));
    }
    out.push(...chosen);
  }
  return out;
}

export interface VariantResult {
  gross: number | null;
  compCount: number;
  spreadPct: number | null;
  confidence: string;
  /** (new − stored) ÷ stored, %; null when there is no new figure. */
  gapPct: number | null;
}

export interface CaseResult {
  id: string;
  area: string;
  locationClass: string;
  bedrooms: number;
  guests: number;
  storedGross: number;
  storedCompCount: number | null;
  storedRadiusKm: number | null;
  storedSpreadPct: number | null;
  /** Similar comparables the search found (before the pipeline's own filters). */
  found: number;
  radiusKm: number;
  calls: number;
  pence: number;
  filtered: boolean;
  filterMatch: number | null;
  kindRelaxed: boolean;
  settingDropped: number;
  variants: Partial<Record<VariantKey, VariantResult>>;
  error?: string;
}

export function gapPct(next: number | null, stored: number): number | null {
  if (next === null || !(stored > 0)) return null;
  return Math.round(((next - stored) / stored) * 1000) / 10;
}

export function median(values: readonly number[]): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export interface CalibrationSummary {
  cases: number;
  done: number;
  failed: number;
  calls: number;
  pence: number;
  /** Median of |gap| per variant, over the cases that have a figure. */
  medianAbsGap: Record<VariantKey, number | null>;
  /** Median signed gap for the planned variant: above 0, the check reads higher than the past reports. */
  medianGapPlanned: number | null;
  byClass: Record<string, { n: number; medianAbsGap: number | null }>;
  /** Cases under the minimum comparables: those deals would not be shown. */
  insufficient: number;
  confidence: Record<string, number>;
  /** The variant closest to the stored figures (the one the checks then use). */
  best: VariantKey | null;
  gate: 'pass' | 'fail' | 'pending';
}

/** Every result for the batch, newest wins per case. */
export function latestResults(runs: readonly { results?: readonly CaseResult[] }[]): Map<string, CaseResult> {
  const out = new Map<string, CaseResult>();
  for (const run of runs) for (const r of run.results ?? []) out.set(r.id, r);
  return out;
}

export function summariseCalibration(results: readonly CaseResult[], cases: number, calls: number, pence: number): CalibrationSummary {
  const ok = results.filter((r) => !r.error);
  const medianAbsGap = {} as Record<VariantKey, number | null>;
  for (const v of VARIANTS) {
    const gaps = ok.map((r) => r.variants[v]?.gapPct).filter((g): g is number => typeof g === 'number');
    medianAbsGap[v] = round1(median(gaps.map(Math.abs)));
  }
  const byClass: CalibrationSummary['byClass'] = {};
  for (const cls of CALIBRATION_CLASSES) {
    const gaps = ok.filter((r) => r.locationClass === cls).map((r) => r.variants.planned?.gapPct).filter((g): g is number => typeof g === 'number');
    byClass[cls] = { n: gaps.length, medianAbsGap: round1(median(gaps.map(Math.abs))) };
  }
  const confidence: Record<string, number> = {};
  for (const r of ok) {
    const c = r.variants.planned?.confidence ?? 'insufficient';
    confidence[c] = (confidence[c] ?? 0) + 1;
  }
  const candidates = (['planned', 'nearest12', 'nearest20', 'withDates', 'setting', 'bothCurves'] as VariantKey[]).filter((v) => medianAbsGap[v] !== null);
  const best = candidates.length === 0 ? null : candidates.reduce((a, b) => ((medianAbsGap[b] as number) < (medianAbsGap[a] as number) ? b : a));
  const withFigure = ok.filter((r) => r.variants.planned?.gross !== null && r.variants.planned?.gross !== undefined).length;
  const gate: CalibrationSummary['gate'] = withFigure < Math.min(CALIBRATION_MIN_CASES, cases) || best === null ? 'pending' : (medianAbsGap[best] as number) <= CALIBRATION_GATE_PCT ? 'pass' : 'fail';
  return {
    cases,
    done: ok.length,
    failed: results.length - ok.length,
    calls,
    pence,
    medianAbsGap,
    medianGapPlanned: round1(median(ok.map((r) => r.variants.planned?.gapPct).filter((g): g is number => typeof g === 'number'))),
    byClass,
    insufficient: ok.filter((r) => (r.variants.planned?.confidence ?? 'insufficient') === 'insufficient').length,
    confidence,
    best,
    gate,
  };
}

/**
 * The analyser's headline multiplier is outdoor space × parking only; the
 * stored breakdown gives both back, so the re-run prices the same extras.
 */
export function optionsFromMultipliers(m: { outdoorSpace?: unknown; parking?: unknown } | null | undefined): { outdoorSpace?: string; parkingSpaces?: number } {
  const out: { outdoorSpace?: string; parkingSpaces?: number } = {};
  const outdoor = Number(m?.outdoorSpace);
  if (Math.abs(outdoor - 1.03) < 0.005) out.outdoorSpace = 'garden';
  else if (Math.abs(outdoor - 1.06) < 0.005) out.outdoorSpace = 'large_garden';
  else if (Math.abs(outdoor - 1.12) < 0.005) out.outdoorSpace = 'hot_tub';
  const parking = Number(m?.parking);
  if (Math.abs(parking - 1.03) < 0.005) out.parkingSpaces = 1;
  else if (Math.abs(parking - 1.05) < 0.005) out.parkingSpaces = 2;
  return out;
}
