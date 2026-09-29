/**
 * Batch 17's business numbers in one place: the refurb rates from Zac's BRRR
 * guide (28 Sep 2026, VAT included), how quantities follow a property's size,
 * the value-after-works rule and its thresholds, the sold-price ceiling, the
 * buying and holding costs, and the photo checks' limits. Each group is one
 * billing_settings row (a JSON object) with the decided defaults and bounds
 * here, so a missing or bad row, or a bad field in it, falls back to the
 * decided value instead of switching a job off or letting it run wild.
 * Seeded by the "Batch 17: project deals" section of supabase/schema.sql.
 *
 * Pure: no network, no database, no server-only.
 */

export const PROJECT_RATES_KEY = 'project_rates';
export const PROJECT_QUANTITIES_KEY = 'project_quantities';
export const PROJECT_VALUE_KEY = 'project_value';
export const PROJECT_CEILING_KEY = 'project_ceiling';
export const PROJECT_COSTS_KEY = 'project_costs';
export const PROJECT_CHECKS_KEY = 'project_checks';

export type KitchenSize = 'small' | 'big' | 'extra_big';

/** The costing table (Part D). Every figure is £ including VAT. */
export interface ProjectRates {
  /** Waste removal, a job. */
  waste: number;
  /** A full rewire of the baseline size (a 3-bed: 5 rooms or 900 sq ft), scaled by size. */
  rewire: number;
  boiler: number;
  /** Each. */
  radiator: number;
  waterTank: number;
  /** Bathroom pipework and drainage. */
  pipework: number;
  /** A new bathroom, each. */
  bathroom: number;
  /** Per room. */
  plaster: number;
  /** Skirting and architraves, per room. */
  skirting: number;
  /** Per room. */
  paint: number;
  /** A kitchen, times the size factor. */
  kitchen: number;
  kitchenFactors: Record<KitchenSize, number>;
  /** Per room. */
  carpet: number;
  roof: number;
  /** UPVC windows, each. */
  window: number;
  /** UPVC outside doors, each. */
  outsideDoor: number;
  /** Each. */
  internalDoor: number;
  /** Damp proofing, per wall. */
  damp: number;
  /** On both ends of the works range, %. */
  contingencyPct: number;
}

export const DEFAULT_PROJECT_RATES: ProjectRates = {
  waste: 300,
  rewire: 4_500,
  boiler: 2_500,
  radiator: 300,
  waterTank: 2_500,
  pipework: 500,
  bathroom: 2_000,
  plaster: 500,
  skirting: 650,
  paint: 350,
  kitchen: 4_000,
  kitchenFactors: { small: 1, big: 1.5, extra_big: 2 },
  carpet: 250,
  roof: 3_000,
  window: 400,
  outsideDoor: 600,
  internalDoor: 300,
  damp: 350,
  contingencyPct: 10,
};

/**
 * Quantities from the bedroom count (decided, Q5): rooms = bedrooms + 2 (a
 * living room and a kitchen); radiators = rooms + bathrooms; carpets =
 * bedrooms + 1 (the kitchen and bathroom are not carpeted); windows = rooms
 * + 1; two outside doors on a house, one on a flat; four damp walls on a
 * house, two on a flat; no roof on a flat. The rewire scales with rooms
 * against a 5-room house, or with floor area against 900 sq ft when the
 * listing states it. Photos can only lower a quantity.
 */
export interface ProjectQuantities {
  roomsPlusBedrooms: number;
  carpetsPlusBedrooms: number;
  windowsPlusRooms: number;
  outsideDoorsHouse: number;
  outsideDoorsFlat: number;
  dampWallsHouse: number;
  dampWallsFlat: number;
  /** The listing's bathroom count when it gives none. */
  defaultBathrooms: number;
  rewireBaselineRooms: number;
  rewireBaselineSqft: number;
}

export const DEFAULT_PROJECT_QUANTITIES: ProjectQuantities = {
  roomsPlusBedrooms: 2,
  carpetsPlusBedrooms: 1,
  windowsPlusRooms: 1,
  outsideDoorsHouse: 2,
  outsideDoorsFlat: 1,
  dampWallsHouse: 4,
  dampWallsFlat: 2,
  defaultBathrooms: 1,
  rewireBaselineRooms: 5,
  rewireBaselineSqft: 900,
};

