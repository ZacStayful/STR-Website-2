/**
 * Competition intensity, RELATIVE to every other UK area in the explorer.
 *
 * Rather than guessing fixed thresholds, each area is percentile-ranked
 * against the others on the signals that describe how crowded and entrenched
 * a market is, then the percentiles are blended:
 *
 *   listing density   50   listings per km² around analysed properties
 *   review depth      30   average reviews per comparable (entrenched hosts)
 *   listing age       20   average years listed
 *
 * A signal an area lacks is dropped and the remaining weights renormalised.
 * Higher percentile = more competitive. Labels by quartile of the blend:
 * Open (<25) · Moderate (<50) · Busy (<75) · Saturated. Self-calibrates as
 * data grows; null until at least MIN_AREAS areas carry a signal, because a
 * percentile among two areas means nothing.
 */

export type CompetitionLabel = 'Open' | 'Moderate' | 'Busy' | 'Saturated';

export interface CompetitionComponent {
  key: 'density' | 'reviews' | 'age';
  label: string;
  weight: number;
  /** Raw area value, or null when unknown. */
  value: number | null;
  /** 0–100 rank among areas with this signal, or null when unknown. */
  percentile: number | null;
  detail: string;
}

export interface CompetitionRank {
  percentile: number; // 0–100 blended, higher = more competitive
  label: CompetitionLabel;
  components: CompetitionComponent[];
  sampleCount: number;
  /** How many areas this ranking was computed against. */
  areasRanked: number;
}

export interface CompetitionInput {
  code: string;
  density: number | null;
  reviews: number | null;
  age: number | null;
  sampleCount: number;
}

export const MIN_AREAS = 5;

const WEIGHTS = { density: 50, reviews: 30, age: 20 } as const;

export function competitionLabel(percentile: number): CompetitionLabel {
  if (percentile < 25) return 'Open';
  if (percentile < 50) return 'Moderate';
  if (percentile < 75) return 'Busy';
  return 'Saturated';
}

/** Percentile rank (0–100) of each value among the non-null values. Ties share a rank. */
function percentiles(values: (number | null)[]): (number | null)[] {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return values.map(() => null);
  const sorted = [...known].sort((a, b) => a - b);
  return values.map((v) => {
    if (v === null) return null;
    const below = sorted.filter((x) => x < v).length;
    const equal = sorted.filter((x) => x === v).length;
    // mid-rank for ties, scaled so the min is 0 and the max is 100
    const rank = below + (equal - 1) / 2;
    return Math.round((rank / (sorted.length - 1)) * 100);
  });
}

function fmt(v: number | null, unit: string, dp = 0): string {
  return v === null ? 'No data' : `${v.toFixed(dp)} ${unit}`;
}

export function rankCompetition(inputs: CompetitionInput[]): Map<string, CompetitionRank | null> {
  const out = new Map<string, CompetitionRank | null>();
  const withSignal = inputs.filter((i) => i.density !== null || i.reviews !== null || i.age !== null);
  if (withSignal.length < MIN_AREAS) {
    for (const i of inputs) out.set(i.code, null);
    return out;
  }

  const pDensity = percentiles(inputs.map((i) => i.density));
  const pReviews = percentiles(inputs.map((i) => i.reviews));
  const pAge = percentiles(inputs.map((i) => i.age));

  inputs.forEach((i, idx) => {
    const components: CompetitionComponent[] = [
      { key: 'density', label: 'Listing density', weight: WEIGHTS.density, value: i.density, percentile: pDensity[idx], detail: fmt(i.density, 'listings / km²', 1) },
      { key: 'reviews', label: 'Review depth', weight: WEIGHTS.reviews, value: i.reviews, percentile: pReviews[idx], detail: fmt(i.reviews, 'avg reviews per listing') },
      { key: 'age', label: 'Listing age', weight: WEIGHTS.age, value: i.age, percentile: pAge[idx], detail: fmt(i.age, 'yrs listed on average', 1) },
    ];
    const present = components.filter((c) => c.percentile !== null);
    if (present.length === 0) {
      out.set(i.code, null);
      return;
    }
    const wTotal = present.reduce((s, c) => s + c.weight, 0);
    const blended = Math.round(present.reduce((s, c) => s + (c.percentile ?? 0) * c.weight, 0) / wTotal);
    out.set(i.code, {
      percentile: blended,
      label: competitionLabel(blended),
      components,
      sampleCount: i.sampleCount,
      areasRanked: withSignal.length,
    });
  });
  return out;
}
