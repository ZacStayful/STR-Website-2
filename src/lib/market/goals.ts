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
};

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

  return { version: 1, home, maxDistanceMiles, budget, bedrooms, priorities, management, riskAppetite, finance: parseFinanceGoals(o.finance) };
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
  })!;
}

/** Short chips describing the profile ("NG2 · ≤50 mi · £200k–£350k · 2-bed · Max yield"). */
export function describeGoals(g: MarketGoals): string[] {
  const out: string[] = [];
  if (g.home) out.push(g.maxDistanceMiles ? `≤${g.maxDistanceMiles} mi of ${g.home.postcode.split(' ')[0]}` : `Near ${g.home.postcode.split(' ')[0]}`);
  if (g.budget) out.push({ u200: 'Under £200k', '200-350': '£200k–£350k', '350-500': '£350k–£500k', '500+': '£500k+' }[g.budget]);
  if (g.bedrooms) out.push(g.bedrooms === 4 ? '4+ bed' : `${g.bedrooms}-bed`);
  const top = (Object.entries(g.priorities) as [keyof MarketGoals['priorities'], Priority][]).filter(([, v]) => v === 3);
  const names: Record<keyof MarketGoals['priorities'], string> = { yield: 'Max yield', revenue: 'Max revenue', lowCompetition: 'Low competition', directBookings: 'Direct bookings' };
  for (const [k] of top) out.push(names[k]);
  out.push(g.management === 'self' ? 'Self-managed' : 'Managed');
  return out;
}
