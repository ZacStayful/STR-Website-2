/**
 * Batch 16's business numbers in one place: the comparables search each deal
 * check makes, the confidence bands its spread maps to, and the daily checks'
 * limits. Each group is one billing_settings row (a JSON object) with the
 * decided defaults and bounds here, so a missing or bad row, or a bad field
 * in it, falls back to the decided value rather than switching a job off or
 * letting it run wild. Seeded by the "Batch 16" section of supabase/schema.sql.
 *
 * Pure: no network, no database, no server-only.
 */

export const DEAL_COMPS_KEY = 'deal_comps';
export const DEAL_CONFIDENCE_KEY = 'deal_confidence';
export const DEAL_CHECKS_KEY = 'deal_checks';
export const LOW_ENTRY_KEY = 'low_entry';

export interface SettingFilter {
  /** Only a search that had to reach at least this far is filtered. */
  minRadiusKm: number;
  /** How close another similar listing must be to count as a neighbour. */
  neighbourKm: number;
  /** A comparable with this many times the subject's neighbours (plus one) sits in a town the subject is not in. */
  ratio: number;
  /** …and with at least this many neighbours. */
  minCluster: number;
}

export interface DealCompsSettings {
  /** Similar comparables wanted before the search stops widening. */
  targetCount: number;
  /** Search radii, km, smallest first. */
  radiiKm: number[];
  /** Never search further than this. */
  maxRadiusKm: number;
  /** Fewer similar comparables than this within the max radius: insufficient data, the deal is not shown. */
  minComps: number;
  setting: SettingFilter;
}

export interface DealConfidenceSettings {
  /** Middle half of the comparables' revenue within ± this % of their median: high. */
  highPct: number;
  /** …within ± this %: medium. Wider: low. */
  mediumPct: number;
  /** With this many comparables or fewer, confidence is at most medium. */
  mediumMaxComps: number;
}

export interface DealChecksSettings {
  /** Paid checks a UK day. */
  perDay: number;
  /** Provider spend on checks a UK day, raw pence. */
  dailyCapPence: number;
  /** Check slots a day by stream; spare slots pass to the other streams in this order. */
  split: { top60: number; low_entry: number; r2r: number };
  /** Airbtics calls one check may make. */
  maxCallsPerCheck: number;
  /** A check's income stays good for re-screening a repriced or revived deal this many days. */
  validDays: number;
  /** A shortlisted listing not checked within this many days is dropped. */
  shortlistExpiryDays: number;
  /** Hard ceiling for the one-off re-check of today's live deals, raw pence. */
  recheckCeilingPence: number;
}

export const DEFAULT_DEAL_COMPS: DealCompsSettings = {
  targetCount: 12,
  radiiKm: [0.8, 2, 5, 12, 25],
  maxRadiusKm: 25,
  minComps: 5,
  setting: { minRadiusKm: 5, neighbourKm: 1.5, ratio: 3, minCluster: 3 },
};

export const DEFAULT_DEAL_CONFIDENCE: DealConfidenceSettings = {
  highPct: 20,
  mediumPct: 40,
  mediumMaxComps: 7,
};

export const DEFAULT_DEAL_CHECKS: DealChecksSettings = {
  perDay: 20,
  dailyCapPence: 100,
  split: { top60: 6, low_entry: 8, r2r: 6 },
  maxCallsPerCheck: 3,
  validDays: 180,
  shortlistExpiryDays: 7,
  recheckCeilingPence: 1200,
};

/**
 * The low-entry stream (Part F): a sale the house deal model (25% deposit,
 * the nation's additional-property tax, £6,000 + £3,500 a bedroom of
 * setup) gets into for at most `maxCashIn`, and the nationwide search that
 * feeds it. £135,000 is the widest asking price any size clears £50,000 in
 * England (a 1-bed: 25% deposit £33,750 + SDLT £6,950 + setup £9,500); a
 * 4-bed clears it up to £100,000, a Scottish 1-bed up to £122,000 (the 8%
 * ADS). The search cap is only the provider-side sieve: the deal model makes
 * the exact test on every listing, auction lots at their auction price.
 */
export interface LowEntrySettings {
  /** A sale is low entry when the house deal model needs at most this much cash in, £. */
  maxCashIn: number;
  /** The nationwide search asks for sale listings up to this asking price, £. */
  searchMaxPrice: number;
  /** …with at least this many bedrooms (a studio has no comparables search). */
  minBedrooms: number;
  /** Provider spend on the nationwide search a UK week (Monday to Sunday), raw pence. */
  weeklyCapPence: number;
  /** Areas one cron pass searches: PMI paces listings calls ~5 s apart and a pass has ~44 s. */
  areasPerPass: number;
}

