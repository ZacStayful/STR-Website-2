/**
 * The member's search criteria ("what are you looking for?"), stored on
 * profiles.market_goals. Every field is optional in spirit: null means "no
 * preference", and the personalised score simply drops the corresponding
 * component. Parsing is strict so a corrupted or hand-edited value can never
 * crash the explorer — it just falls back to no goals.
 *
 * Version 2 (Batch 12, the profile quiz) keeps every version-1 field as it
 * was and adds the quiz's search-criteria answers: the member's path (buy,
 * rent-to-rent, sourcing, management), where to look, and one group of
 * answers per path. A stored version-1 profile reads as version 2 with the
 * new fields null; every writer writes version 2. The member's "about you"
 * answers (experience, time, risk…) are not here: they belong to the member,
 * not the search, and live in profiles.about_you (src/lib/profile/about.ts).
 * Batch 13 turns this one object into a saved profile; Batch 14 ranks on it.
 */

import { BUDGET_LABELS, isBudget, type Budget } from './filters.ts';
import { AREA_META } from './areas.ts';
import { DEFAULT_FINANCE } from '../listing/deal.ts';

export type Priority = 0 | 1 | 2 | 3; // not important → essential
export type Management = 'self' | 'managed';
export type RiskAppetite = 'cautious' | 'balanced' | 'tolerant';

/**
 * Miles from home the member would go: 10 to 100 in steps of 10 (the quiz's
 * slider). 25 is kept for profiles written before Batch 12 (the old 25 / 50 /
 * 100 choice); the slider shows it as 30 the next time it is edited.
 */
export type MaxDistance = number;
export const DISTANCE_MILES = { min: 10, max: 100, step: 10 } as const;
export const LEGACY_DISTANCE_MILES = 25;

export function parseMaxDistance(v: unknown): MaxDistance | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n === LEGACY_DISTANCE_MILES) return n;
  return n >= DISTANCE_MILES.min && n <= DISTANCE_MILES.max && n % DISTANCE_MILES.step === 0 ? n : null;
}

/** Where the slider sits for a stored radius: a legacy 25 rounds up to the next step. */
export function sliderMiles(v: MaxDistance | null): number {
  if (v === null) return 50;
  const step = DISTANCE_MILES.step;
  return Math.min(DISTANCE_MILES.max, Math.max(DISTANCE_MILES.min, Math.ceil(v / step) * step));
}

/** Finance defaults used by the deal maths on any listing the member checks. */
export interface FinanceGoals {
  depositPct: number; // 25
  mortgageRatePct: number; // 5.5
  termYears: number; // 25
  targetYieldPct: number; // 10
  targetMarginPcm: number; // 500
}

/** The house figures: listing/deal.ts DEFAULT_FINANCE's five member fields (the mortgage type is not a goal; it lives there). */
export const DEFAULT_FINANCE_GOALS: FinanceGoals = {
  depositPct: DEFAULT_FINANCE.depositPct,
  mortgageRatePct: DEFAULT_FINANCE.mortgageRatePct,
  termYears: DEFAULT_FINANCE.termYears,
  targetYieldPct: DEFAULT_FINANCE.targetYieldPct,
  targetMarginPcm: DEFAULT_FINANCE.targetMarginPcm,
};

/** What the daily deal-sourcing digest should look for. */
export type SourcingKind = 'sale' | 'rent' | 'both';

/**
 * How hard the motivated-seller filter bites.
 *   off     — ignore motivation entirely (what everyone gets until they ask)
 *   prefer  — motivated listings rank higher, nothing is ever excluded
 *   only    — a listing must clear the bar, with real evidence behind it
 */
export type MotivationMode = 'off' | 'prefer' | 'only';

export const MOTIVATION_MODE_LABELS: Record<MotivationMode, string> = {
  off: 'Any seller',
  prefer: 'Prefer motivated sellers',
  only: 'Motivated sellers only',
};

/**
 * "Find me someone who wants to deal." Months for a sale, weeks for a let:
 * rental markets clear several times faster, so a rental sitting five months is
 * not a sharper version of the same signal, it is a different order of trouble.
 */
