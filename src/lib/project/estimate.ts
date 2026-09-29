/**
 * One project estimate, end to end: the photo check's findings → the works
 * lines and range → the value after works and the test → the finance. The
 * same sums run on a member's edited lines (Part G), so their figures and
 * ours can never be worked out two different ways.
 *
 * Pure: no network, no database, no server-only.
 */

import type { AuctionTerms } from '../deal-quality/auction.ts';
import type { TaxCountry } from '../listing/stamp-duty.ts';
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from './config.ts';
import { bestCaseLines, levelFor, linesFromFindings, summariseWorks, type PhotoFindings, type ProjectLevel, type ProjectLevelOrReady, type PropertyFacts, type WorksLine, type WorksSummary } from './costing.ts';
import { projectFinance, type ProjectFinance } from './finance.ts';
import { valueAfterWorks, valueTest, type Ceiling, type ValueAfterWorks, type ValueTest } from './value.ts';

export const ESTIMATE_VERSION = 1;

export interface EvaluateInput {
  price: number;
  facts: PropertyFacts;
  country: TaxCountry;
  level: ProjectLevel;
  lines: readonly WorksLine[];
  ceiling: Ceiling | null;
  settings?: ProjectSettings;
  bridging?: AuctionTerms;
  /** The member's deposit for a light refresh's cash needed; the house 25% without one. */
  depositPct?: number;
}

export interface Evaluation {
  level: ProjectLevel;
  lines: WorksLine[];
  works: WorksSummary;
  value: ValueAfterWorks;
  test: ValueTest;
  finance: ProjectFinance;
}

/** The sums on any set of lines: ours or a member's. */
export function evaluateLines(input: EvaluateInput): Evaluation {
  const s = input.settings ?? DEFAULT_PROJECT_SETTINGS;
  const lines = input.lines.map((l) => ({ ...l, photos: [...l.photos] }));
  const works = summariseWorks(lines, s.rates.contingencyPct);
  const value = valueAfterWorks(input.price, works, input.ceiling, s.value);
  const test = valueTest(input.price, works.high, value.value, s.value);
  const finance = projectFinance({
    level: input.level,
    price: input.price,
    bedrooms: input.facts.bedrooms,
    country: input.country,
    works: { low: works.low, high: works.high },
    value: value.value,
    depositPct: input.depositPct,
    costs: s.costs,
    valueSettings: s.value,
    bridging: input.bridging,
  });
  return { level: input.level, lines, works, value, test, finance };
}

export interface ProjectEstimate extends Evaluation {
  v: typeof ESTIMATE_VERSION;
  /** The photos' own rating, before the works override. */
  photoCondition: PhotoFindings['condition'];
}

export type EstimateOutcome =
  /** The photos say ready to go: released as an ordinary Buy-and-let deal. */
  | { kind: 'ready'; lowWorks: number }
  | { kind: 'project'; estimate: ProjectEstimate };

/**
 * The estimate from the photo check. "ready" when the photos (and the works
 * they clearly show) say the property is ready to go; otherwise the project,
 * passing or failing the test (the caller keeps a fail out of sight, Q3).
 */
export function estimateFromFindings(input: Omit<EvaluateInput, 'lines' | 'level'> & { findings: PhotoFindings }): EstimateOutcome {
  const s = input.settings ?? DEFAULT_PROJECT_SETTINGS;
  const lines = linesFromFindings(input.facts, input.findings, s.rates, s.quantities);
  const low = summariseWorks(lines, s.rates.contingencyPct).low;
  const level: ProjectLevelOrReady = levelFor(input.findings.condition, low, s.costs);
  if (level === 'ready') return { kind: 'ready', lowWorks: low };
  const e = evaluateLines({ ...input, level, lines });
  return { kind: 'project', estimate: { v: ESTIMATE_VERSION, photoCondition: input.findings.condition, ...e } };
}

export interface BestCase {
  worksHigh: number;
  value: number;
  valueAdded: number;
  valueAddedPct: number;
  passes: boolean;
}

/**
 * The free best-case test (Part B): every visible line needed with an
 * extra-big kitchen, no ceiling. A listing that fails even this can never be
 * a Project deal, so nothing is spent on it.
 */
export function bestCase(price: number, facts: PropertyFacts, settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS): BestCase {
  const lines = bestCaseLines(facts, settings.rates, settings.quantities);
  const works = summariseWorks(lines, settings.rates.contingencyPct);
  const value = valueAfterWorks(price, works, null, settings.value);
  const test = valueTest(price, works.high, value.value, settings.value);
  return { worksHigh: works.high, value: value.value, valueAdded: test.valueAdded, valueAddedPct: test.valueAddedPct, passes: test.passes };
}
