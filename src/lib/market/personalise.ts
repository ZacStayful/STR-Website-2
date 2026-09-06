/**
 * "Your fit": a personalised 0–100 score for an area against a user's goal
 * profile. Sits BESIDE the signed-off Stayful score (score.ts), never
 * replaces it — the Stayful score stays comparable across users, this one
 * reflects what this user said matters. Same transparency rules: every point
 * comes from a named component with the raw value behind it.
 *
 * Base weights, then goal multipliers, then renormalised to 100 over the
 * components that have data:
 *
 *   yield 30 · revenue 15 · occupancy 15 · competition 10 · directBooking 10 ·
 *   regulatory 10 · distance 10
 *
 *   priorities  0 → ×0.25, 1 → ×0.75, 2 → ×1, 3 → ×1.5 on their component
 *   managed     revenue ×1.3 (fees scale with revenue; scale matters more)
 *   self        distance ×1.5 (you will be driving there)
 *   cautious    regulatory ×2, and a licensed area earns 0.27 not 0.6
 *   tolerant    regulatory ×0.5
 *
 * Distance: full marks within half the max distance, linear to zero at the
 * max, zero (and fit.inRange=false) beyond. Dropped when the user has no home
 * or chose "anywhere". Budget/bedroom mismatches never zero the score — they
 * set `fit` flags the UI shows as pills, so the user still sees the area.
 */

import type { LicensingStatus } from '../data/str-licensing.ts';
import { gradeFor, type Grade } from './score.ts';
import type { MarketGoals, Priority } from './goals.ts';
import { haversineMiles } from './geo.ts';
import { areaCentroid } from './area-centroids.ts';
import { inBudget } from './filters.ts';
import type { AreaCardData } from './explorer.ts';

export interface PersonalComponent {
  key: 'yield' | 'revenue' | 'occupancy' | 'competition' | 'directBooking' | 'regulatory' | 'distance';
  label: string;
  weight: number; // effective weight after goal multipliers, before renormalisation
  earned: number | null; // 0..weight
  detail: string;
}

export interface PersonalFit {
  inBudget: boolean | null; // null = no budget set or no value data
  hasBedrooms: boolean | null;
  inRange: boolean | null; // null = no home / anywhere
  distanceMiles: number | null;
}

export interface PersonalScore {
  score: number;
  grade: Grade;
  gradeLabel: string;
  components: PersonalComponent[];
  fit: PersonalFit;
}

export interface PersonalInput {
  code: string;
  grossYieldPct: number | null;
  grossRevenue: number | null;
  occupancyPct: number | null;
  competitionPercentile: number | null; // higher = more competitive
  directBookingScore: number | null;
  licensing: LicensingStatus;
  propertyValueMid: number | null; // for the chosen bedroom count when available
  bedroomsAvailable: number[];
}

const BASE = { yield: 30, revenue: 15, occupancy: 15, competition: 10, directBooking: 10, regulatory: 10, distance: 10 } as const;
const PRIORITY_MULT: Record<Priority, number> = { 0: 0.25, 1: 0.75, 2: 1, 3: 1.5 };