export interface MotivationGoals {
  mode: MotivationMode;
  /** Months a SALE listing must have been up before it counts as stale. */
  minMonthsOnMarket: number;
  /** Weeks a RENT listing must have been up before it counts as a long void. */
  minWeeksOnMarket: number;
  /** Also require it to be slower than its own area, not just slow in the abstract. */
  areaRelative: boolean;
}

export const DEFAULT_MOTIVATION: MotivationGoals = { mode: 'off', minMonthsOnMarket: 5, minWeeksOnMarket: 8, areaRelative: true };
export const MIN_MONTHS_RANGE = { min: 1, max: 24 } as const;
export const MIN_WEEKS_RANGE = { min: 1, max: 52 } as const;

export function isMotivationMode(v: unknown): v is MotivationMode {
  return v === 'off' || v === 'prefer' || v === 'only';
}

/** Tolerant parse: anything missing or silly falls back to the default. */
export function parseMotivationGoals(raw: unknown): MotivationGoals {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_MOTIVATION;
  return {
    mode: isMotivationMode(m.mode) ? m.mode : d.mode,
    minMonthsOnMarket: Math.round(financeField(m.minMonthsOnMarket, d.minMonthsOnMarket, MIN_MONTHS_RANGE.min, MIN_MONTHS_RANGE.max)),
    minWeeksOnMarket: Math.round(financeField(m.minWeeksOnMarket, d.minWeeksOnMarket, MIN_WEEKS_RANGE.min, MIN_WEEKS_RANGE.max)),
    // Absent means the default (on), not off: a stored profile written before
    // this existed should get the safer, more accurate behaviour.
    areaRelative: m.areaRelative === undefined ? d.areaRelative : m.areaRelative !== false,
  };
}

/** The member's "too long" line for one kind, in days. */
export function thresholdDaysFor(g: MotivationGoals, kind: 'sale' | 'rent'): number {
  return kind === 'rent' ? g.minWeeksOnMarket * 7 : Math.round(g.minMonthsOnMarket * 30.44);
}

// ── Batch 12: the quiz's search-criteria answers ──

/**
 * Every multiple-choice answer the quiz stores here, with its allowed values.
 * One place, so the parser, the questions (src/lib/profile/questions.ts) and
 * the tests can never disagree about what a stored value may be.
 */
export const GOAL_OPTIONS = {
  /** What the member does with deals: sets sourcingKind and which questions are asked. */
  path: ['buy', 'r2r', 'source', 'manage'],
  /**
   * Batch 17: "Which deals do you want to see?", per profile and multi-select,
   * in the question's own order. What decides the deal types a profile is
   * shown (src/lib/profile/deal-types.ts); sourcingKind follows from it.
   *
   *   buy_str  Short-let: buy it and run it as a holiday let
   *   brrr     BRRR: buy, refurb, refinance (a Project deal)
   *   r2r      Rent-to-rent
   *   btl      Buy to let (long-term tenants): declared, NOT available yet
   *            (AVAILABLE_DEAL_TYPES below). Batch 28 switches it on.
   *
   * Reserved for later, not a type yet: 'hmo'.
   */
  dealTypes: ['buy_str', 'brrr', 'r2r', 'btl'],
  /** Batch 17: "How much work would you take on?" for BRRR (it replaced Condition). */
  brrrWork: ['light', 'full', 'either'],
  /** Where to look: near home, chosen areas, anywhere, or near home plus the best elsewhere. */
  where: ['near', 'areas', 'anywhere', 'near_plus_best'],
  // Investor buying
  cashAvailable: ['u30', '30-60', '60-100', '100-200', '200+'],
  funding: ['cash', 'btl', 'holiday_let', 'bridging'],
  entity: ['own_name', 'company', 'undecided'],
  mainGoal: ['cashflow', 'growth', 'both'],
  propertyType: ['flat', 'house', 'either'],
  condition: ['ready', 'refresh', 'project'],
  leaseholdOk: ['yes', 'no', 'depends'],
  restrictedAreas: ['avoid', 'warn'],
  // Rent-to-rent operator
  setupBudget: ['u3k', '3-6k', '6-10k', '10k+'],
  dealStructure: ['company_let', 'management', 'guaranteed_rent', 'any'],
  furnished: ['either', 'furnished', 'unfurnished'],
  // Deal sourcer
  sourceFor: ['buyers', 'r2r', 'both'],
  sourcingFee: ['u2k', '2-4k', '4k+'],
  dealsPerMonth: ['1-2', '3-5', '6+'],
  // Management company
  unitsManaged: ['1-10', '11-30', '31-75', '76+'],
  lookingFor: ['landlords', 'own_deals', 'both'],
} as const;