export const DEFAULT_LOW_ENTRY: LowEntrySettings = {
  maxCashIn: 50_000,
  searchMaxPrice: 135_000,
  minBedrooms: 1,
  weeklyCapPence: 400,
  areasPerPass: 8,
};

interface Bound {
  min: number;
  max: number;
  whole: boolean;
}

function inBounds(raw: unknown, b: Bound): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  if (b.whole && !Number.isInteger(n)) return null;
  return n >= b.min && n <= b.max ? n : null;
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return asObject(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function pick<T extends object>(defaults: T, raw: Record<string, unknown>, bounds: { [K in keyof T]?: Bound }): T {
  const out = { ...defaults };
  for (const [field, b] of Object.entries(bounds) as [keyof T, Bound][]) {
    const v = inBounds(raw[field as string], b);
    if (v !== null) (out as Record<keyof T, unknown>)[field] = v;
  }
  return out;
}

/** Radii: ascending, positive, at most ten; anything else keeps the default ladder. */
function parseRadii(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) return [...fallback];
  const list = raw.map((r) => inBounds(r, { min: 0.1, max: 50, whole: false }));
  if (list.some((r) => r === null)) return [...fallback];
  const nums = list as number[];
  for (let i = 1; i < nums.length; i++) if (nums[i] <= nums[i - 1]) return [...fallback];
  return nums;
}

export function parseDealComps(raw: unknown): DealCompsSettings {
  const o = asObject(raw);
  const base = pick(DEFAULT_DEAL_COMPS, o, {
    targetCount: { min: 5, max: 40, whole: true },
    maxRadiusKm: { min: 0.5, max: 50, whole: false },
    minComps: { min: 3, max: 20, whole: true },
  });
  const radiiKm = parseRadii(o.radiiKm, DEFAULT_DEAL_COMPS.radiiKm).filter((r) => r <= base.maxRadiusKm);
  const setting = pick(DEFAULT_DEAL_COMPS.setting, asObject(o.setting), {
    minRadiusKm: { min: 0, max: 50, whole: false },
    neighbourKm: { min: 0.2, max: 10, whole: false },
    ratio: { min: 1, max: 20, whole: false },
    minCluster: { min: 1, max: 50, whole: true },
  });
  const minComps = Math.min(base.minComps, base.targetCount);
  return { ...base, minComps, radiiKm: radiiKm.length > 0 ? radiiKm : [base.maxRadiusKm], setting };
}

export function parseDealConfidence(raw: unknown): DealConfidenceSettings {
  const out = pick(DEFAULT_DEAL_CONFIDENCE, asObject(raw), {
    highPct: { min: 1, max: 100, whole: false },
    mediumPct: { min: 1, max: 200, whole: false },
    mediumMaxComps: { min: 0, max: 40, whole: true },
  });
  // Medium can never be tighter than high.
  return out.mediumPct < out.highPct ? { ...out, mediumPct: out.highPct } : out;
}

export function parseDealChecks(raw: unknown): DealChecksSettings {
  const o = asObject(raw);
  const base = pick(DEFAULT_DEAL_CHECKS, o, {
    perDay: { min: 0, max: 500, whole: true },
    dailyCapPence: { min: 0, max: 100_000, whole: true },
    maxCallsPerCheck: { min: 1, max: 10, whole: true },
    validDays: { min: 1, max: 730, whole: true },
    shortlistExpiryDays: { min: 1, max: 60, whole: true },
    recheckCeilingPence: { min: 0, max: 100_000, whole: true },
  });
  const split = pick(DEFAULT_DEAL_CHECKS.split, asObject(o.split), {
    top60: { min: 0, max: 500, whole: true },
    low_entry: { min: 0, max: 500, whole: true },
    r2r: { min: 0, max: 500, whole: true },
  });
  return { ...base, split };
}

export function parseLowEntry(raw: unknown): LowEntrySettings {
  return pick(DEFAULT_LOW_ENTRY, asObject(raw), {
    maxCashIn: { min: 0, max: 1_000_000, whole: true },
    searchMaxPrice: { min: 10_000, max: 2_000_000, whole: true },
    minBedrooms: { min: 0, max: 6, whole: true },
    weeklyCapPence: { min: 0, max: 100_000, whole: true },
    areasPerPass: { min: 1, max: 30, whole: true },
  });
}
