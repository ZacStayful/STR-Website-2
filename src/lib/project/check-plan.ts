/**
 * The Project job's rules (Batch 17, Part B step 6), pure: what a candidate
 * is ready for, what a failed day does, when an earlier photo check can be
 * reused, the day's allowance and spend line, and what the estimate means
 * for the row. The job itself (check-run.ts) only reads, calls and writes.
 *
 * A candidate is a sale held on Batch 16's shortlist (status pending_check,
 * stream project) whose own comparables check is done. Each UK day it is
 * "prepped" (its page read again; the exclusions, the free best case, the
 * planning checks and the sold-price ceiling), and a prepped candidate
 * waits for one of the day's photo checks.
 *
 * Pure: no network, no database, no server-only.
 */
import { countryForPostcode, type TaxCountry } from '../listing/stamp-duty.ts';
import type { ProjectAllowance } from './config.ts';
import type { PhotoFindings, PropertyFacts } from './costing.ts';
import type { EstimateOutcome, ProjectEstimate } from './estimate.ts';
import { projectCardData, type ProjectCardData } from './headline.ts';
import { homeTypeOf, type Ceiling, type HomeType } from './value.ts';

/** marketplace_runs.kind, and provider_calls.action, for the job. */
export const PROJECT_CHECKS_KIND = 'project_checks';
export const PROJECT_CHECKS_ACTION = 'project_checks';

/** What the day's prep of a candidate concluded. */
export type PrepOutcome =
  /** Every free and cheap step passed: waiting for its photo check. */
  | 'ready'
  /** Retired project_excluded (its page, or PropertyData's planning checks). */
  | 'excluded'
  /** The best case cannot pass: retired not_project. */
  | 'not_project'
  /** Too few sold prices to value it on: retired project_no_evidence. */
  | 'no_evidence'
  /** An auction lot: released to Batch 16's flow as an auction deal (Q10). */
  | 'auction'
  /** Its own page no longer says it needs work: released as an ordinary deal. */
  | 'released'
  /** Gone, unsuitable, or no longer qualifying: retired for that reason. */
  | 'retired'
  /** A step failed (the page unreadable, PropertyData down): tried again tomorrow. */
  | 'failed';

export interface PrepFacts extends PropertyFacts {
  rawType: string | null;
  homeType: HomeType | null;
  country: TaxCountry;
}

/** project_prep, as the job reads it. */
export interface Prep {
  price: number | null;
  preppedOn: string | null;
  photos: string[];
  floorplans: string[];
  facts: PrepFacts | null;
  ceiling: Ceiling | null;
  outcome: PrepOutcome | null;
  failedDays: number;
  lastFailedDay: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);

const OUTCOMES: readonly PrepOutcome[] = ['ready', 'excluded', 'not_project', 'no_evidence', 'auction', 'released', 'retired', 'failed'];
const HOME_TYPES: readonly HomeType[] = ['flat', 'terraced', 'semi', 'detached', 'bungalow'];
const COUNTRIES: readonly TaxCountry[] = ['england', 'wales', 'scotland', 'northern_ireland'];

function parseFacts(raw: unknown): PrepFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const bedrooms = num(o.bedrooms);
  if (bedrooms === null || bedrooms < 0) return null;
  return {
    bedrooms,
    bathrooms: num(o.bathrooms),
    propertyKind: o.propertyKind === 'flat' ? 'flat' : 'house',
    floorAreaSqft: num(o.floorAreaSqft),
    rawType: typeof o.rawType === 'string' ? o.rawType : null,
    homeType: HOME_TYPES.includes(o.homeType as HomeType) ? (o.homeType as HomeType) : null,
    country: COUNTRIES.includes(o.country as TaxCountry) ? (o.country as TaxCountry) : 'england',
  };
}

function parseCeiling(raw: unknown): Ceiling | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const value = num(o.value);
  const sales = num(o.sales);
  const radiusMiles = num(o.radiusMiles);
  if (value === null || value <= 0 || sales === null || radiusMiles === null) return null;
  return { value, sales, radiusMiles, basis: o.basis === 'bedrooms' ? 'bedrooms' : 'type' };
}

/** A project_prep row; null for none. Anything unreadable reads as not prepped. */
export function parsePrep(row: Record<string, unknown> | null | undefined): Prep | null {
  if (!row) return null;
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return {
    price: num(row.price),
    preppedOn: day(row.prepped_on),
    photos: strings(row.photos),
    floorplans: strings(row.floorplans),
    facts: parseFacts(row.facts),
    ceiling: parseCeiling(row.ceiling),
    outcome: OUTCOMES.includes(row.outcome as PrepOutcome) ? (row.outcome as PrepOutcome) : null,
    failedDays: Math.max(0, Math.floor(num(row.failed_days) ?? 0)),
    lastFailedDay: day(row.last_failed_day),
  };
}

/** The facts the costing reads, from a listing; null without a bedroom count. */
export function projectFactsOf(l: { bedrooms: number | null | undefined; bathrooms?: number | null; rawType?: string | null; floorAreaSqft?: number | null; postcode?: string | null; outcode?: string | null }): PrepFacts | null {
  const beds = l.bedrooms;
  if (typeof beds !== 'number' || !Number.isFinite(beds) || beds < 0) return null;
  const homeType = homeTypeOf(l.rawType ?? null);
  const baths = typeof l.bathrooms === 'number' && Number.isFinite(l.bathrooms) && l.bathrooms > 0 ? l.bathrooms : null;
  const area = typeof l.floorAreaSqft === 'number' && Number.isFinite(l.floorAreaSqft) && l.floorAreaSqft > 0 ? l.floorAreaSqft : null;
  return {
    bedrooms: Math.floor(beds),
    bathrooms: baths,
    propertyKind: homeType === 'flat' ? 'flat' : 'house',
    floorAreaSqft: area,
    rawType: l.rawType ?? null,
    homeType,
    country: countryForPostcode(l.postcode ?? l.outcode ?? null),
  };
}