export type GoalOption<K extends keyof typeof GOAL_OPTIONS> = (typeof GOAL_OPTIONS)[K][number];
export type ProfilePath = GoalOption<'path'>;
export type WhereMode = GoalOption<'where'>;

export const BREAK_EVEN_OPTIONS = [50, 60, 70] as const;
export const PAYBACK_OPTIONS = [6, 12, 18] as const;
export const GROWTH_OPTIONS = [5, 10, 25] as const;

export interface BuyerGoals {
  /** Deposit plus costs the member can put in. */
  cashAvailable: GoalOption<'cashAvailable'> | null;
  funding: GoalOption<'funding'> | null;
  entity: GoalOption<'entity'> | null;
  mainGoal: GoalOption<'mainGoal'> | null;
  propertyType: GoalOption<'propertyType'> | null;
  condition: GoalOption<'condition'> | null;
  leaseholdOk: GoalOption<'leaseholdOk'> | null;
  restrictedAreas: GoalOption<'restrictedAreas'> | null;
}

export type DealType = GoalOption<'dealTypes'>;

/**
 * The deal types a profile can choose and hold today: the one list the
 * "Coming soon" state comes from. Buy to let (long-term tenants) is declared
 * but not here, so the question shows it greyed out, "All of them" means
 * these three, a stored 'btl' is dropped when read, and nothing sources,
 * ranks or shows it. Batch 28 switches it on by adding it here.
 */
export const AVAILABLE_DEAL_TYPES: readonly DealType[] = ['buy_str', 'brrr', 'r2r'];

export interface R2rGoals {
  /**
   * Batch 17: the rent-to-rent minimum profit, £ a month. It used to share
   * finance.targetMarginPcm with the buyer's minimum profit, so a member doing
   * both had one answer overwrite the other; null until answered here, when
   * readers fall back to the shared figure.
   */
  minMarginPcm: number | null;
  setupBudget: GoalOption<'setupBudget'> | null;
  dealStructure: GoalOption<'dealStructure'> | null;
  breakEvenOccupancyPct: (typeof BREAK_EVEN_OPTIONS)[number] | null;
  paybackMonths: (typeof PAYBACK_OPTIONS)[number] | null;
  furnished: GoalOption<'furnished'> | null;
}

export interface SourcerGoals {
  sourceFor: GoalOption<'sourceFor'> | null;
  sourcingFee: GoalOption<'sourcingFee'> | null;
  dealsPerMonth: GoalOption<'dealsPerMonth'> | null;
}

/** Batch 17: the BRRR answers. */
export interface BrrrGoals {
  /** "What's the most you'd pay for a project, before works?" (the buy budget's four bands). */
  budget: Exclude<Budget, 'any'> | null;
  work: GoalOption<'brrrWork'> | null;
}

export interface ManagerGoals {
  unitsManaged: GoalOption<'unitsManaged'> | null;
  /** Postcode areas the company already operates in. */
  operatingAreas: string[];
  lookingFor: GoalOption<'lookingFor'> | null;
  growthTarget: (typeof GROWTH_OPTIONS)[number] | null;
}

export interface MarketGoals {
  version: 2;
  home: { postcode: string; lat: number | null; lng: number | null } | null;
  maxDistanceMiles: MaxDistance | null; // null = anywhere
  budget: Exclude<Budget, 'any'> | null;
  bedrooms: 1 | 2 | 3 | 4 | null; // 4 = 4+
  priorities: { yield: Priority; revenue: Priority; lowCompetition: Priority; directBookings: Priority };
  management: Management;
  riskAppetite: RiskAppetite;
  finance: FinanceGoals;
  /** The listing kinds searched: sales (short-let purchases and BRRR), rentals (rent-to-rent) or both. Default sale. Batch 17: follows the deal types. */
  sourcingKind: SourcingKind;
  /** Rent-to-rent ceiling (£ pcm) for the daily pick's rent searches; null = no bound. */
  maxRentPcm: number | null;
  /** Whether to favour, or insist on, sellers and landlords who look ready to deal. */
  motivation: MotivationGoals;
  // ── Batch 12 ──
  /** The member's main path; null until the quiz's first question is answered. */
  path: ProfilePath | null;
  /** How "where should we look?" was answered; null until it is. */
  where: WhereMode | null;
  buyer: BuyerGoals;
  r2r: R2rGoals;
  sourcer: SourcerGoals;
  manager: ManagerGoals;
  // ── Batch 17 ──
  /** The deal types this profile wants to see; null until the question is answered (deal-types.ts maps older answers). */
  dealTypes: DealType[] | null;
  brrr: BrrrGoals;
}

