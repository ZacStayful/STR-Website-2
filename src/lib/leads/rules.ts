/**
 * Lead qualification: the filter a customer sets on their funnel so only
 * the properties worth their time reach their CRM.
 *
 * Stored as jsonb on `funnels.lead_rules`, so parsing is deliberately
 * tolerant — a corrupted or hand-edited value falls back to "no filter"
 * rather than silently rejecting every lead. Pure module (no I/O, no
 * `server-only`, relative `.ts` imports) so it runs under `node --test`.
 *
 * This is a different object from `profiles.market_goals`, which describes
 * what a *member* wants from their own daily picks. Lead rules describe
 * which *strangers* are worth replying to, and need ranges where goals
 * only had single values.
 *
 * A rule that cannot be measured does not fail a lead. If a data provider
 * was flaky and a report came back without comparables, the customer
 * should get the lead with the gap flagged, not lose it silently — so a
 * check reports `unknown` and only `fail` blocks. `unknownChecks` on the
 * verdict lets the UI say "qualified, but two rules could not be checked".
 */

import type { AnalysisResult } from '../types.ts';
import { averageReviewCount, averageRating } from '../listing/competitors.ts';
import { competitionIntensity } from '../market/competition.ts';
import { postcodeAreaOf } from '../listing/normalise.ts';

export interface LeadRules {
  version: 1;
  /** Inclusive bedroom range, e.g. 2–5. Null either side means unbounded. */
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  /** Minimum projected annual gross short-let revenue, £. */
  grossRevenueMin: number | null;
  /** Reject markets whose comparables average more reviews than this. */
  maxAvgReviewCount: number | null;
  /** Reject markets above this competition intensity (0–100). */
  maxCompetitionIntensity: number | null;
  /** Postcode-area allow list, e.g. ['M', 'LS']. Null or empty = anywhere. */
  postcodeAreas: string[] | null;
  /** Postcode-area block list. Takes precedence over the allow list. */
  excludePostcodeAreas: string[] | null;
}

export const DEFAULT_LEAD_RULES: LeadRules = {
  version: 1,
  bedroomsMin: null,
  bedroomsMax: null,
  grossRevenueMin: null,
  maxAvgReviewCount: null,
  maxCompetitionIntensity: null,
  postcodeAreas: null,
  excludePostcodeAreas: null,
};

export type RuleId =
  | 'bedrooms'
  | 'grossRevenue'
  | 'avgReviewCount'
  | 'competitionIntensity'
  | 'postcodeArea';

export type CheckStatus = 'pass' | 'fail' | 'unknown';

export interface RuleCheck {
  rule: RuleId;
  /** Customer-facing name of what was measured. */
  label: string;
  status: CheckStatus;
  /** What this lead actually measured, or null when it could not be read. */
  actual: number | string | null;
  /** The rule it was measured against, worded for a person. */
  threshold: string;
  /** One line explaining a fail or an unknown. Empty on a pass. */
  reason: string;
}

export interface LeadVerdict {
  qualified: boolean;
  checks: RuleCheck[];
  /** Rules that could not be measured. Non-zero means the verdict is partial. */
  unknownChecks: number;
  /** Short summary of why a lead failed, for a CRM field or a list row. */
  summary: string;
}

const LABELS: Record<RuleId, string> = {
  bedrooms: 'Bedrooms',
  grossRevenue: 'Projected gross revenue',
  avgReviewCount: 'Market saturation (avg reviews)',
  competitionIntensity: 'Competition intensity',
  postcodeArea: 'Location',
};

// ─── Parsing ──────────────────────────────────────────────────────────

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[£,\s]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Upper-cased postcode-area letters only; anything else is dropped. */
function areas(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .map((a) => (typeof a === 'string' ? a.trim().toUpperCase() : ''))
    .filter((a) => /^[A-Z]{1,2}$/.test(a));
  return out.length > 0 ? Array.from(new Set(out)) : null;
}

/**
 * Tolerant parse of a stored value. Never throws, never returns null: an
 * unusable value becomes "no filter", which lets every lead through rather
 * than rejecting every lead.
 */
