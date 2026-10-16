/**
 * Batch 28's business numbers for buy-to-let (long-term tenants) in one
 * place: the finance and the lender rent test, the running costs, how a rent
 * range is built, flats' service charge, the EPC allowances, the cash bands,
 * the benchmark's widening steps, the standout bar and the listing rules.
 * Each group is one billing_settings row (a JSON object) with the decided
 * defaults and bounds here, so a missing or bad row, or a bad field in it,
 * falls back to the decided value instead of switching a job off or letting
 * it run wild. Seeded by the "Batch 28: buy-to-let" section of
 * supabase/schema.sql. The £2,500 buying costs are Batch 17's
 * (project_costs.buyingCosts) and are passed in, never repeated here.
 *
 * Decided by Zac (29 Sep and 16 Oct 2026): 75% interest-only at the live
 * 2–3-year fixed rate; rent ≥ 125% of the interest at the higher of the live
 * rate + 2% or 5.5%; letting agent 12% incl. VAT, repairs 8%, one empty month
 * a year, insurance £25 a month, safety certificates £300 a year; EPC
 * allowance D £5,000, E–G £10,000; the four cash bands; the 10/25/50 mile,
 * region, national widening to 30 deals; standout at 125% of the median,
 * plus a 6% low-end ROI floor and no standout on a median of 0% or less.
 *
 * Pure: no network, no database, no server-only.
 */

export const BTL_REPORT_PENCE_KEY = 'btl_report_pence';
export const BTL_FINANCE_KEY = 'btl_finance';
export const BTL_COSTS_KEY = 'btl_costs';
export const BTL_RENT_KEY = 'btl_rent';
export const BTL_FLATS_KEY = 'btl_flats';
export const BTL_EPC_KEY = 'btl_epc';
export const BTL_BANDS_KEY = 'btl_bands';
export const BTL_BENCHMARK_KEY = 'btl_benchmark';
export const BTL_STANDOUT_KEY = 'btl_standout';
export const BTL_LISTING_KEY = 'btl_listing';
export const BTL_LAUNCH_FROM_KEY = 'btl_launch_from';

/** The £2 BTL report (Part G). */
export const DEFAULT_BTL_REPORT_PENCE = 200;

export interface BtlFinance {
  /** Loan-to-value, %. */
  ltvPct: number;
  /** The rent must be at least this % of the stressed interest. */
  icrPct: number;
  /** The stress rate is the live rate plus this… */
  stressAddPct: number;
  /** …or this floor, whichever is higher. */
  stressFloorPct: number;
  /** The rate used when no live rate is cached (said so on screen). */
  fallbackRatePct: number;
}

export const DEFAULT_BTL_FINANCE: BtlFinance = { ltvPct: 75, icrPct: 125, stressAddPct: 2, stressFloorPct: 5.5, fallbackRatePct: 5.5 };

export interface BtlCosts {
  /** Letting agent, % of the rent collected, VAT included. */
  agentPct: number;
  /** Repairs, % of the rent collected. */
  repairsPct: number;
  /** Months a year with no tenant (no rent, no agent fee). */
  emptyMonths: number;
  insurancePcm: number;
  /** Gas, electrical and other safety certificates, £ a year. */
  safetyPerYear: number;
}

export const DEFAULT_BTL_COSTS: BtlCosts = { agentPct: 12, repairsPct: 8, emptyMonths: 1, insurancePcm: 25, safetyPerYear: 300 };

/**
 * How a sale listing's rent range is built (Part A, Q4). The district's
 * average rent (PropertyData key stats) reads as this many bedrooms (checked
 * against 1,250 live rentals on 16 Oct: the median 2-bed sits at 1.04× the
 * district figure) and is moved to the listing's size by the rent ladder.
 * Comparables are live rental listings in the same postcode area, with the
 * same bedrooms and the same type (flat or house), within the radius.
 */
export interface BtlRentSettings {
  ladderBaseBedrooms: number;
  /** At least this many comparables to use them. */
  compsMin: number;
  /** This many, agreeing with the district within agreeHighPct, is high confidence. */
  compsHigh: number;
  compsRadiusKm: number;
  /** A rental counts while it was seen in the last this-many days. */
  compsMaxAgeDays: number;
  /** Half-width bounds of the range, % of the middle. */
  minWidthPct: number;
  maxWidthPct: number;
  /** The half-width on a low-confidence rent. */
  lowWidthPct: number;
  /** The district and the comparables agree within this for high confidence… */
  agreeHighPct: number;
  /** …and disagree beyond this (low confidence, the range stretched to cover both). */
  disagreePct: number;
  /** A rent valuation never narrows the range below this half-width, %. */
  valuationMinWidthPct: number;
}

