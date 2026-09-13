/**
 * Competition for a market, from the reviews of its comparable listings.
 *
 * Absolute bands, not a rank against other areas, so a label only changes
 * when the market's own data changes. Two signals: the average review
 * count of the comparables each report analysed (how established the
 * hosts are) and their average rating (how well guests are served).
 *
 *                     reviews ≥ 100        reviews < 100
 *   rating ≥ 4.8      Competitive          Opportunity
 *   4.6 ≤ rating < 4.8 Busy but beatable   Emerging
 *   rating < 4.6      Busy but beatable    Weak
 *
 * 100+ reviews is an established market. Under 100 with hosts rated 4.8+
 * is the sweet spot: guests come and like it, and nobody owns it yet.
 * Under 4.6 with few reviews is a market short-lets have not proved in.
 * A missing rating counts as below the floor; missing reviews as none.
 *
 * `intensity` (0–100, higher = more competitive) keeps a number for the
 * map ramp, the "least competitive" sort and the personal fit; reviews
 * carry 70 points (full at 200) and rating 30 (4.4 → 5.0).
 * Null until MIN_RATED_REPORTS reports carry review data.
 */

export type CompetitionLabel = 'Weak' | 'Emerging' | 'Opportunity' | 'Busy but beatable' | 'Competitive';
export type CompetitionTone = 'no' | 'tight' | 'works' | 'info';

export const MIN_RATED_REPORTS = 3;
export const REVIEW_THRESHOLD = 100;
export const RATING_GOOD = 4.8;
export const RATING_FLOOR = 4.6;

export interface CompetitionInput {
  rating: number | null;
  reviews: number | null;
  sampleCount: number;
}

export interface CompetitionBand {
  label: CompetitionLabel;
  tone: CompetitionTone;
  intensity: number; // 0–100, higher = more competitive
  rating: number | null;
  reviews: number | null;
  sampleCount: number;
  explanation: string;
}

export const COMPETITION_LABELS: CompetitionLabel[] = ['Weak', 'Emerging', 'Opportunity', 'Busy but beatable', 'Competitive'];

export function competitionLabelFor(rating: number | null, reviews: number | null): CompetitionLabel {
  const r = rating ?? 0;
  const n = reviews ?? 0;
  if (n >= REVIEW_THRESHOLD) return r >= RATING_GOOD ? 'Competitive' : 'Busy but beatable';
  if (r >= RATING_GOOD) return 'Opportunity';
  if (r >= RATING_FLOOR) return 'Emerging';
  return 'Weak';
}

export function competitionTone(label: CompetitionLabel): CompetitionTone {
  switch (label) {
    case 'Competitive': return 'info';
    case 'Opportunity': return 'works';
    case 'Weak': return 'no';
    default: return 'tight';
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function competitionIntensity(rating: number | null, reviews: number | null): number {
  const fromReviews = 70 * clamp01((reviews ?? 0) / 200);
  const fromRating = 30 * clamp01(((rating ?? 4.4) - 4.4) / 0.6);
  return Math.round(fromReviews + fromRating);
}

/** Short guidance for each band, used under the gauge and in the PDF. */
export function competitionMeaning(label: CompetitionLabel): string {
  switch (label) {
    case 'Competitive': return 'established, well-rated hosts: a new listing needs to match a high bar';
    case 'Opportunity': return 'guests rate hosts highly and few are established: room to enter';
    case 'Busy but beatable': return 'plenty of established hosts, but guests are not consistently delighted';
    case 'Emerging': return 'a young market with decent ratings; demand still proving itself';
    default: return 'few reviews and lower ratings: short-lets have not proved themselves here yet';
  }
}

export function competitionBand(input: CompetitionInput): CompetitionBand | null {
  if (input.sampleCount < MIN_RATED_REPORTS) return null;
  if (input.rating === null && input.reviews === null) return null;
  const label = competitionLabelFor(input.rating, input.reviews);
  const rating = input.rating === null ? null : Math.round(input.rating * 100) / 100;
  const reviews = input.reviews === null ? null : Math.round(input.reviews);
  const figures = [rating === null ? null : `${rating.toFixed(2)}★`, reviews === null ? null : `${reviews} reviews`].filter(Boolean).join(' from ');
  return {
    label,
    tone: competitionTone(label),
    intensity: competitionIntensity(input.rating, input.reviews),
    rating,
    reviews,
    sampleCount: input.sampleCount,
    explanation: `Hosts average ${figures || 'no review data'}: ${competitionMeaning(label)}.`,
  };
}