/**
 * What counts as a Project deal (Part E, rule B decided 29 Sep):
 *   value after works = the lower of (a) price + 2 × visible works + 1 ×
 *   hidden fixes, and the sold-price ceiling;
 *   value added = value after works − (price + works at the high end);
 *   a Project deal adds at least £15,000 AND at least 10% of the value.
 * After the works a full project is refinanced at 75% of the value.
 */
export interface ProjectValueSettings {
  visibleMultiplier: number;
  hiddenMultiplier: number;
  minUplift: number;
  minUpliftPctOfValue: number;
  refinancePct: number;
}

export const DEFAULT_PROJECT_VALUE: ProjectValueSettings = {
  visibleMultiplier: 2,
  hiddenMultiplier: 1,
  minUplift: 15_000,
  minUpliftPctOfValue: 10,
  refinancePct: 75,
};

/**
 * The ceiling (Part E, decided): same property type and bedrooms, sold in
 * the last 24 months, from 0.5 miles out, widening to 3 miles until there
 * are about 10 sales (at least 5); nearer sales weigh more (1 / 0.75 / 0.5 /
 * 0.25 by band, Q6); the weighted 75th percentile. With fewer than 5 sales of
 * the same bedrooms, the same type at any size (Q7).
 */
export interface ProjectCeilingSettings {
  /** Search radii, miles, smallest first; also the weight bands. */
  radiiMiles: number[];
  /** A sale's weight by the first band it falls in, same length as radiiMiles. */
  weights: number[];
  months: number;
  targetSales: number;
  minSales: number;
  /** 0.75 = the top quarter starts here. */
  quantile: number;
}

export const DEFAULT_PROJECT_CEILING: ProjectCeilingSettings = {
  radiiMiles: [0.5, 1, 2, 3],
  weights: [1, 0.75, 0.5, 0.25],
  months: 24,
  targetSales: 10,
  minSales: 5,
  quantile: 0.75,
};

/**
 * Buying, time and holding (Part E2, decided; Q4 and Q8 on 29 Sep):
 *   buying costs £2,500, or £3,500 bought with bridging;
 *   works time 2 months for a light refresh, 4 for a full project of up to
 *   3 bedrooms, 6 from 4;
 *   a full project is bridged on Batch 16's auction_model terms: the bridge
 *   lends on the price only (the works are paid in cash), the arrangement
 *   fee counts, the bridge's own legal and valuation does not (the £3,500
 *   buying costs cover it);
 *   the photos' rating decides light or full, overridden by the clearly
 *   needed works: above £15,000 is a full project whatever the photos say,
 *   below £5,000 a full rating is a light refresh.
 */
export interface ProjectCostsSettings {
  buyingCosts: number;
  buyingCostsBridging: number;
  monthsLight: number;
  monthsFull: number;
  monthsFullLarge: number;
  largeFromBedrooms: number;
  /** Share of the works the bridge lends, %. 0 = paid in cash. */
  bridgeWorksPct: number;
  arrangementFee: boolean;
  legalAndValuation: boolean;
  fullAboveWorks: number;
  lightBelowWorks: number;
}

export const DEFAULT_PROJECT_COSTS: ProjectCostsSettings = {
  buyingCosts: 2_500,
  buyingCostsBridging: 3_500,
  monthsLight: 2,
  monthsFull: 4,
  monthsFullLarge: 6,
  largeFromBedrooms: 4,
  bridgeWorksPct: 0,
  arrangementFee: true,
  legalAndValuation: false,
  fullAboveWorks: 15_000,
  lightBelowWorks: 5_000,
};

/**
 * The checks' limits. The photo-check allowance and its spend line live in
 * Batch 16's deal_checks row (projectPhotoChecks, projectCapPence) so they
 * sit beside its cap on /admin/deals; everything else is here. `enabled`
 * is the entry hold's switch: off, nothing is held back and nothing is
 * checked (the dry runs still work).
 */
export interface ProjectChecksSettings {
  enabled: boolean;
  /** PropertyData sold-price lookups a UK day. */
  soldLookupsPerDay: number;
  /** Days a candidate may fail its check (model down, answer invalid) before it expires. */
  giveUpDays: number;
  /** Photos sent to the check, at most. */
  maxPhotos: number;
  /** A checked listing is reused this many days while its price and photos are unchanged. */
  reuseDays: number;
  /** PropertyData's listed-building and conservation-area checks before the photo check (Q9). */
  planningChecks: boolean;
  /** The photo check's thinking effort (Opus 5.5 always thinks). */
  effort: 'low' | 'medium' | 'high';
}

