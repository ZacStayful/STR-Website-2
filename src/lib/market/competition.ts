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

// ─── Saturation: the review count on its own ──────────────────────────
//
// `competitionBand` above pairs reviews with rating, which is the right
// read for the Market Explorer. Lead qualification needs the simpler
// question a customer actually asks — how crowded is this market? — and
// needs it as a number they can set a rule against.
//
// Reviews are the proxy for saturation because they accumulate: a market
// where the average comparable has 200 reviews has hosts who have been
// booking for years and have the ratings, the photos and the pricing
// history to prove it. A new listing there starts from nothing against
// people who already own the search results. Where the average is 40,
// nobody has that head start yet.
//
//   100+     competitive   established hosts; a new listing has to be good
//   60-99    workable      busy, but not owned — room for a well-run listing
//   under 60 uncontested   few established hosts; the market is open
//
// REVIEW_THRESHOLD (100) is shared with the band above so the two can
// never drift apart.

export const REVIEW_UNCOMPETITIVE = 60;

export type SaturationLevel = 'uncontested' | 'workable' | 'competitive';

export interface SaturationBand {
  level: SaturationLevel;
  /** Average review count of the comparables, rounded. */
  reviews: number;
  /** Two or three words for a chip or table cell. */
  headline: string;
  /** One sentence a customer can act on. */
  meaning: string;
}

export const SATURATION_LEVELS: SaturationLevel[] = ['uncontested', 'workable', 'competitive'];

export function saturationLevelFor(reviews: number): SaturationLevel {
  if (reviews >= REVIEW_THRESHOLD) return 'competitive';
  if (reviews >= REVIEW_UNCOMPETITIVE) return 'workable';
  return 'uncontested';
}

export const SATURATION_HEADLINES: Record<SaturationLevel, string> = {
  uncontested: 'Uncontested',
  workable: 'Workable',
  competitive: 'Competitive',
};

export function saturationMeaning(level: SaturationLevel): string {
  switch (level) {
    case 'competitive':
      return 'hosts here are established, so a new listing has to match a high bar on photos, pricing and reviews before it books well';
    case 'workable':
      return 'a busy market that nobody owns yet: a well-run listing can take share without a price war';
    default:
      return 'few established hosts, so a new listing can build a review history before the market fills up';
  }
}

/** Null when there is no review data to band. */
export function saturationBand(reviews: number | null): SaturationBand | null {
  if (reviews === null || !Number.isFinite(reviews) || reviews < 0) return null;
  const rounded = Math.round(reviews);
  const level = saturationLevelFor(rounded);
  return {
    level,
    reviews: rounded,
    headline: SATURATION_HEADLINES[level],
    meaning: saturationMeaning(level),
  };
}

/** The explainer shown beside the review-count rule. Ordered least to most crowded. */
export const SATURATION_GUIDE: Array<{ level: SaturationLevel; range: string; headline: string; meaning: string }> =
  SATURATION_LEVELS.map((level) => ({
    level,
    range:
      level === 'uncontested' ? `Under ${REVIEW_UNCOMPETITIVE}`
      : level === 'workable' ? `${REVIEW_UNCOMPETITIVE}–${REVIEW_THRESHOLD - 1}`
      : `${REVIEW_THRESHOLD}+`,
    headline: SATURATION_HEADLINES[level],
    meaning: saturationMeaning(level),
  }));
