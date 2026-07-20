/**
 * Data-confidence tiers for a Market Explorer area, based on how many analyser
 * samples back it. We now show ALL areas (min_samples=1), so this tier makes it
 * honest: users can see which areas have enough data to trust vs which are still
 * early and need more reports to confirm.
 *
 * Thresholds (tunable): Confirmed ≥ 10 samples, Building ≥ 5, Early < 5.
 */

export type ConfidenceTier = 'confirmed' | 'building' | 'early';

export interface Confidence {
  tier: ConfidenceTier;
  /** Rank for sorting (higher = more confident). */
  rank: number;
  label: string;
  /** Short, honest one-liner about how solid the data is. */
  blurb: string;
}

export const CONFIRMED_MIN_SAMPLES = 10;
export const BUILDING_MIN_SAMPLES = 5;

export function areaConfidence(totalSamples: number): Confidence {
  if (totalSamples >= CONFIRMED_MIN_SAMPLES) {
    return {
      tier: 'confirmed',
      rank: 3,
      label: 'Confirmed',
      blurb: 'Backed by a solid sample of analyser reports.',
    };
  }
  if (totalSamples >= BUILDING_MIN_SAMPLES) {
    return {
      tier: 'building',
      rank: 2,
      label: 'Building',
      blurb: 'A reasonable sample — figures are firming up as more reports come in.',
    };
  }
  return {
    tier: 'early',
    rank: 1,
    label: 'Early data',
    blurb: 'Indicative only — based on very few reports. Needs more data to confirm.',
  };
}
