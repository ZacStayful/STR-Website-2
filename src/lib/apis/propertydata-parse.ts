/**
 * PropertyData (propertydata.co.uk): the pure half of the client.
 *
 * URL building, response parsing, address matching and the bedroom-based
 * fallbacks live here with no network and no server-only imports, so each
 * parser is unit-tested against the documented example responses in
 * `./__fixtures__/propertydata.ts`. The fetchers that call the API and meter
 * the cost are in `src/lib/broker/providers/propertydata.ts`; the questions
 * that cache and budget them are in `src/lib/broker/questions-propertydata-defs.ts`.
 *
 * Every response carries `status: 'success' | 'error'`; a parser returns null
 * for an error, a missing section or an unusable value so the caller falls
 * back rather than storing junk.
 */

import type { LongLetData } from '../types.ts';

export const PD_BASE = 'https://api.propertydata.co.uk';

export type PdQuery = Record<string, string | number | boolean | null | undefined>;

/**
 * The request URL. The key goes first and the postcode keeps its space
 * (URLSearchParams sends it as `+`, which PropertyData expects). Empty,
 * null and undefined values are left out.
 */
export function pdUrl(path: string, query: PdQuery, apiKey: string): URL {
  const url = new URL(`${PD_BASE}/${path.replace(/^\/+/, '')}`);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

/** `path?query` without the key, for the meter and the cache: never the URL itself. */
export function pdCallKey(path: string, query: PdQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return `/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

export function pdOk(json: unknown): json is Record<string, unknown> {
  return typeof json === 'object' && json !== null && (json as Record<string, unknown>).status === 'success';
}

/** The API's error message, if the body carries one. */
export function pdErrorMessage(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const m = (json as Record<string, unknown>).message;
  return typeof m === 'string' ? m : null;
}

/** Numbers arrive as numbers, "1,519.51", "3.6%" or "£825,000"; anything else is null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[£,%\s]/g, '');
    if (cleaned === '' || !/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** "ng1 5dt" → "NG15DT": the cache key form. */
export function normalisePostcode(postcode: string): string {
  return postcode.replace(/\s+/g, '').toUpperCase();
}

/** "NG1 5DT" → "NG1"; null unless it is a full postcode. */
export function outcodeOf(postcode: string | null | undefined): string | null {
  const m = (postcode ?? '').trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  return m ? m[1] : null;
}

/** "NG1 5DT" / "NG1" → "NG"; the same helper the listing normaliser uses. */
export { postcodeAreaOf } from '../listing/normalise.ts';

// ─── Address matching ───────────────────────────────────────────────
//
// Postcode-level endpoints (floor areas, EPC, council tax) list every
// property in the postcode; we need the row for the address the member
// typed. Addresses arrive in every style ("Flat 3, 26 Charleville Road",
// "FLAT BST AT 18, CHARLEVILLE ROAD, LONDON, W14 9JH", "18b Charleville Rd")
// so matching is token-based. An entry matches when its identifiers (house
// numbers and unit labels: "18", "18b", "b8", "3") are exactly the member's,
// in either order, and a street word that is not a generic suffix agrees.
// Both directions matter: "3 Charleville Road" must not take "Flat 3, 26
// Charleville Road", and "32 Charleville Road" must not take "Flat B8, 32".
// Ordinals ("1st", "2nd") are floor labels, not identifiers. Postcodes are
// stripped first so "W14" is never mistaken for a unit, and a trailing
// outcode is only stripped when it does not follow "flat" or "unit".

const GENERIC_STREET_WORDS = new Set([
  'road', 'rd', 'street', 'st', 'lane', 'ln', 'avenue', 'ave', 'close', 'cl', 'drive', 'dr', 'way', 'court', 'ct',
  'place', 'pl', 'gardens', 'gdns', 'terrace', 'crescent', 'cres', 'square', 'sq', 'grove', 'park', 'hill', 'rise',
  'mews', 'row', 'walk', 'view', 'green', 'end', 'north', 'south', 'east', 'west', 'upper', 'lower', 'london',
  'flat', 'apartment', 'apt', 'floor', 'flr', 'flrs', 'ground', 'gnd', 'first', 'second', 'third', 'fourth', 'top',
  'basement', 'bst', 'maisonette', 'mais', 'the', 'and', 'at', 'unit', 'room', 'house', 'lhs', 'rhs',
]);

const UNIT_WORDS = new Set(['flat', 'apartment', 'apt', 'unit', 'suite', 'room', 'no']);
const FULL_POSTCODE_ANYWHERE = /\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi;
const OUTCODE_TOKEN = /^[a-z]{1,2}\d[a-z\d]?$/;
const ORDINAL = /^\d+(st|nd|rd|th)$/;
const HAS_DIGIT = /\d/;

function addressTokens(s: string): string[] {
  const hadPostcode = FULL_POSTCODE_ANYWHERE.test(s);
  FULL_POSTCODE_ANYWHERE.lastIndex = 0;
  const stripped = s.replace(FULL_POSTCODE_ANYWHERE, ' ');
  const tokens = stripped.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  // "18 Charleville Road, W14": the trailing outcode is not a unit label,
  // unless it follows "flat" or "unit" ("32 Charleville Road, Flat B8").
  const last = tokens[tokens.length - 1];
  const before = tokens[tokens.length - 2];
  if (!hadPostcode && tokens.length >= 2 && OUTCODE_TOKEN.test(last) && !UNIT_WORDS.has(before)) tokens.pop();
  return tokens;
}

const identifiers = (tokens: readonly string[]) => tokens.filter((t) => HAS_DIGIT.test(t) && !ORDINAL.test(t));
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

export type AddressMatchKind = 'address' | 'house-number';

export interface AddressMatch<T> {
  entries: T[];
  matched: AddressMatchKind;
}

/**
 * Every entry that is the member's address, in the order the API listed
 * them (several rows share an address when a building's flats are listed
 * under it). `matched` is 'address' when a street word agreed too and
 * 'house-number' when only the identifiers could be compared. Null when
 * nothing fits.
 */
export function matchAddressEntries<T extends { address?: string | null }>(entries: readonly T[], address: string): AddressMatch<T> | null {
  const mine = addressTokens(address);
  const myIds = [...new Set(identifiers(mine))];
  const streetWords = mine.filter((t) => /^[a-z]{3,}$/.test(t) && !GENERIC_STREET_WORDS.has(t));
  if (myIds.length === 0) return null;
  const hits: T[] = [];
  for (const e of entries) {
    const theirs = addressTokens(e.address ?? '');
    if (theirs.length === 0) continue;
    if (!sameSet(myIds, [...new Set(identifiers(theirs))])) continue;
    if (streetWords.length > 0 && !streetWords.some((w) => theirs.includes(w))) continue;
    hits.push(e);
  }
  if (hits.length === 0) return null;
  return { entries: hits, matched: streetWords.length > 0 ? 'address' : 'house-number' };
}

/** The single best entry, for callers that only want one. */
export function matchAddressEntry<T extends { address?: string | null }>(entries: readonly T[], address: string): (AddressMatch<T> & { entry: T }) | null {
  const m = matchAddressEntries(entries, address);
  return m ? { ...m, entry: m.entries[0] } : null;
}

// ─── /floor-areas ───────────────────────────────────────────────────

export interface FloorAreaEntry {
  address: string;
  squareFeet: number | null;
  habitableRooms: number | null;
  inspectionDate: string | null;
}

/** Accepts the documented `known_floor_areas` and the older `data` key. */
export function parseFloorAreas(json: unknown): FloorAreaEntry[] | null {
  if (!pdOk(json)) return null;
  const raw = Array.isArray(json.known_floor_areas) ? json.known_floor_areas : Array.isArray(json.data) ? json.data : null;
  if (!raw) return null;
  const out: FloorAreaEntry[] = [];
  for (const item of raw) {
    const r = rec(item);
    if (!r) continue;
    const address = str(r.address);
    if (!address) continue;
    out.push({ address, squareFeet: num(r.square_feet), habitableRooms: num(r.habitable_rooms), inspectionDate: str(r.inspection_date) });
  }
  return out;
}

// ─── /valuation-rent ────────────────────────────────────────────────

export interface RentValuation {
  weeklyRent: number;
  monthlyRent: number;
}

export function parseValuationRent(json: unknown): RentValuation | null {
  if (!pdOk(json)) return null;
  const result = rec(json.result);
  const estimate = num(result?.estimate);
  if (estimate === null || estimate <= 0) return null;
  const unit = str(result?.unit) ?? 'gbp_per_week';
  if (unit === 'gbp_per_month') return { weeklyRent: Math.round((estimate * 12) / 52), monthlyRent: Math.round(estimate) };
  return { weeklyRent: estimate, monthlyRent: Math.round((estimate * 52) / 12) };
}

// ─── /valuation-sale ────────────────────────────────────────────────

export type ValuationConfidence = 'high' | 'medium' | 'low';

export interface SaleValuation {
  estimate: number;
  /** PropertyData's own ± figure, when returned. */
  margin: number | null;
  confidence: ValuationConfidence | null;
  low: number;
  high: number;
}

/** Without a margin the range is ±15%, which is what the report assumed before the margin was read. */
export const SALE_RANGE_FALLBACK_PCT = 15;

export function parseValuationSale(json: unknown): SaleValuation | null {
  if (!pdOk(json)) return null;
  const result = rec(json.result) ?? json;
  const estimate = num(result.estimate ?? result.estimate_value ?? result.valuation ?? result.price ?? result.value);
  if (estimate === null || estimate <= 0) return null;
  const margin = num(result.margin);
  const conf = str(result.confidence)?.toLowerCase();
  const confidence: ValuationConfidence | null = conf === 'high' || conf === 'medium' || conf === 'low' ? conf : null;
  const spread = margin !== null && margin > 0 ? margin : Math.round((estimate * SALE_RANGE_FALLBACK_PCT) / 100);
  return {
    estimate: Math.round(estimate),
    margin: margin !== null && margin > 0 ? Math.round(margin) : null,
    confidence,
    low: Math.round(estimate - spread),
    high: Math.round(estimate + spread),
  };
}

// ─── /stamp-duty-calculator ─────────────────────────────────────────

export interface StampDutyResult {
  /** SDLT, LTT or LBTT as the API names it. */
  name: string;
  payable: number;
  effectiveRatePct: number | null;
  countryUsed: string | null;
  modeUsed: string | null;
  transactionDate: string | null;
}

export function parseStampDuty(json: unknown): StampDutyResult | null {
  if (!pdOk(json)) return null;
  const payable = num(json.transaction_tax_payable);
  if (payable === null || payable < 0) return null;
  return {
    name: str(json.transaction_tax_name) ?? 'SDLT',
    payable: Math.round(payable),
    effectiveRatePct: num(json.effective_rate),
    countryUsed: str(json.country_used),
    modeUsed: str(json.mode_used),
    transactionDate: str(json.transaction_date),
  };
}

// ─── /mortgage-rates ────────────────────────────────────────────────

export interface RateQuote {
  ratePct: number;
  /** "Jun 2023": the month the average is for. */
  date: string | null;
}

export interface MortgageRates {
  fixed2y: RateQuote | null;
  fixed3y: RateQuote | null;
  variable: RateQuote | null;
}

function parseRate(v: unknown): RateQuote | null {
  const r = rec(v);
  const ratePct = num(r?.avg_interest_rate);
  if (ratePct === null || ratePct <= 0 || ratePct > 30) return null;
  return { ratePct, date: str(r?.date) };
}

export function parseMortgageRates(json: unknown): MortgageRates | null {
  if (!pdOk(json)) return null;
  const data = rec(json.data);
  if (!data) return null;
  const fixed = rec(data.fixed_rate);
  const out: MortgageRates = { fixed2y: parseRate(fixed?.['2_year']), fixed3y: parseRate(fixed?.['3_year']), variable: parseRate(data.variable_rate) };
  return out.fixed2y || out.fixed3y || out.variable ? out : null;
}

// ─── /council-tax ───────────────────────────────────────────────────

export type CouncilTaxBand = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export const COUNCIL_TAX_BANDS: readonly CouncilTaxBand[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

export interface CouncilTaxData {
  council: string | null;
  /** PropertyData's "Low tax" / "High tax" style rating of the council. */
  rating: string | null;
  /** "2026/27" */
  year: string | null;
  /** Annual charge per band for a two-adult household, GBP. */
  bandsAnnual: Partial<Record<CouncilTaxBand, number>>;
  properties: { address: string; band: CouncilTaxBand }[];
}

export function isCouncilTaxBand(v: unknown): v is CouncilTaxBand {
  return typeof v === 'string' && (COUNCIL_TAX_BANDS as readonly string[]).includes(v.toUpperCase()) && v.length === 1;
}

export function parseCouncilTax(json: unknown): CouncilTaxData | null {
  if (!pdOk(json)) return null;
  const bands = rec(json.council_tax);
  const bandsAnnual: Partial<Record<CouncilTaxBand, number>> = {};
  for (const b of COUNCIL_TAX_BANDS) {
    const v = num(bands?.[`band_${b.toLowerCase()}`]);
    if (v !== null && v > 0) bandsAnnual[b] = v;
  }
  const properties: CouncilTaxData['properties'] = [];
  if (Array.isArray(json.properties)) {
    for (const item of json.properties) {
      const r = rec(item);
      const address = str(r?.address);
      const band = str(r?.band)?.toUpperCase();
      if (address && isCouncilTaxBand(band)) properties.push({ address, band });
    }
  }
  if (Object.keys(bandsAnnual).length === 0 && properties.length === 0) return null;
  return { council: str(json.council), rating: str(json.council_rating), year: str(json.year), bandsAnnual, properties };
}

// ─── /energy-efficiency ─────────────────────────────────────────────

export interface EpcEntry {
  address: string;
  /** A to G. */
  rating: string;
  score: number | null;
  inspectionDate: string | null;
}

export function parseEnergyEfficiency(json: unknown): EpcEntry[] | null {
  if (!pdOk(json)) return null;
  const raw = Array.isArray(json.energy_efficiency) ? json.energy_efficiency : Array.isArray(json.data) ? json.data : null;
  if (!raw) return null;
  const out: EpcEntry[] = [];
  for (const item of raw) {
    const r = rec(item);
    const address = str(r?.address);
    const rating = str(r?.rating)?.toUpperCase();
    if (!address || !rating || !/^[A-G]$/.test(rating)) continue;
    const date = str(r?.inspection_date);
    out.push({ address, rating, score: num(r?.score), inspectionDate: date ? date.slice(0, 10) : null });
  }
  return out;
}

// ─── /flood-risk ────────────────────────────────────────────────────

export interface FloodRisk {
  /** "High" | "Medium" | "Low" | "Very Low", as the API words it. */
  level: string;
}

export function parseFloodRisk(json: unknown): FloodRisk | null {
  if (!pdOk(json)) return null;
  const level = str(json.flood_risk);
  return level ? { level } : null;
}

export function isHighFloodRisk(level: string | null | undefined): boolean {
  return (level ?? '').trim().toLowerCase() === 'high';
}

// ─── /conservation-area, /green-belt, /aonb, /national-park ─────────

export type DesignationField = 'conservation_area' | 'green_belt' | 'aonb' | 'national_park';

export interface Designation {
  inside: boolean;
  name: string | null;
}

export function parseDesignation(json: unknown, field: DesignationField): Designation | null {
  if (!pdOk(json)) return null;
  const v = json[field];
  if (typeof v !== 'boolean') return null;
  return { inside: v, name: v ? str(json[`${field}_name`]) : null };
}

// ─── /listed-buildings ──────────────────────────────────────────────

export interface ListedBuilding {
  name: string;
  /** "I", "II*" or "II". */
  grade: string | null;
  distanceMiles: number | null;
  url: string | null;
  listDate: string | null;
}

/** Within ~80 m the entry may be the building itself; beyond that it is a neighbour. */
export const LISTED_PROXIMITY_MILES = 0.05;

export function parseListedBuildings(json: unknown): ListedBuilding[] | null {
  if (!pdOk(json)) return null;
  const data = rec(json.data) ?? json;
  const raw = data.listed_buildings;
  const items = Array.isArray(raw) ? raw : rec(raw) ? Object.values(rec(raw)!) : null;
  if (!items) return null;
  const out: ListedBuilding[] = [];
  for (const item of items) {
    const r = rec(item);
    const name = str(r?.name);
    if (!name) continue;
    out.push({ name, grade: str(r?.grade), distanceMiles: num(r?.distance), url: str(r?.url), listDate: str(r?.list_date) });
  }
  out.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  return out;
}

export function flagPossiblyListed(list: readonly ListedBuilding[]): boolean {
  return list.some((b) => b.distanceMiles !== null && b.distanceMiles <= LISTED_PROXIMITY_MILES);
}

// ─── /demand and /demand-rent ───────────────────────────────────────

export type DemandKind = 'sale' | 'rent';

export interface DemandSnapshot {
  kind: DemandKind;
  /** Properties currently listed. */
  total: number | null;
  /** Sales or lets a month. */
  perMonth: number | null;
  turnoverPct: number | null;
  monthsOfInventory: number | null;
  daysOnMarket: number | null;
  /** "Buyers market" / "Sellers market" / "Tenants market" / "Landlords market" / "Balanced market". */
  rating: string | null;
}

export function parseDemand(json: unknown, kind: DemandKind): DemandSnapshot | null {
  if (!pdOk(json)) return null;
  const snapshot: DemandSnapshot =
    kind === 'sale'
      ? {
          kind,
          total: num(json.total_for_sale),
          perMonth: num(json.average_sales_per_month),
          turnoverPct: num(json.turnover_per_month),
          monthsOfInventory: num(json.months_of_inventory),
          daysOnMarket: num(json.days_on_market),
          rating: str(json.demand_rating),
        }
      : {
          kind,
          total: num(json.total_for_rent),
          perMonth: num(json.transactions_per_month),
          turnoverPct: num(json.turnover_per_month),
          monthsOfInventory: num(json.months_of_inventory),
          daysOnMarket: num(json.days_on_market),
          rating: str(json.rental_demand_rating),
        };
  return snapshot.rating || snapshot.daysOnMarket !== null || snapshot.total !== null ? snapshot : null;
}

// ─── /postcode-key-stats ────────────────────────────────────────────

export interface KeyStatsRow {
  outcode: string;
  avgPrice: number | null;
  avgPricePsf: number | null;
  /** PropertyData quotes rents per week. */
  avgRentWeekly: number | null;
  avgYieldPct: number | null;
  growth1y: number | null;
  growth3y: number | null;
  growth5y: number | null;
  growth7y: number | null;
  salesPerMonth: number | null;
  turnoverPct: number | null;
}

export function parseKeyStats(json: unknown): KeyStatsRow[] | null {
  if (!pdOk(json) || !Array.isArray(json.data)) return null;
  const rows: KeyStatsRow[] = [];
  for (const item of json.data) {
    const r = rec(item);
    const outcode = str(r?.outcode)?.toUpperCase();
    if (!outcode) continue;
    rows.push({
      outcode,
      avgPrice: num(r?.avg_price),
      avgPricePsf: num(r?.avg_price_psf),
      avgRentWeekly: num(r?.avg_rent),
      avgYieldPct: num(r?.avg_yield),
      growth1y: num(r?.growth_1y),
      growth3y: num(r?.growth_3y),
      growth5y: num(r?.growth_5y),
      growth7y: num(r?.growth_7y),
      salesPerMonth: num(r?.sales_per_month),
      turnoverPct: num(r?.turnover),
    });
  }
  return rows;
}

// ─── /account/credits ───────────────────────────────────────────────

export interface AccountCredits {
  used: number | null;
  remaining: number | null;
  limit: number | null;
  /** ISO date the monthly allowance renews. */
  renewsAt: string | null;
}

export function parseAccountCredits(json: unknown): AccountCredits | null {
  if (!pdOk(json)) return null;
  const r = rec(json.result);
  if (!r) return null;
  const renew = num(r.credits_renew_at);
  return {
    used: num(r.credits_used),
    remaining: num(r.credits_remaining),
    limit: num(r.credits_limit),
    renewsAt: renew !== null && renew > 0 ? new Date(renew * 1000).toISOString() : null,
  };
}

// ─── Fallbacks and attempt parameters ───────────────────────────────

/** Bedroom-scaled default internal areas (sq ft) when /floor-areas has no match. */
export const AREA_BY_BEDROOMS: Record<number, number> = { 1: 500, 2: 700, 3: 900, 4: 1100, 5: 1350 };

export const BATHROOMS_BY_BEDROOMS: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 };

/** UK national median monthly rents (2024, ONS/Zoopla blend): the last resort when the API has nothing. */
export const UK_FALLBACK_MONTHLY_RENT: Record<number, number> = { 0: 950, 1: 1100, 2: 1400, 3: 1650, 4: 2050, 5: 2500 };

export type ConstructionDate = 'pre_1914' | '1914_2000' | '2000_onwards';

export interface FloorAreaResult {
  squareFeet: number;
  constructionDate: ConstructionDate;
  /** True when the figure came from the EPC-derived list rather than the bedroom default. */
  matched: boolean;
}

export function clampBedrooms(bedrooms: number): number {
  return Math.max(1, Math.min(Number.isFinite(bedrooms) ? Math.round(bedrooms) : 1, 5));
}

/**
 * /floor-areas never carries a build year, so the construction band is
 * always the middle one; it is here so the valuation calls have a value.
 */
export function fallbackFloorArea(bedrooms: number): FloorAreaResult {
  return { squareFeet: AREA_BY_BEDROOMS[clampBedrooms(bedrooms)] ?? 700, constructionDate: '1914_2000', matched: false };
}

export function floorAreaFromEntry(entry: FloorAreaEntry | null | undefined, bedrooms: number): FloorAreaResult {
  const fallback = fallbackFloorArea(bedrooms);
  if (!entry || entry.squareFeet === null || entry.squareFeet <= 0) return fallback;
  return { squareFeet: Math.round(entry.squareFeet), constructionDate: '1914_2000', matched: true };
}

export function fallbackLongLet(bedrooms: number): LongLetData {
  const monthlyRent = UK_FALLBACK_MONTHLY_RENT[clampBedrooms(bedrooms)] ?? 1400;
  return { monthlyRent, estimateHigh: Math.round(monthlyRent * 1.15), estimateLow: Math.round(monthlyRent * 0.85), comparables: [] };
}

export function longLetFromValuation(v: RentValuation): LongLetData {
  return { monthlyRent: v.monthlyRent, estimateHigh: Math.round(v.monthlyRent * 1.15), estimateLow: Math.round(v.monthlyRent * 0.85), comparables: [] };
}

export interface RentValuationOptions {
  propertyType?: string;
  constructionDate?: string;
  internalArea?: number;
  bathrooms?: number;
  finishQuality?: string;
  outdoorSpace?: string;
  offStreetParking?: number;
}

/** PropertyData's property_type slugs from the analyser's names. */
export const PROPERTY_TYPE_SLUGS: Record<string, string> = {
  flat: 'flat',
  terraced_house: 'terraced_house',
  'semi-detached_house': 'semi-detached_house',
  detached_house: 'detached_house',
  Flat: 'flat',
  Terraced: 'terraced_house',
  'Semi-detached': 'semi-detached_house',
  'Terraced House': 'terraced_house',
  'Semi-Detached House': 'semi-detached_house',
  'Detached House': 'detached_house',
  Detached: 'detached_house',
};

export function propertyTypeSlug(propertyType: string | undefined | null, fallback = 'flat'): string {
  return (propertyType && PROPERTY_TYPE_SLUGS[propertyType]) ?? fallback;
}

const ALT_PROPERTY_TYPES = ['terraced_house', 'semi-detached_house', 'detached_house', 'flat'];

/**
 * The parameter sets /valuation-rent is tried with, in order: the member's
 * own details first, then simpler defaults, then every common property
 * type. The API rejects incomplete or inconsistent combinations, so each
 * later set gives up a little precision to get an answer at all.
 */
export function longLetAttemptParams(postcode: string, bedrooms: number, options: RentValuationOptions = {}): Record<string, string>[] {
  const beds = clampBedrooms(bedrooms);
  const type = options.propertyType ?? 'flat';
  const attempts: Record<string, string>[] = [
    {
      postcode,
      property_type: type,
      construction_date: options.constructionDate ?? '2000_onwards',
      internal_area: String(Math.max(options.internalArea ?? AREA_BY_BEDROOMS[beds] ?? 650, 300)),
      bedrooms: String(bedrooms),
      bathrooms: String(options.bathrooms ?? BATHROOMS_BY_BEDROOMS[beds] ?? 1),
      finish_quality: options.finishQuality ?? 'high',
      outdoor_space: options.outdoorSpace ?? 'none',
      off_street_parking: String(options.offStreetParking ?? 0),
    },
    {
      postcode,
      property_type: type,
      construction_date: '1914_2000',
      internal_area: String(AREA_BY_BEDROOMS[beds] ?? 650),
      bedrooms: String(bedrooms),
      bathrooms: String(BATHROOMS_BY_BEDROOMS[beds] ?? 1),
      finish_quality: 'average',
      outdoor_space: 'none',
      off_street_parking: '0',
    },
  ];
  for (const pType of ALT_PROPERTY_TYPES) {
    attempts.push({
      postcode,
      property_type: pType,
      construction_date: '1914_2000',
      internal_area: String(AREA_BY_BEDROOMS[beds] ?? 650),
      bedrooms: String(bedrooms),
      bathrooms: '1',
      finish_quality: 'average',
      outdoor_space: 'none',
      off_street_parking: '0',
    });
  }
  return attempts;
}

/** The parameter sets /valuation-sale is tried with, in the same spirit. */
export function saleAttemptParams(postcode: string, bedrooms: number, propertyType: string): Record<string, string>[] {
  const beds = clampBedrooms(bedrooms);
  const mapped = propertyTypeSlug(propertyType);
  const attempts: Record<string, string>[] = [
    {
      postcode,
      property_type: mapped,
      bedrooms: String(beds),
      bathrooms: String(BATHROOMS_BY_BEDROOMS[beds] ?? 1),
      finish_quality: 'average',
      construction_date: '1914_2000',
      internal_area: String(AREA_BY_BEDROOMS[beds] ?? 700),
      outdoor_space: 'none',
      off_street_parking: '0',
    },
    { postcode, property_type: mapped, bedrooms: String(beds) },
  ];
  for (const pType of ['flat', 'terraced_house', 'semi-detached_house', 'detached_house']) {
    if (pType === mapped) continue;
    attempts.push({ postcode, property_type: pType, bedrooms: String(beds) });
  }
  return attempts;
}