export const DEFAULT_PROJECT_CHECKS: ProjectChecksSettings = {
  enabled: false,
  soldLookupsPerDay: 15,
  giveUpDays: 3,
  maxPhotos: 10,
  reuseDays: 60,
  planningChecks: true,
  effort: 'medium',
};

/** The photo check's own line inside Batch 16's deal_checks row. */
export interface ProjectAllowance {
  /** Photo checks a UK day. */
  photoChecks: number;
  /** Batch 17's provider spend a UK day (photo checks, sold prices, planning checks), raw pence. */
  capPence: number;
}

export const DEFAULT_PROJECT_ALLOWANCE: ProjectAllowance = { photoChecks: 5, capPence: 150 };

export interface ProjectSettings {
  rates: ProjectRates;
  quantities: ProjectQuantities;
  value: ProjectValueSettings;
  ceiling: ProjectCeilingSettings;
  costs: ProjectCostsSettings;
  checks: ProjectChecksSettings;
  allowance: ProjectAllowance;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  rates: DEFAULT_PROJECT_RATES,
  quantities: DEFAULT_PROJECT_QUANTITIES,
  value: DEFAULT_PROJECT_VALUE,
  ceiling: DEFAULT_PROJECT_CEILING,
  costs: DEFAULT_PROJECT_COSTS,
  checks: DEFAULT_PROJECT_CHECKS,
  allowance: DEFAULT_PROJECT_ALLOWANCE,
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

function bool(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return fallback;
}

const POUNDS: Bound = { min: 0, max: 100_000, whole: false };

export function parseProjectRates(raw: unknown): ProjectRates {
  const o = asObject(raw);
  const base = pick(DEFAULT_PROJECT_RATES, o, {
    waste: POUNDS,
    rewire: POUNDS,
    boiler: POUNDS,
    radiator: POUNDS,
    waterTank: POUNDS,
    pipework: POUNDS,
    bathroom: POUNDS,
    plaster: POUNDS,
    skirting: POUNDS,
    paint: POUNDS,
    kitchen: POUNDS,
    carpet: POUNDS,
    roof: POUNDS,
    window: POUNDS,
    outsideDoor: POUNDS,
    internalDoor: POUNDS,
    damp: POUNDS,
    contingencyPct: { min: 0, max: 50, whole: false },
  });
  const kitchenFactors = pick(DEFAULT_PROJECT_RATES.kitchenFactors, asObject(o.kitchenFactors), {
    small: { min: 0, max: 5, whole: false },
    big: { min: 0, max: 5, whole: false },
    extra_big: { min: 0, max: 5, whole: false },
  });
  return { ...base, kitchenFactors };
}

export function parseProjectQuantities(raw: unknown): ProjectQuantities {
  const small: Bound = { min: 0, max: 10, whole: true };
  return pick(DEFAULT_PROJECT_QUANTITIES, asObject(raw), {
    roomsPlusBedrooms: small,
    carpetsPlusBedrooms: small,
    windowsPlusRooms: small,
    outsideDoorsHouse: small,
    outsideDoorsFlat: small,
    dampWallsHouse: small,
    dampWallsFlat: small,
    defaultBathrooms: { min: 1, max: 5, whole: true },
    rewireBaselineRooms: { min: 1, max: 20, whole: true },
    rewireBaselineSqft: { min: 100, max: 10_000, whole: false },
  });
}

export function parseProjectValue(raw: unknown): ProjectValueSettings {
  return pick(DEFAULT_PROJECT_VALUE, asObject(raw), {
    visibleMultiplier: { min: 0, max: 5, whole: false },
    hiddenMultiplier: { min: 0, max: 5, whole: false },
    minUplift: { min: 0, max: 1_000_000, whole: false },
    minUpliftPctOfValue: { min: 0, max: 100, whole: false },
    refinancePct: { min: 0, max: 100, whole: false },
  });
}

/** Radii ascending and positive, weights one per radius in (0, 1]; anything else keeps both defaults. */
export function parseProjectCeiling(raw: unknown): ProjectCeilingSettings {
  const o = asObject(raw);
  const base = pick(DEFAULT_PROJECT_CEILING, o, {
    months: { min: 3, max: 84, whole: true },
    targetSales: { min: 1, max: 100, whole: true },
    minSales: { min: 1, max: 100, whole: true },
    quantile: { min: 0, max: 1, whole: false },
  });
  let radiiMiles = [...DEFAULT_PROJECT_CEILING.radiiMiles];
  let weights = [...DEFAULT_PROJECT_CEILING.weights];
  if (Array.isArray(o.radiiMiles) && Array.isArray(o.weights) && o.radiiMiles.length > 0 && o.radiiMiles.length <= 10 && o.radiiMiles.length === o.weights.length) {
    const r = o.radiiMiles.map((v) => inBounds(v, { min: 0.05, max: 10, whole: false }));
    const w = o.weights.map((v) => inBounds(v, { min: 0.01, max: 1, whole: false }));
    const ascending = r.every((v, i) => v !== null && (i === 0 || v > (r[i - 1] as number)));
    if (ascending && w.every((v) => v !== null)) {
      radiiMiles = r as number[];
      weights = w as number[];
    }
  }
  return { ...base, minSales: Math.min(base.minSales, base.targetSales), radiiMiles, weights };
}

export function parseProjectCosts(raw: unknown): ProjectCostsSettings {
  const o = asObject(raw);
  const months: Bound = { min: 1, max: 24, whole: true };
  const base = pick(DEFAULT_PROJECT_COSTS, o, {
    buyingCosts: POUNDS,
    buyingCostsBridging: POUNDS,
    monthsLight: months,
    monthsFull: months,
    monthsFullLarge: months,
    largeFromBedrooms: { min: 1, max: 10, whole: true },
    bridgeWorksPct: { min: 0, max: 100, whole: false },
    fullAboveWorks: { min: 0, max: 1_000_000, whole: false },
    lightBelowWorks: { min: 0, max: 1_000_000, whole: false },
  });
  const out = { ...base, arrangementFee: bool(o.arrangementFee, DEFAULT_PROJECT_COSTS.arrangementFee), legalAndValuation: bool(o.legalAndValuation, DEFAULT_PROJECT_COSTS.legalAndValuation) };
  // The light line can never sit above the full one.
  return out.lightBelowWorks > out.fullAboveWorks ? { ...out, lightBelowWorks: out.fullAboveWorks } : out;
}

export function parseProjectChecks(raw: unknown): ProjectChecksSettings {
  const o = asObject(raw);
  const base = pick(DEFAULT_PROJECT_CHECKS, o, {
    soldLookupsPerDay: { min: 0, max: 200, whole: true },
    giveUpDays: { min: 1, max: 30, whole: true },
    maxPhotos: { min: 1, max: 20, whole: true },
    reuseDays: { min: 0, max: 365, whole: true },
  });
  const effort = o.effort === 'low' || o.effort === 'medium' || o.effort === 'high' ? o.effort : DEFAULT_PROJECT_CHECKS.effort;
  return { ...base, effort, enabled: bool(o.enabled, DEFAULT_PROJECT_CHECKS.enabled), planningChecks: bool(o.planningChecks, DEFAULT_PROJECT_CHECKS.planningChecks) };
}

/** Batch 17's fields inside Batch 16's deal_checks row. */
export function parseProjectAllowance(dealChecksRaw: unknown): ProjectAllowance {
  const o = asObject(dealChecksRaw);
  return {
    photoChecks: inBounds(o.projectPhotoChecks, { min: 0, max: 100, whole: true }) ?? DEFAULT_PROJECT_ALLOWANCE.photoChecks,
    capPence: inBounds(o.projectCapPence, { min: 0, max: 100_000, whole: true }) ?? DEFAULT_PROJECT_ALLOWANCE.capPence,
  };
}

/** Every Batch 17 setting from the stored rows (missing rows read as defaults). */
export function parseProjectSettings(rows: Partial<Record<string, unknown>>, dealChecksRaw?: unknown): ProjectSettings {
  return {
    rates: parseProjectRates(rows[PROJECT_RATES_KEY]),
    quantities: parseProjectQuantities(rows[PROJECT_QUANTITIES_KEY]),
    value: parseProjectValue(rows[PROJECT_VALUE_KEY]),
    ceiling: parseProjectCeiling(rows[PROJECT_CEILING_KEY]),
    costs: parseProjectCosts(rows[PROJECT_COSTS_KEY]),
    checks: parseProjectChecks(rows[PROJECT_CHECKS_KEY]),
    allowance: parseProjectAllowance(dealChecksRaw),
  };
}