export function parseLeadRules(raw: unknown): LeadRules {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LEAD_RULES };
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return { ...DEFAULT_LEAD_RULES };

  let bedroomsMin = num(o.bedroomsMin, 0, 10);
  let bedroomsMax = num(o.bedroomsMax, 0, 10);
  // A range entered backwards is a typo, not an instruction to reject
  // everything. Swap it rather than qualifying nothing.
  if (bedroomsMin !== null && bedroomsMax !== null && bedroomsMin > bedroomsMax) {
    [bedroomsMin, bedroomsMax] = [bedroomsMax, bedroomsMin];
  }

  return {
    version: 1,
    bedroomsMin,
    bedroomsMax,
    grossRevenueMin: num(o.grossRevenueMin, 0, 10_000_000),
    maxAvgReviewCount: num(o.maxAvgReviewCount, 0, 100_000),
    maxCompetitionIntensity: num(o.maxCompetitionIntensity, 0, 100),
    postcodeAreas: areas(o.postcodeAreas),
    excludePostcodeAreas: areas(o.excludePostcodeAreas),
  };
}

/** True when the rules would let every lead through. */
export function rulesAreEmpty(rules: LeadRules): boolean {
  return (
    rules.bedroomsMin === null &&
    rules.bedroomsMax === null &&
    rules.grossRevenueMin === null &&
    rules.maxAvgReviewCount === null &&
    rules.maxCompetitionIntensity === null &&
    (rules.postcodeAreas === null || rules.postcodeAreas.length === 0) &&
    (rules.excludePostcodeAreas === null || rules.excludePostcodeAreas.length === 0)
  );
}

// ─── Measuring ────────────────────────────────────────────────────────

/** What a report says about the things rules can be set on. */
export interface LeadMeasurements {
  bedrooms: number | null;
  grossRevenue: number | null;
  avgReviewCount: number | null;
  competitionIntensity: number | null;
  postcodeArea: string | null;
}

/**
 * Reads the measurable figures out of a finished report. Uses the same
 * `averageReviewCount` the analyser shows the customer, so a rule is set
 * against the number they were looking at.
 */
export function measureLead(result: AnalysisResult): LeadMeasurements {
  const comps = result.shortLet?.comparables ?? [];
  const avgReviewCount = averageReviewCount(comps);
  const avgRating = averageRating(comps);
  const revenue = result.shortLet?.annualRevenue;

  return {
    bedrooms: Number.isFinite(result.property?.bedrooms) ? result.property.bedrooms : null,
    // Zero revenue means the short-let lookup failed, not a free property.
    grossRevenue: typeof revenue === 'number' && revenue > 0 ? revenue : null,
    avgReviewCount,
    competitionIntensity: avgReviewCount === null && avgRating === null ? null : competitionIntensity(avgRating, avgReviewCount),
    postcodeArea: postcodeAreaOf(result.property?.postcode),
  };
}

// ─── Evaluating ───────────────────────────────────────────────────────

function check(rule: RuleId, status: CheckStatus, actual: number | string | null, threshold: string, reason = ''): RuleCheck {
  return { rule, label: LABELS[rule], status, actual, threshold, reason };
}

function bedroomsCheck(m: LeadMeasurements, r: LeadRules): RuleCheck | null {
  if (r.bedroomsMin === null && r.bedroomsMax === null) return null;
  const threshold =
    r.bedroomsMin !== null && r.bedroomsMax !== null ? `${r.bedroomsMin}–${r.bedroomsMax} bedrooms`
    : r.bedroomsMin !== null ? `${r.bedroomsMin}+ bedrooms`
    : `up to ${r.bedroomsMax} bedrooms`;
  if (m.bedrooms === null) return check('bedrooms', 'unknown', null, threshold, 'The report did not record a bedroom count.');
  if (r.bedroomsMin !== null && m.bedrooms < r.bedroomsMin) {
    return check('bedrooms', 'fail', m.bedrooms, threshold, `${m.bedrooms} bedrooms is below the ${r.bedroomsMin} minimum.`);
  }
  if (r.bedroomsMax !== null && m.bedrooms > r.bedroomsMax) {
    return check('bedrooms', 'fail', m.bedrooms, threshold, `${m.bedrooms} bedrooms is above the ${r.bedroomsMax} maximum.`);
  }
  return check('bedrooms', 'pass', m.bedrooms, threshold);
}

