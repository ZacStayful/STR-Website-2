/**
 * Transparent Market Explorer area score (0–100, higher is better).
 *
 * Signed off by Zac (docs/market-explorer/score-proposal.md), built exactly as
 * proposed. NOT a black box — it is the sum of four named, explainable
 * sub-scores, and `components` exposes each one (raw value + points earned) so
 * the UI can "show our working".
 *
 *   Yield-on-cost   40 pts   4% → 14% gross yield
 *   Occupancy       25 pts   40% → 75%
 *   Revenue scale   20 pts   £15k → £45k/yr
 *   Regulatory ease 15 pts   unrestricted 15 · licensed 9 · unconfirmed 6
 *
 * Missing inputs: a component whose input is null is dropped and the remaining
 * weights are renormalised to 100. If the yield component (the biggest) is
 * missing the score is flagged `partial`. Returns null only when no performance
 * component (yield/occupancy/revenue) is available — a score from regulatory
 * alone would be meaningless.
 */

import type { LicensingStatus } from '../data/str-licensing.ts';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ScoreComponent {
  key: 'yield' | 'occupancy' | 'revenue' | 'regulatory';
  label: string;
  weight: number;
  /** Points earned on the component's own 0..weight scale, or null if absent. */
  earned: number | null;
  /** Human-readable raw value behind the component. */
  detail: string;
}

export interface AreaScore {
  score: number; // 0–100
  grade: Grade;
  gradeLabel: string;
  /** True when the yield component (largest weight) couldn't be included. */
  partial: boolean;
  components: ScoreComponent[];
}

export interface ScoreInput {
  grossYieldPct: number | null;
  occupancyPct: number | null; // 0–100
  grossRevenue: number | null;
  licensing: LicensingStatus;
}

function band(value: number, lo: number, hi: number, weight: number): number {
  const raw = ((value - lo) / (hi - lo)) * weight;
  return Math.max(0, Math.min(weight, raw));
}

function regulatoryPoints(status: LicensingStatus): number {
  if (status === 'confirmed-unrestricted') return 15;
  if (status === 'confirmed-licensed') return 9;
  return 6; // unconfirmed — lowest, uncertainty is itself a risk
}

const GRADES: { min: number; grade: Grade; label: string }[] = [
  { min: 80, grade: 'A', label: 'Exceptional' },
  { min: 65, grade: 'B', label: 'Strong' },
  { min: 50, grade: 'C', label: 'Moderate' },
  { min: 35, grade: 'D', label: 'Marginal' },
  { min: 0, grade: 'E', label: 'Weak' },
];

export function gradeFor(score: number): { grade: Grade; label: string } {
  const g = GRADES.find((x) => score >= x.min)!;
  return { grade: g.grade, label: g.label };
}

export function computeAreaScore(input: ScoreInput): AreaScore | null {
  const components: ScoreComponent[] = [
    {
      key: 'yield',
      label: 'Yield-on-cost',
      weight: 40,
      earned: input.grossYieldPct === null ? null : band(input.grossYieldPct, 4, 14, 40),
      detail: input.grossYieldPct === null ? 'No property-value data' : `${input.grossYieldPct.toFixed(1)}% gross yield`,
    },
    {
      key: 'occupancy',
      label: 'Occupancy',
      weight: 25,
      earned: input.occupancyPct === null ? null : band(input.occupancyPct, 40, 75, 25),
      detail: input.occupancyPct === null ? 'No occupancy data' : `${Math.round(input.occupancyPct)}% occupancy`,
    },
    {
      key: 'revenue',
      label: 'Revenue scale',
      weight: 20,
      earned: input.grossRevenue === null ? null : band(input.grossRevenue, 15000, 45000, 20),
      detail: input.grossRevenue === null ? 'No revenue data' : `£${Math.round(input.grossRevenue).toLocaleString('en-GB')}/yr`,
    },
    {
      key: 'regulatory',
      label: 'Regulatory ease',
      weight: 15,
      earned: regulatoryPoints(input.licensing),
      detail:
        input.licensing === 'confirmed-unrestricted'
          ? 'No licence required'
          : input.licensing === 'confirmed-licensed'
            ? 'Licence required'
            : 'Licensing unconfirmed',
    },
  ];

  // Need at least one performance component (not regulatory alone).
  const hasPerformance = components.some((c) => c.key !== 'regulatory' && c.earned !== null);
  if (!hasPerformance) return null;

  const present = components.filter((c) => c.earned !== null);
  const earnedTotal = present.reduce((s, c) => s + (c.earned ?? 0), 0);
  const weightTotal = present.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((earnedTotal * 100) / weightTotal);

  const { grade, label } = gradeFor(score);
  const partial = components.find((c) => c.key === 'yield')!.earned === null;

  return { score, grade, gradeLabel: label, partial, components };
}