export const DEFAULT_BTL_RENT: BtlRentSettings = {
  ladderBaseBedrooms: 2,
  compsMin: 5,
  compsHigh: 8,
  compsRadiusKm: 5,
  compsMaxAgeDays: 45,
  minWidthPct: 10,
  maxWidthPct: 25,
  lowWidthPct: 20,
  agreeHighPct: 15,
  disagreePct: 25,
  valuationMinWidthPct: 10,
};

/** Flats' service charge and ground rent when the listing does not give them (Q12): an estimate, and the card says so. */
export interface BtlFlatSettings {
  serviceChargeYear: number;
  serviceChargeLondonYear: number;
  groundRentYear: number;
  /** The estimate's ± spread, %. */
  spreadPct: number;
}

export const DEFAULT_BTL_FLATS: BtlFlatSettings = { serviceChargeYear: 1_500, serviceChargeLondonYear: 2_500, groundRentYear: 150, spreadPct: 40 };

/** The EPC upgrade allowance added to the HIGH end of cash in (Q10: an unchecked EPC carries the D allowance). */
export interface BtlEpcSettings {
  allowanceD: number;
  allowanceEtoG: number;
  unknownAllowance: number;
}

export const DEFAULT_BTL_EPC: BtlEpcSettings = { allowanceD: 5_000, allowanceEtoG: 10_000, unknownAllowance: 5_000 };

/** "How much cash can you put in?": the band tops, £ (the last band has no top). */
export const DEFAULT_BTL_BANDS: readonly number[] = [25_000, 50_000, 100_000];

export interface BtlBenchmarkSettings {
  /** Widening steps in miles, ascending; then the region, then the whole country. */
  stepsMiles: number[];
  region: boolean;
  national: boolean;
  /** A step is used once it holds this many deals in the band. */
  minDeals: number;
  /** Below this even nationally, there is nothing to compare with (the hard rules alone decide). */
  floorDeals: number;
  /** "A bit of both" compares both middles with this percentile. */
  balancedPercentile: number;
}

export const DEFAULT_BTL_BENCHMARK: BtlBenchmarkSettings = { stepsMiles: [10, 25, 50], region: true, national: true, minDeals: 30, floorDeals: 10, balancedPercentile: 40 };

export interface BtlStandoutSettings {
  /** The low end on the member's priority beats the benchmark median by this, %. */
  lowOverMedianPct: number;
  /** An income standout also needs a low-end ROI of at least this, % (Q8). */
  minLowRoiPct: number;
}

export const DEFAULT_BTL_STANDOUT: BtlStandoutSettings = { lowOverMedianPct: 125, minLowRoiPct: 6 };

/** What a lender would refuse (Q9): a lease shorter than this never passes; shorter than shortLeaseYears is flagged. */
export interface BtlListingSettings {
  minLeaseYears: number;
  shortLeaseYears: number;
}

export const DEFAULT_BTL_LISTING: BtlListingSettings = { minLeaseYears: 70, shortLeaseYears: 85 };

/** The paid shortlist's own line inside Batch 16's deal_checks row (rent valuations and EPCs). */
export interface BtlAllowance {
  /** Listings a UK day that may have a rent valuation bought. */
  valuations: number;
  /** Raw pence a UK day for the shortlist's valuations and EPCs. */
  capPence: number;
}

export const DEFAULT_BTL_ALLOWANCE: BtlAllowance = { valuations: 20, capPence: 100 };

export interface BtlSettings {
  reportPence: number;
  finance: BtlFinance;
  costs: BtlCosts;
  rent: BtlRentSettings;
  flats: BtlFlatSettings;
  epc: BtlEpcSettings;
  bands: number[];
  benchmark: BtlBenchmarkSettings;
  standout: BtlStandoutSettings;
  listing: BtlListingSettings;
  allowance: BtlAllowance;
  /** When the launch email line starts (null: not launched). */
  launchFrom: string | null;
}

