/**
 * The Market Explorer goal profile ("what are you looking for?"), stored on
 * profiles.market_goals. Every field is optional in spirit: null means "no
 * preference", and the personalised score simply drops the corresponding
 * component. Parsing is strict so a corrupted or hand-edited value can never
 * crash the explorer — it just falls back to no goals.
 */

import { isBudget, type Budget } from './filters.ts';

export type Priority = 0 | 1 | 2 | 3; // not important → essential
export type MaxDistance = 25 | 50 | 100;
export type Management = 'self' | 'managed';
export type RiskAppetite = 'cautious' | 'balanced' | 'tolerant';

/** Finance defaults used by the deal maths on any listing the member checks. */
export interface FinanceGoals {
  depositPct: number; // 25
  mortgageRatePct: number; // 5.5
  termYears: number; // 25
  targetYieldPct: number; // 10
  targetMarginPcm: number; // 500
}

export const DEFAULT_FINANCE_GOALS: FinanceGoals = { depositPct: 25, mortgageRatePct: 5.5, termYears: 25, targetYieldPct: 10, targetMarginPcm: 500 };

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

export interface MarketGoals {
  version: 1;
  home: { postcode: string; lat: number | null; lng: number | null } | null;
  maxDistanceMiles: MaxDistance | null; // null = anywhere
  budget: Exclude<Budget, 'any'> | null;
  bedrooms: 1 | 2 | 3 | 4 | null; // 4 = 4+
  priorities: { yield: Priority; revenue: Priority; lowCompetition: Priority; directBookings: Priority };
  management: Management;
  riskAppetite: RiskAppetite;
  finance: FinanceGoals;
  /** Buy-to-let (sale), rent-to-rent (rent) or both. Default sale. */
  sourcingKind: SourcingKind;
  /** Rent-to-rent ceiling (£ pcm) for the daily pick's rent searches; null = no bound. */
  maxRentPcm: number | null;
  /** Whether to favour, or insist on, sellers and landlords who look ready to deal. */
  motivation: MotivationGoals;
}

export const DEFAULT_GOALS: MarketGoals = {
  version: 1,
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
};

export const SOURCING_KIND_LABELS: Record<SourcingKind, string> = { sale: 'Properties to buy', rent: 'Properties to rent (rent-to-rent)', both: 'Both' };

export function isSourcingKind(v: unknown): v is SourcingKind {
  return v === 'sale' || v === 'rent' || v === 'both';
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

/** Strict parse of a stored/posted value. Returns null for anything unusable. */
export function parseMarketGoals(raw: unknown): MarketGoals | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;

  let home: MarketGoals['home'] = null;
  if (o.home && typeof o.home === 'object') {
    const h = o.home as Record<string, unknown>;
    const pc = typeof h.postcode === 'string' ? normalisePostcode(h.postcode) : null;
    if (pc) {
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      home = { postcode: pc, lat: num(h.lat), lng: num(h.lng) };
    }
  }

  const md = o.maxDistanceMiles;
  const maxDistanceMiles: MaxDistance | null = md === 25 || md === 50 || md === 100 ? md : null;
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

  return { version: 1, home, maxDistanceMiles, budget, bedrooms, priorities, management, riskAppetite, finance: parseFinanceGoals(o.finance), sourcingKind, maxRentPcm, motivation: parseMotivationGoals(o.motivation) };
}

/** Build goals from the questionnaire form (FormData-like getter). */
export function goalsFromForm(get: (key: string) => string | null): MarketGoals {
  const postcode = get('postcode') ?? '';
  const pc = normalisePostcode(postcode);
  const md = Number(get('maxDistanceMiles'));
  const bedsRaw = Number(get('bedrooms'));
  return parseMarketGoals({
    version: 1,
    home: pc ? { postcode: pc, lat: null, lng: null } : null,
    maxDistanceMiles: md === 25 || md === 50 || md === 100 ? md : null,
    budget: get('budget') ?? null,
    bedrooms: [1, 2, 3, 4].includes(bedsRaw) ? bedsRaw : null,
    priorities: {
      yield: get('p_yield'),
      revenue: get('p_revenue'),
      lowCompetition: get('p_lowCompetition'),
      directBookings: get('p_directBookings'),
    },
    management: get('management'),
    riskAppetite: get('riskAppetite'),
    finance: {
      depositPct: get('f_depositPct'),
      mortgageRatePct: get('f_mortgageRatePct'),
      termYears: get('f_termYears'),
      targetYieldPct: get('f_targetYieldPct'),
      targetMarginPcm: get('f_targetMarginPcm'),
    },
    sourcingKind: get('sourcingKind'),
    maxRentPcm: get('maxRentPcm'),
    motivation: {
      mode: get('m_mode'),
      minMonthsOnMarket: get('m_minMonths'),
      minWeeksOnMarket: get('m_minWeeks'),
      // An unchecked box posts nothing, so absent means off here — unlike a
      // stored profile, where absent means the field predates the feature.
      areaRelative: get('m_areaRelative') === '1',
    },
  })!;
}

/** Short chips describing the profile ("NG2 · ≤50 mi · £200k–£350k · 2-bed · Max yield"). */
export function describeGoals(g: MarketGoals): string[] {
  const out: string[] = [];
  if (g.home) out.push(g.maxDistanceMiles ? `≤${g.maxDistanceMiles} mi of ${g.home.postcode.split(' ')[0]}` : `Near ${g.home.postcode.split(' ')[0]}`);
  if (g.budget) out.push({ u200: 'Under £200k', '200-350': '£200k–£350k', '350-500': '£350k–£500k', '500+': '£500k+' }[g.budget]);
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

/** What the welcome questions (/welcome) ask; everything else keeps its default. */
export interface WelcomeGoalInput {
  kind: SourcingKind;
  budget: Exclude<Budget, 'any'> | null;
  maxRentPcm: number | null;
  /** Normalised home postcode, or null when the member chose areas or anywhere. */
  postcode: string | null;
  maxDistanceMiles: MaxDistance | null;
}

/**
 * Goals from the welcome answers. Fields the screen does not ask about keep
 * `base` (the defaults for a new member). A budget is only kept when the
 * member buys, a rent ceiling only when they rent, and a radius only with a
 * home — so the stored profile never carries a bound nothing reads.
 */
export function goalsFromWelcome(a: WelcomeGoalInput, base: MarketGoals = DEFAULT_GOALS): MarketGoals {
  return parseMarketGoals({
    ...base,
    sourcingKind: a.kind,
    budget: a.kind === 'rent' ? null : a.budget,
    maxRentPcm: a.kind === 'sale' ? null : a.maxRentPcm,
    home: a.postcode ? { postcode: a.postcode, lat: null, lng: null } : null,
    maxDistanceMiles: a.postcode ? a.maxDistanceMiles : null,
  })!;
}
