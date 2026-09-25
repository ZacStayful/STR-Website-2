import { AREA_REGION } from '../market/regions.ts';
import { outcodeOf, postcodeAreaOf, type StampDutyResult } from '../apis/propertydata-parse.ts';

/**
 * Transaction tax on an additional residential property, by nation.
 *
 * The saved report shows PropertyData's calculator figure (current
 * legislation on the day the report ran). These local tables exist for two
 * jobs: the live deal calculator in the browser, which cannot call the API
 * on every keystroke, and the fallback when the API is unavailable. They
 * are the additional-property (investor) rates in force from April 2025
 * (SDLT), December 2024 (LTT higher rates) and December 2024 (LBTT with
 * the 8% ADS), and a test pins the Scottish table to PropertyData's own
 * documented example. Check them here when a budget moves the bands.
 */

export type TaxCountry = 'england' | 'wales' | 'scotland' | 'northern_ireland';
export type TaxName = 'SDLT' | 'LTT' | 'LBTT';

export interface StampDutyFigure {
  amount: number;
  name: TaxName;
  effectiveRatePct: number;
  country: TaxCountry;
  /** 'propertydata' when the calculator answered; 'local' from the tables below. */
  source: 'propertydata' | 'local';
}

/**
 * Postcode areas that straddle a border, by outcode. TD is Scottish except
 * Berwick-upon-Tweed; CH is English except Deeside, Flint, Mold and
 * Holywell; SY is English except mid-Wales from Montgomery to Tregaron.
 * (HR3 and HR5 are mixed street by street and stay England.)
 */
const OUTCODE_COUNTRY: Record<string, TaxCountry> = {
  TD15: 'england',
  CH5: 'wales',
  CH6: 'wales',
  CH7: 'wales',
  CH8: 'wales',
  SY15: 'wales',
  SY16: 'wales',
  SY17: 'wales',
  SY18: 'wales',
  SY19: 'wales',
  SY20: 'wales',
  SY21: 'wales',
  SY22: 'wales',
  SY23: 'wales',
  SY24: 'wales',
  SY25: 'wales',
};

/** Which nation's tax applies, from the outcode where an area straddles a border, else the postcode area. Crown dependencies and unknown areas default to England. */
export function countryForPostcode(postcode: string | null | undefined): TaxCountry {
  const outcode = outcodeOf(postcode) ?? (postcode ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (outcode && OUTCODE_COUNTRY[outcode]) return OUTCODE_COUNTRY[outcode];
  const area = postcodeAreaOf(postcode);
  const slug = area ? AREA_REGION[area] : undefined;
  if (slug === 'scotland') return 'scotland';
  if (slug === 'wales') return 'wales';
  if (slug === 'northern-ireland') return 'northern_ireland';
  return 'england';
}

export function taxNameFor(country: TaxCountry): TaxName {
  if (country === 'scotland') return 'LBTT';
  if (country === 'wales') return 'LTT';
  return 'SDLT';
}

export function taxCountryFor(name: string | null | undefined, fallback: TaxCountry): TaxCountry {
  const n = (name ?? '').toUpperCase();
  if (n === 'LBTT') return 'scotland';
  if (n === 'LTT') return 'wales';
  if (n === 'SDLT') return fallback === 'northern_ireland' ? 'northern_ireland' : 'england';
  return fallback;
}

type Band = [upper: number, rate: number];

/** England and Northern Ireland: SDLT additional-property rates from 1 April 2025. */
const SDLT_ADDITIONAL: Band[] = [
  [125_000, 0.05],
  [250_000, 0.07],
  [925_000, 0.1],
  [1_500_000, 0.15],
  [Infinity, 0.17],
];

/** Wales: LTT higher residential rates from 11 December 2024. */
const LTT_HIGHER: Band[] = [
  [180_000, 0.05],
  [250_000, 0.085],
  [400_000, 0.1],
  [750_000, 0.125],
  [1_500_000, 0.15],
  [Infinity, 0.17],
];

/** Scotland: LBTT residential bands, plus the Additional Dwelling Supplement on the whole price. */
const LBTT_RESIDENTIAL: Band[] = [
  [145_000, 0],
  [250_000, 0.02],
  [325_000, 0.05],
  [750_000, 0.1],
  [Infinity, 0.12],
];
const LBTT_ADS_RATE = 0.08;
/** ADS applies to purchases at or above this price. */
const LBTT_ADS_THRESHOLD = 40_000;

function banded(price: number, bands: Band[]): number {
  let duty = 0;
  let lower = 0;
  for (const [upper, rate] of bands) {
    if (price <= lower) break;
    duty += (Math.min(price, upper) - lower) * rate;
    lower = upper;
  }
  return duty;
}

/** The tax from the local tables, for the live calculator and as the fallback. */
export function stampDutyLocal(price: number, country: TaxCountry = 'england'): StampDutyFigure {
  const p = Math.max(0, price);
  let amount: number;
  if (country === 'scotland') {
    amount = banded(p, LBTT_RESIDENTIAL) + (p >= LBTT_ADS_THRESHOLD ? p * LBTT_ADS_RATE : 0);
  } else if (country === 'wales') {
    amount = banded(p, LTT_HIGHER);
  } else {
    amount = banded(p, SDLT_ADDITIONAL);
  }
  const rounded = Math.round(amount);
  return { amount: rounded, name: taxNameFor(country), effectiveRatePct: p > 0 ? Math.round((rounded / p) * 1000) / 10 : 0, country, source: 'local' };
}

/** PropertyData's calculator answer as a figure the deal maths can use; `price` fills in the rate when the API leaves it out. */
export function stampDutyFromApi(result: StampDutyResult, country: TaxCountry, price: number): StampDutyFigure {
  const resolved = taxCountryFor(result.name, country);
  const amount = Math.round(result.payable);
  return {
    amount,
    name: taxNameFor(resolved),
    effectiveRatePct: result.effectiveRatePct ?? (price > 0 ? Math.round((amount / price) * 1000) / 10 : 0),
    country: resolved,
    source: 'propertydata',
  };
}