export const DEFAULT_BTL_SETTINGS: BtlSettings = {
  reportPence: DEFAULT_BTL_REPORT_PENCE,
  finance: DEFAULT_BTL_FINANCE,
  costs: DEFAULT_BTL_COSTS,
  rent: DEFAULT_BTL_RENT,
  flats: DEFAULT_BTL_FLATS,
  epc: DEFAULT_BTL_EPC,
  bands: [...DEFAULT_BTL_BANDS],
  benchmark: DEFAULT_BTL_BENCHMARK,
  standout: DEFAULT_BTL_STANDOUT,
  listing: DEFAULT_BTL_LISTING,
  allowance: DEFAULT_BTL_ALLOWANCE,
  launchFrom: null,
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

const PCT: Bound = { min: 0, max: 100, whole: false };
const POUNDS: Bound = { min: 0, max: 100_000, whole: false };

export function parseBtlReportPence(raw: unknown): number {
  return inBounds(raw, { min: 0, max: 10_000, whole: true }) ?? DEFAULT_BTL_REPORT_PENCE;
}

export function parseBtlFinance(raw: unknown): BtlFinance {
  const out = pick(DEFAULT_BTL_FINANCE, asObject(raw), {
    ltvPct: { min: 1, max: 95, whole: false },
    icrPct: { min: 100, max: 250, whole: false },
    stressAddPct: { min: 0, max: 10, whole: false },
    stressFloorPct: { min: 0, max: 25, whole: false },
    fallbackRatePct: { min: 0.1, max: 25, whole: false },
  });
  return out;
}

export function parseBtlCosts(raw: unknown): BtlCosts {
  return pick(DEFAULT_BTL_COSTS, asObject(raw), {
    agentPct: { min: 0, max: 30, whole: false },
    repairsPct: { min: 0, max: 30, whole: false },
    emptyMonths: { min: 0, max: 6, whole: false },
    insurancePcm: { min: 0, max: 1_000, whole: false },
    safetyPerYear: { min: 0, max: 5_000, whole: false },
  });
}

export function parseBtlRent(raw: unknown): BtlRentSettings {
  const out = pick(DEFAULT_BTL_RENT, asObject(raw), {
    ladderBaseBedrooms: { min: 0, max: 5, whole: true },
    compsMin: { min: 1, max: 50, whole: true },
    compsHigh: { min: 1, max: 100, whole: true },
    compsRadiusKm: { min: 0.5, max: 50, whole: false },
    compsMaxAgeDays: { min: 1, max: 365, whole: true },
    minWidthPct: { min: 1, max: 50, whole: false },
    maxWidthPct: { min: 1, max: 75, whole: false },
    lowWidthPct: { min: 1, max: 75, whole: false },
    agreeHighPct: PCT,
    disagreePct: PCT,
    valuationMinWidthPct: { min: 1, max: 50, whole: false },
  });
  // The bounds stay in order whatever the row says.
  const maxWidthPct = Math.max(out.maxWidthPct, out.minWidthPct);
  return { ...out, maxWidthPct, compsHigh: Math.max(out.compsHigh, out.compsMin), disagreePct: Math.max(out.disagreePct, out.agreeHighPct) };
}

export function parseBtlFlats(raw: unknown): BtlFlatSettings {
  return pick(DEFAULT_BTL_FLATS, asObject(raw), {
    serviceChargeYear: POUNDS,
    serviceChargeLondonYear: POUNDS,
    groundRentYear: POUNDS,
    spreadPct: { min: 0, max: 100, whole: false },
  });
}

export function parseBtlEpc(raw: unknown): BtlEpcSettings {
  return pick(DEFAULT_BTL_EPC, asObject(raw), { allowanceD: POUNDS, allowanceEtoG: POUNDS, unknownAllowance: POUNDS });
}

/** Three ascending band tops; anything else keeps the decided bands. */
export function parseBtlBands(raw: unknown): number[] {
  const list = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!Array.isArray(list) || list.length !== DEFAULT_BTL_BANDS.length) return [...DEFAULT_BTL_BANDS];
  const tops = list.map((v) => inBounds(v, { min: 1_000, max: 10_000_000, whole: false }));
  const ok = tops.every((v, i) => v !== null && (i === 0 || v > (tops[i - 1] as number)));
  return ok ? (tops as number[]) : [...DEFAULT_BTL_BANDS];
}