export const DEFAULT_BUYER_GOALS: BuyerGoals = { cashAvailable: null, funding: null, entity: null, mainGoal: null, propertyType: null, condition: null, leaseholdOk: null, restrictedAreas: null };
export const DEFAULT_R2R_GOALS: R2rGoals = { minMarginPcm: null, setupBudget: null, dealStructure: null, breakEvenOccupancyPct: null, paybackMonths: null, furnished: null };
export const DEFAULT_SOURCER_GOALS: SourcerGoals = { sourceFor: null, sourcingFee: null, dealsPerMonth: null };
export const DEFAULT_MANAGER_GOALS: ManagerGoals = { unitsManaged: null, operatingAreas: [], lookingFor: null, growthTarget: null };
export const DEFAULT_BRRR_GOALS: BrrrGoals = { budget: null, work: null };

export const DEFAULT_GOALS: MarketGoals = {
  version: 2,
  home: null,
  maxDistanceMiles: null,
  budget: null,
  bedrooms: null,
  priorities: { yield: 2, revenue: 2, lowCompetition: 2, directBookings: 2 },
  management: 'managed',
  riskAppetite: 'balanced',
  finance: DEFAULT_FINANCE_GOALS,
  sourcingKind: 'sale',
  maxRentPcm: null,
  motivation: DEFAULT_MOTIVATION,
  path: null,
  where: null,
  buyer: DEFAULT_BUYER_GOALS,
  r2r: DEFAULT_R2R_GOALS,
  sourcer: DEFAULT_SOURCER_GOALS,
  manager: DEFAULT_MANAGER_GOALS,
  dealTypes: null,
  brrr: DEFAULT_BRRR_GOALS,
};

export const SOURCING_KIND_LABELS: Record<SourcingKind, string> = { sale: 'Properties to buy', rent: 'Properties to rent (rent-to-rent)', both: 'Both' };

export function isSourcingKind(v: unknown): v is SourcingKind {
  return v === 'sale' || v === 'rent' || v === 'both';
}

/** What a path searches for. A sourcer's kind follows who they source for (see sourcingKindFor). */
export const PATH_SOURCING_KIND: Record<ProfilePath, SourcingKind> = { buy: 'sale', r2r: 'rent', source: 'both', manage: 'sale' };

/** The daily search's kind for a path: a sourcer's follows who they source for once they say. */
export function sourcingKindFor(path: ProfilePath, sourceFor: SourcerGoals['sourceFor']): SourcingKind {
  if (path !== 'source') return PATH_SOURCING_KIND[path];
  if (sourceFor === 'buyers') return 'sale';
  if (sourceFor === 'r2r') return 'rent';
  return 'both';
}

export const PRIORITY_LABELS: Record<Priority, string> = { 0: 'Not important', 1: 'Nice to have', 2: 'Important', 3: 'Essential' };

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function normalisePostcode(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (v.length < 5 || v.length > 7) return null;
  const spaced = `${v.slice(0, -3)} ${v.slice(-3)}`;
  return UK_POSTCODE.test(spaced) ? spaced : null;
}