function frac(value: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function regulatoryFraction(status: LicensingStatus, risk: MarketGoals['riskAppetite']): number {
  if (status === 'confirmed-unrestricted') return 1;
  if (status === 'confirmed-licensed') return risk === 'cautious' ? 0.27 : 0.6;
  return 0.4;
}

export function personaliseScore(input: PersonalInput, goals: MarketGoals): PersonalScore | null {
  const p = goals.priorities;
  const weights = {
    yield: BASE.yield * PRIORITY_MULT[p.yield],
    revenue: BASE.revenue * PRIORITY_MULT[p.revenue] * (goals.management === 'managed' ? 1.3 : 1),
    occupancy: BASE.occupancy,
    competition: BASE.competition * PRIORITY_MULT[p.lowCompetition],
    directBooking: BASE.directBooking * PRIORITY_MULT[p.directBookings],
    regulatory: BASE.regulatory * (goals.riskAppetite === 'cautious' ? 2 : goals.riskAppetite === 'tolerant' ? 0.5 : 1),
    distance: BASE.distance * (goals.management === 'self' ? 1.5 : 1),
  };

  // Distance
  let distanceMiles: number | null = null;
  let inRange: boolean | null = null;
  let distanceFrac: number | null = null;
  const home = goals.home && goals.home.lat !== null && goals.home.lng !== null ? { lat: goals.home.lat, lng: goals.home.lng } : null;
  const centroid = areaCentroid(input.code);
  if (home && centroid) {
    distanceMiles = Math.round(haversineMiles(home, centroid));
    if (goals.maxDistanceMiles) {
      const max = goals.maxDistanceMiles;
      inRange = distanceMiles <= max;
      distanceFrac = distanceMiles <= max / 2 ? 1 : distanceMiles >= max ? 0 : 1 - (distanceMiles - max / 2) / (max / 2);
    }
  }

  const components: PersonalComponent[] = [
    { key: 'yield', label: 'Yield-on-cost', weight: weights.yield, earned: input.grossYieldPct === null ? null : frac(input.grossYieldPct, 4, 14) * weights.yield, detail: input.grossYieldPct === null ? 'No property-value data' : `${input.grossYieldPct.toFixed(1)}% gross yield` },
    { key: 'revenue', label: 'Revenue scale', weight: weights.revenue, earned: input.grossRevenue === null ? null : frac(input.grossRevenue, 15000, 45000) * weights.revenue, detail: input.grossRevenue === null ? 'No revenue data' : `£${Math.round(input.grossRevenue).toLocaleString('en-GB')}/yr` },
    { key: 'occupancy', label: 'Occupancy', weight: weights.occupancy, earned: input.occupancyPct === null ? null : frac(input.occupancyPct, 40, 75) * weights.occupancy, detail: input.occupancyPct === null ? 'No occupancy data' : `${Math.round(input.occupancyPct)}% occupancy` },
    { key: 'competition', label: 'Low competition', weight: weights.competition, earned: input.competitionPercentile === null ? null : (1 - input.competitionPercentile / 100) * weights.competition, detail: input.competitionPercentile === null ? 'Not enough areas to compare' : `More competitive than ${input.competitionPercentile}% of areas` },
    { key: 'directBooking', label: 'Direct-booking potential', weight: weights.directBooking, earned: input.directBookingScore === null ? null : (input.directBookingScore / 100) * weights.directBooking, detail: input.directBookingScore === null ? 'No demand data' : `${input.directBookingScore}/100` },
    { key: 'regulatory', label: 'Regulatory ease', weight: weights.regulatory, earned: regulatoryFraction(input.licensing, goals.riskAppetite) * weights.regulatory, detail: input.licensing === 'confirmed-unrestricted' ? 'No licence required' : input.licensing === 'confirmed-licensed' ? 'Licence required' : 'Licensing unconfirmed' },
    { key: 'distance', label: 'Distance from home', weight: weights.distance, earned: distanceFrac === null ? null : distanceFrac * weights.distance, detail: distanceMiles === null ? 'No home postcode set' : goals.maxDistanceMiles ? `${distanceMiles} mi (limit ${goals.maxDistanceMiles})` : `${distanceMiles} mi, anywhere is fine` },
  ];

  const present = components.filter((c) => c.earned !== null);
  const hasPerformance = present.some((c) => c.key === 'yield' || c.key === 'occupancy' || c.key === 'revenue');
  if (!hasPerformance) return null;

  const wTotal = present.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((present.reduce((s, c) => s + (c.earned ?? 0), 0) * 100) / wTotal);
  const { grade, label } = gradeFor(score);

  const fit: PersonalFit = {
    inBudget: goals.budget === null ? null : input.propertyValueMid === null ? null : inBudget(input.propertyValueMid, goals.budget),
    hasBedrooms: goals.bedrooms === null ? null : goals.bedrooms === 4 ? input.bedroomsAvailable.some((n) => n >= 4) : input.bedroomsAvailable.includes(goals.bedrooms),
    inRange,
    distanceMiles,
  };

  return { score, grade, gradeLabel: label, components, fit };
}

/**
 * The inputs personaliseScore needs, taken from an area card. The property
 * value used for the budget check is the one for the user's bedroom goal when
 * that group exists ("4+" takes the smallest group of four or more), else the
 * area blend.
 */
export function personalInputFor(card: AreaCardData, goals: MarketGoals): PersonalInput {
  const want = goals.bedrooms;
  const group =
    want === null
      ? null
      : want === 4
        ? [...card.byBedrooms].filter((b) => b.bedrooms >= 4).sort((a, b) => a.bedrooms - b.bedrooms)[0] ?? null
        : card.byBedrooms.find((b) => b.bedrooms === want) ?? null;
  return {
    code: card.code,
    grossYieldPct: card.yieldOnCost?.grossYieldPct ?? null,
    grossRevenue: card.headline.grossRevenue,
    occupancyPct: card.headline.occupancy,
    competitionPercentile: card.competition?.percentile ?? null,
    directBookingScore: card.directBooking?.score ?? null,
    licensing: card.licensing.status,
    propertyValueMid: group?.propertyValueMid ?? card.yieldOnCost?.propertyValueMid ?? null,
    bedroomsAvailable: card.headline.bedroomsAvailable,
  };
}