export function parseBtlBenchmark(raw: unknown): BtlBenchmarkSettings {
  const o = asObject(raw);
  const base = pick(DEFAULT_BTL_BENCHMARK, o, {
    minDeals: { min: 1, max: 1_000, whole: true },
    floorDeals: { min: 0, max: 1_000, whole: true },
    balancedPercentile: { min: 1, max: 99, whole: false },
  });
  let stepsMiles = [...DEFAULT_BTL_BENCHMARK.stepsMiles];
  if (Array.isArray(o.stepsMiles) && o.stepsMiles.length > 0 && o.stepsMiles.length <= 8) {
    const steps = o.stepsMiles.map((v) => inBounds(v, { min: 1, max: 500, whole: false }));
    if (steps.every((v, i) => v !== null && (i === 0 || v > (steps[i - 1] as number)))) stepsMiles = steps as number[];
  }
  return {
    ...base,
    floorDeals: Math.min(base.floorDeals, base.minDeals),
    stepsMiles,
    region: bool(o.region, DEFAULT_BTL_BENCHMARK.region),
    national: bool(o.national, DEFAULT_BTL_BENCHMARK.national),
  };
}

export function parseBtlStandout(raw: unknown): BtlStandoutSettings {
  return pick(DEFAULT_BTL_STANDOUT, asObject(raw), { lowOverMedianPct: { min: 100, max: 1_000, whole: false }, minLowRoiPct: { min: 0, max: 100, whole: false } });
}

export function parseBtlListing(raw: unknown): BtlListingSettings {
  const out = pick(DEFAULT_BTL_LISTING, asObject(raw), { minLeaseYears: { min: 0, max: 999, whole: true }, shortLeaseYears: { min: 0, max: 999, whole: true } });
  return { ...out, shortLeaseYears: Math.max(out.shortLeaseYears, out.minLeaseYears) };
}

/** Batch 28's fields inside Batch 16's deal_checks row. */
export function parseBtlAllowance(dealChecksRaw: unknown): BtlAllowance {
  const o = asObject(dealChecksRaw);
  return {
    valuations: inBounds(o.btlValuations, { min: 0, max: 500, whole: true }) ?? DEFAULT_BTL_ALLOWANCE.valuations,
    capPence: inBounds(o.btlCapPence, { min: 0, max: 100_000, whole: true }) ?? DEFAULT_BTL_ALLOWANCE.capPence,
  };
}

/** An ISO timestamp or nothing. */
export function parseBtlLaunchFrom(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : null;
  if (!v || v === 'null') return null;
  return Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
}

/** Every Batch 28 setting from the stored rows (missing rows read as defaults). */
export function parseBtlSettings(rows: Partial<Record<string, unknown>>, dealChecksRaw?: unknown): BtlSettings {
  return {
    reportPence: parseBtlReportPence(rows[BTL_REPORT_PENCE_KEY]),
    finance: parseBtlFinance(rows[BTL_FINANCE_KEY]),
    costs: parseBtlCosts(rows[BTL_COSTS_KEY]),
    rent: parseBtlRent(rows[BTL_RENT_KEY]),
    flats: parseBtlFlats(rows[BTL_FLATS_KEY]),
    epc: parseBtlEpc(rows[BTL_EPC_KEY]),
    bands: parseBtlBands(rows[BTL_BANDS_KEY]),
    benchmark: parseBtlBenchmark(rows[BTL_BENCHMARK_KEY]),
    standout: parseBtlStandout(rows[BTL_STANDOUT_KEY]),
    listing: parseBtlListing(rows[BTL_LISTING_KEY]),
    allowance: parseBtlAllowance(dealChecksRaw),
    launchFrom: parseBtlLaunchFrom(rows[BTL_LAUNCH_FROM_KEY]),
  };
}

/** The billing_settings keys this batch reads, for one select. */
export const BTL_SETTING_KEYS = [
  BTL_REPORT_PENCE_KEY,
  BTL_FINANCE_KEY,
  BTL_COSTS_KEY,
  BTL_RENT_KEY,
  BTL_FLATS_KEY,
  BTL_EPC_KEY,
  BTL_BANDS_KEY,
  BTL_BENCHMARK_KEY,
  BTL_STANDOUT_KEY,
  BTL_LISTING_KEY,
  BTL_LAUNCH_FROM_KEY,
] as const;