function financeField(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Tolerant parse: any missing or silly value falls back to the default. */
export function parseFinanceGoals(raw: unknown): FinanceGoals {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_FINANCE_GOALS;
  return {
    depositPct: financeField(f.depositPct, d.depositPct, 0, 100),
    mortgageRatePct: financeField(f.mortgageRatePct, d.mortgageRatePct, 0, 25),
    termYears: financeField(f.termYears, d.termYears, 1, 40),
    targetYieldPct: financeField(f.targetYieldPct, d.targetYieldPct, 1, 50),
    targetMarginPcm: financeField(f.targetMarginPcm, d.targetMarginPcm, 0, 20000),
  };
}

export const MAX_RENT_PCM_RANGE = { min: 200, max: 10_000 } as const;

/** A rent ceiling is only meaningful in a sane band; anything else means "no bound". */
export function parseMaxRentPcm(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[£,\s]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= MAX_RENT_PCM_RANGE.min && r <= MAX_RENT_PCM_RANGE.max ? r : null;
}

function priority(v: unknown): Priority | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : null;
}

const KNOWN_AREAS = new Set(AREA_META.map((a) => a.code));

/** Postcode area codes, validated, upper-cased, deduplicated, order kept. */
export function areaCodeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const code = v.trim().toUpperCase();
    if (KNOWN_AREAS.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** One of the allowed values for a GOAL_OPTIONS key, or null. */
export function goalOption<K extends keyof typeof GOAL_OPTIONS>(key: K, v: unknown): GoalOption<K> | null {
  return (GOAL_OPTIONS[key] as readonly string[]).includes(v as string) ? (v as GoalOption<K>) : null;
}

function numberOption<T extends number>(allowed: readonly T[], v: unknown): T | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return (allowed as readonly number[]).includes(n as number) ? (n as T) : null;
}

function obj(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
}

export function parseBuyerGoals(raw: unknown): BuyerGoals {
  const b = obj(raw);
  return {
    cashAvailable: goalOption('cashAvailable', b.cashAvailable),
    funding: goalOption('funding', b.funding),
    entity: goalOption('entity', b.entity),
    mainGoal: goalOption('mainGoal', b.mainGoal),
    propertyType: goalOption('propertyType', b.propertyType),
    condition: goalOption('condition', b.condition),
    leaseholdOk: goalOption('leaseholdOk', b.leaseholdOk),
    restrictedAreas: goalOption('restrictedAreas', b.restrictedAreas),
  };
}

export function parseR2rGoals(raw: unknown): R2rGoals {
  const r = obj(raw);
  const margin = r.minMarginPcm === null || r.minMarginPcm === undefined || r.minMarginPcm === '' ? Number.NaN : Number(r.minMarginPcm);
  return {
    minMarginPcm: Number.isFinite(margin) && margin >= 0 && margin <= 20000 ? margin : null,
    setupBudget: goalOption('setupBudget', r.setupBudget),
    dealStructure: goalOption('dealStructure', r.dealStructure),
    breakEvenOccupancyPct: numberOption(BREAK_EVEN_OPTIONS, r.breakEvenOccupancyPct),
    paybackMonths: numberOption(PAYBACK_OPTIONS, r.paybackMonths),
    furnished: goalOption('furnished', r.furnished),
  };
}

export function parseSourcerGoals(raw: unknown): SourcerGoals {
  const s = obj(raw);
  return { sourceFor: goalOption('sourceFor', s.sourceFor), sourcingFee: goalOption('sourcingFee', s.sourcingFee), dealsPerMonth: goalOption('dealsPerMonth', s.dealsPerMonth) };
}

/** The chosen deal types in the question's order, duplicates and unknowns dropped; null when none (never answered). */
/** The stored types: available ones only (a 'btl' cannot be held while it is coming soon), in the question's order. */
export function parseDealTypes(raw: unknown): DealType[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set(raw.filter((v) => (AVAILABLE_DEAL_TYPES as readonly unknown[]).includes(v)) as DealType[]);
  const out = GOAL_OPTIONS.dealTypes.filter((t) => set.has(t));
  return out.length > 0 ? out : null;
}

export function parseBrrrGoals(raw: unknown): BrrrGoals {
  const b = obj(raw);
  return { budget: isBudget(b.budget) && b.budget !== 'any' ? b.budget : null, work: goalOption('brrrWork', b.work) };
}

export function parseManagerGoals(raw: unknown): ManagerGoals {
  const m = obj(raw);
  return { unitsManaged: goalOption('unitsManaged', m.unitsManaged), operatingAreas: areaCodeList(m.operatingAreas), lookingFor: goalOption('lookingFor', m.lookingFor), growthTarget: numberOption(GROWTH_OPTIONS, m.growthTarget) };
}