/** Prepped today at this price, with every step passed: ready for its photo check. */
export function readyForCheck(prep: Prep | null, price: number | null, today: string): boolean {
  if (!prep || prep.outcome !== 'ready' || prep.preppedOn !== today || prep.lastFailedDay === today) return false;
  if (price === null || prep.price !== price) return false;
  return prep.photos.length > 0 && prep.facts !== null && prep.ceiling !== null;
}

/** Still to be prepped today: not prepped today at this price, and nothing failed for it today. */
export function needsPrep(prep: Prep | null, price: number | null, today: string): boolean {
  if (!prep) return true;
  if (prep.lastFailedDay === today) return false;
  return !(prep.preppedOn === today && prep.price === price);
}

/**
 * A step failed today (the page, PropertyData, the model): the day counts
 * once however often it fails, and at `giveUpDays` such days the candidate
 * is let go (retired project_uncheckable).
 */
export function failedDay(prep: Pick<Prep, 'failedDays' | 'lastFailedDay'> | null, today: string, giveUpDays: number): { failedDays: number; lastFailedDay: string; giveUp: boolean } {
  const before = prep?.failedDays ?? 0;
  const failedDays = prep?.lastFailedDay === today ? Math.max(1, before) : before + 1;
  return { failedDays, lastFailedDay: today, giveUp: failedDays >= Math.max(1, giveUpDays) };
}

export interface EarlierCheck {
  photos: readonly string[];
  floorplans: readonly string[];
  /** When it was made (ISO). */
  at: string;
  findings: PhotoFindings;
  id: string;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * An earlier photo check to reuse instead of paying again: the newest one
 * within `reuseDays` that looked at exactly the photos and floorplans the
 * page shows now (in the same order, so its photo numbers still hold). A
 * price change does not stop the reuse: the estimate is worked out again,
 * free, at the new price.
 */
export function reusableCheck(earlier: readonly EarlierCheck[], now: { photos: readonly string[]; floorplans: readonly string[] }, at: Date, reuseDays: number): EarlierCheck | null {
  if (reuseDays <= 0 || now.photos.length === 0) return null;
  const since = at.getTime() - reuseDays * 24 * 60 * 60 * 1000;
  const fits = earlier.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= since && sameList(e.photos, now.photos) && sameList(e.floorplans, now.floorplans);
  });
  fits.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return fits[0] ?? null;
}

/** What today's runs and claims have used of the day. */
export interface ProjectDayUse {
  /** Photo checks claimed today (project_checks rows for the UK day). */
  photoChecks: number;
  /** Their spend, raw pence. */
  photoPence: number;
  /** Sold prices and planning checks today, raw pence (from the runs). */
  otherPence: number;
  /** Paid sold-price lookups today (from the runs). */
  soldLookups: number;
}

export function emptyDayUse(): ProjectDayUse {
  return { photoChecks: 0, photoPence: 0, otherPence: 0, soldLookups: 0 };
}

/** Today's sold-price lookups and other spend from the day's real runs' summaries. */
export function dayUseFromRuns(summaries: readonly unknown[]): Pick<ProjectDayUse, 'otherPence' | 'soldLookups'> {
  let otherPence = 0;
  let soldLookups = 0;
  for (const raw of summaries) {
    const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    otherPence += Math.max(0, num(s.otherPence) ?? 0);
    soldLookups += Math.max(0, Math.floor(num(s.soldLookups) ?? 0));
  }
  return { otherPence: Math.round(otherPence * 100) / 100, soldLookups };
}

/** The day's spend line left, raw pence: the cap less the photo checks' and everything else's spend. */
export function capLeftPence(allowance: ProjectAllowance, use: ProjectDayUse): number {
  return Math.max(0, Math.round((allowance.capPence - use.photoPence - use.otherPence) * 100) / 100);
}

/** Photo checks the day still allows (the claim function has the last word). */
export function photoChecksLeft(allowance: ProjectAllowance, use: ProjectDayUse): number {
  return Math.max(0, allowance.photoChecks - use.photoChecks);
}

/**
 * The cap passed to project_claim_check: the claim function sums the day's
 * photo-check spend itself, so it is given the cap less everything else
 * spent today.
 */
export function claimCapPence(allowance: ProjectAllowance, otherPence: number): number {
  return Math.max(0, Math.round((allowance.capPence - otherPence) * 100) / 100);
}

/** What the photo check's estimate does to the held row. */
export type CheckVerdict =
  /** Passes: live as a Project (BRRR) deal with these card numbers. */
  | { kind: 'project'; estimate: ProjectEstimate; card: ProjectCardData }
  /** The photos say ready to go: released as an ordinary Short-let deal. */
  | { kind: 'ready' }
  /** It needs work but the value added does not pass: never shown (Q3). */
  | { kind: 'not_project'; estimate: ProjectEstimate };

export function verdictFor(outcome: EstimateOutcome, bedrooms: number, now: Date): CheckVerdict {
  if (outcome.kind === 'ready') return { kind: 'ready' };
  const e = outcome.estimate;
  if (!e.test.passes) return { kind: 'not_project', estimate: e };
  return { kind: 'project', estimate: e, card: projectCardData(e, bedrooms, now) };
}

/** A live Project deal whose price has moved since it was costed: re-costed free on the next run. */
export function needsRecost(card: Pick<ProjectCardData, 'price'> | null, priceAmount: number | string | null): boolean {
  const p = num(priceAmount);
  return card !== null && p !== null && p > 0 && Math.round(card.price) !== Math.round(p);
}