function revenueCheck(m: LeadMeasurements, r: LeadRules): RuleCheck | null {
  if (r.grossRevenueMin === null) return null;
  const threshold = `£${r.grossRevenueMin.toLocaleString('en-GB')}+ gross a year`;
  if (m.grossRevenue === null) {
    return check('grossRevenue', 'unknown', null, threshold, 'No short-let revenue projection was available for this property.');
  }
  if (m.grossRevenue < r.grossRevenueMin) {
    return check('grossRevenue', 'fail', Math.round(m.grossRevenue), threshold, `£${Math.round(m.grossRevenue).toLocaleString('en-GB')} projected is below the £${r.grossRevenueMin.toLocaleString('en-GB')} minimum.`);
  }
  return check('grossRevenue', 'pass', Math.round(m.grossRevenue), threshold);
}

function reviewsCheck(m: LeadMeasurements, r: LeadRules): RuleCheck | null {
  if (r.maxAvgReviewCount === null) return null;
  const threshold = `under ${r.maxAvgReviewCount} average reviews`;
  if (m.avgReviewCount === null) {
    return check('avgReviewCount', 'unknown', null, threshold, 'No comparable listings carried review counts, so saturation could not be read.');
  }
  if (m.avgReviewCount > r.maxAvgReviewCount) {
    return check('avgReviewCount', 'fail', m.avgReviewCount, threshold, `Comparables average ${m.avgReviewCount} reviews, above the ${r.maxAvgReviewCount} ceiling — an established market.`);
  }
  return check('avgReviewCount', 'pass', m.avgReviewCount, threshold);
}

function intensityCheck(m: LeadMeasurements, r: LeadRules): RuleCheck | null {
  if (r.maxCompetitionIntensity === null) return null;
  const threshold = `intensity ${r.maxCompetitionIntensity} or below`;
  if (m.competitionIntensity === null) {
    return check('competitionIntensity', 'unknown', null, threshold, 'No competitor ratings or review counts were available.');
  }
  if (m.competitionIntensity > r.maxCompetitionIntensity) {
    return check('competitionIntensity', 'fail', m.competitionIntensity, threshold, `Competition intensity ${m.competitionIntensity} is above the ${r.maxCompetitionIntensity} ceiling.`);
  }
  return check('competitionIntensity', 'pass', m.competitionIntensity, threshold);
}

function locationCheck(m: LeadMeasurements, r: LeadRules): RuleCheck | null {
  const allow = r.postcodeAreas ?? [];
  const block = r.excludePostcodeAreas ?? [];
  if (allow.length === 0 && block.length === 0) return null;
  const threshold = [
    allow.length > 0 ? `in ${allow.join(', ')}` : null,
    block.length > 0 ? `not in ${block.join(', ')}` : null,
  ].filter(Boolean).join('; ');
  if (m.postcodeArea === null) {
    return check('postcodeArea', 'unknown', null, threshold, 'The postcode could not be read as a UK area.');
  }
  // A block list beats an allow list, so an area in both is rejected.
  if (block.includes(m.postcodeArea)) {
    return check('postcodeArea', 'fail', m.postcodeArea, threshold, `${m.postcodeArea} is on the excluded list.`);
  }
  if (allow.length > 0 && !allow.includes(m.postcodeArea)) {
    return check('postcodeArea', 'fail', m.postcodeArea, threshold, `${m.postcodeArea} is outside the areas you cover.`);
  }
  return check('postcodeArea', 'pass', m.postcodeArea, threshold);
}

/**
 * Applies a customer's rules to a finished report. Only a `fail` blocks;
 * see the note at the top about why an unmeasurable rule does not.
 */
export function evaluateLead(result: AnalysisResult, rules: LeadRules): LeadVerdict {
  const m = measureLead(result);
  const checks = [
    bedroomsCheck(m, rules),
    revenueCheck(m, rules),
    reviewsCheck(m, rules),
    intensityCheck(m, rules),
    locationCheck(m, rules),
  ].filter((c): c is RuleCheck => c !== null);

  const failed = checks.filter((c) => c.status === 'fail');
  const unknownChecks = checks.filter((c) => c.status === 'unknown').length;

  const summary =
    failed.length > 0 ? failed.map((c) => c.reason).join(' ')
    : unknownChecks > 0 ? `Qualified, but ${unknownChecks} rule${unknownChecks === 1 ? '' : 's'} could not be checked.`
    : checks.length === 0 ? 'No filter set — every lead qualifies.'
    : 'Meets every rule.';

  return { qualified: failed.length === 0, checks, unknownChecks, summary };
}