/**
 * Strict parse of a stored/posted value. Returns null for anything unusable.
 * Version 1 (before Batch 12) and version 2 both read; the result is always
 * version 2, with the quiz's fields null where the stored value has none.
 */
export function parseMarketGoals(raw: unknown): MarketGoals | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;

  let home: MarketGoals['home'] = null;
  if (o.home && typeof o.home === 'object') {
    const h = o.home as Record<string, unknown>;
    const pc = typeof h.postcode === 'string' ? normalisePostcode(h.postcode) : null;
    if (pc) {
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      home = { postcode: pc, lat: num(h.lat), lng: num(h.lng) };
    }
  }

  const maxDistanceMiles = parseMaxDistance(o.maxDistanceMiles);
  const budget = isBudget(o.budget) && o.budget !== 'any' ? o.budget : null;
  const b = o.bedrooms;
  const bedrooms: MarketGoals['bedrooms'] = b === 1 || b === 2 || b === 3 || b === 4 ? b : null;

  const p = (o.priorities ?? {}) as Record<string, unknown>;
  const priorities = {
    yield: priority(p.yield) ?? 2,
    revenue: priority(p.revenue) ?? 2,
    lowCompetition: priority(p.lowCompetition) ?? 2,
    directBookings: priority(p.directBookings) ?? 2,
  };
  const management: Management = o.management === 'self' ? 'self' : 'managed';
  const riskAppetite: RiskAppetite = o.riskAppetite === 'cautious' || o.riskAppetite === 'tolerant' ? o.riskAppetite : 'balanced';

  const sourcingKind: SourcingKind = isSourcingKind(o.sourcingKind) ? o.sourcingKind : 'sale';
  const maxRentPcm = parseMaxRentPcm(o.maxRentPcm);

  return {
    version: 2,
    home,
    maxDistanceMiles,
    budget,
    bedrooms,
    priorities,
    management,
    riskAppetite,
    finance: parseFinanceGoals(o.finance),
    sourcingKind,
    maxRentPcm,
    motivation: parseMotivationGoals(o.motivation),
    path: goalOption('path', o.path),
    where: goalOption('where', o.where),
    buyer: parseBuyerGoals(o.buyer),
    r2r: parseR2rGoals(o.r2r),
    sourcer: parseSourcerGoals(o.sourcer),
    manager: parseManagerGoals(o.manager),
    dealTypes: parseDealTypes(o.dealTypes),
    brrr: parseBrrrGoals(o.brrr),
  };
}

/** Short chips describing the profile ("NG2 · ≤50 mi · £200k–£350k · 2-bed · Max yield"). */
export function describeGoals(g: MarketGoals): string[] {
  const out: string[] = [];
  if (g.home) out.push(g.maxDistanceMiles ? `≤${g.maxDistanceMiles} mi of ${g.home.postcode.split(' ')[0]}` : `Near ${g.home.postcode.split(' ')[0]}`);
  if (g.budget) out.push(BUDGET_LABELS[g.budget]);
  if (g.bedrooms) out.push(g.bedrooms === 4 ? '4+ bed' : `${g.bedrooms}-bed`);
  if (g.sourcingKind !== 'sale' && g.maxRentPcm) out.push(`≤ £${g.maxRentPcm.toLocaleString('en-GB')} pcm`);
  if (g.motivation.mode !== 'off') {
    const how = g.motivation.mode === 'only' ? 'Motivated only' : 'Prefer motivated';
    const how_long = g.sourcingKind === 'rent' ? `${g.motivation.minWeeksOnMarket}+ wk listed` : `${g.motivation.minMonthsOnMarket}+ mo listed`;
    out.push(`${how} · ${how_long}`);
  }
  const top = (Object.entries(g.priorities) as [keyof MarketGoals['priorities'], Priority][]).filter(([, v]) => v === 3);
  const names: Record<keyof MarketGoals['priorities'], string> = { yield: 'Max yield', revenue: 'Max revenue', lowCompetition: 'Low competition', directBookings: 'Direct bookings' };
  for (const [k] of top) out.push(names[k]);
  out.push(g.management === 'self' ? 'Self-managed' : 'Managed');
  return out;
}
