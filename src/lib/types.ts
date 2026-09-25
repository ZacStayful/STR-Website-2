import type { EnhancedNotice } from './analysis/enhanced-notice.ts';
import type { EarningsRange } from './comps/earnings.ts';
import type { LocalTrend } from './comps/local-trend.ts';
import type { ListingsNearby } from './comps/nearby.ts';
import type { StayProfile } from './comps/stays.ts';

// ─── Property Input ───────────────────────────────────────────────
export interface PropertyInput {
  address: string;
  postcode: string;
  bedrooms: number;
  guests: number;
  /**
   * The town, from the geocoder. Optional: analyses saved before this was
   * captured simply lack it, and the PDF falls back to parsing the address.
   */
  locality?: string;
}

// ─── Short-Term Let Data ──────────────────────────────────────────
export interface ShortLetComparable {
  title: string;
  url: string;
  bedrooms: number;
  accommodates: number;
  averageDailyRate: number;
  occupancyRate: number;
  annualRevenue: number;
  distance?: number;
  rating: number;          // 0-5 scale (auto-normalised from API)
  reviewCount: number;
  listingAge: number;      // years, calculated from added_on
  daysAvailable: number;
  thumbnailUrl?: string;   // Airbnb listing cover photo (from bounds enrichment)
  amenityCount: number;    // count of amenities listed on the property
  /**
   * The raw amenity map, kept so the report can work out which amenities are
   * expected in this market and which would set a listing apart. Optional:
   * comparables stored before this was captured only have the count.
   */
  amenities?: Record<string, boolean>;
  /**
   * Bookings over the last twelve months. Combined with occupancy this gives a
   * real average stay length, rather than assuming one.
   */
  bookings?: number;
}

// ─── V2 Scenarios (worst/base/best) ─────────────────────────────
export interface Scenario {
  annualRevenue: number;
  averageDailyRate: number;
  occupancyPercent: number;
  monthly: { label: string; adr: number; occupancy: number; revenue: number }[];
}

export interface Scenarios {
  worst: Scenario;
  base: Scenario;
  best: Scenario;
}

// ─── V3 Location + pricing metadata ─────────────────────────────
export type LocationClass =
  | 'urban'
  | 'suburban'
  | 'rural_village'
  | 'rural_isolated'
  | 'coastal';

export interface AdrMultipliers {
  total: number;
  location: number;
  propertyType: number;
  outdoorSpace: number;
  parking: number;
  condition: number;
  specialFeatures: number;
  baseAdrPreMult: number;
  finalAdr: number;
}

export interface AnnualisationMeta {
  compsAnnualised: number;
  compsMature: number;
  seasonalDataSource: string;
}

export interface ShortLetData {
  annualRevenue: number;
  monthlyRevenue: [number, number, number, number, number, number, number, number, number, number, number, number];
  occupancyRate: number;
  averageDailyRate: number;
  activeListings: number;
  comparables: ShortLetComparable[];
  scenarios?: Scenarios; // V2: optional until fully rolled out
  // V3 additions (all optional)
  locationClass?: LocationClass;
  adrMultipliers?: AdrMultipliers;
  annualisationMeta?: AnnualisationMeta;
  // From the comparables' own histories (report/all path only). All optional:
  // reports saved before these existed lack them, and every reader validates
  // through the `read*` helpers in src/lib/comps before use.
  /** Airbtics' total listing count for the ±r box of the report's bounds call. Display only. */
  listingsNearby?: ListingsNearby;
  /** Percentiles of the displayed comparables, plus a month-by-month band. */
  earningsRange?: EarningsRange;
  /** Latest 12 months vs the 12 before, on a matched sample of comps. */
  localTrend?: LocalTrend;
  /** Nights per booking by calendar month. */
  stayProfile?: StayProfile;
  /** The forecast's own occupancy per calendar month, 0–1, Jan..Dec. */
  monthlyOccupancy?: number[];
}

// ─── Long-Term Let Data ──────────────────────────────────────────
export interface LongLetComparable {
  address: string;
  rent: number;
  distance: number;
  bedrooms: number;
}

export interface LongLetData {
  monthlyRent: number;
  estimateHigh: number;
  estimateLow: number;
  comparables: LongLetComparable[];
}

// ─── Nearby Amenities & Events ───────────────────────────────────
export interface NearbyAmenity {
  name: string;
  type: string;
  address: string;
  distance: number;
  rating: number | null;
}

export interface NearbyEvent {
  name: string;
  date: string;
  time: string;
  venue: string;
  category: string;
  genre: string;
  distance: number | null;
  url: string;
}

// ─── Demand Drivers ──────────────────────────────────────────────
export interface DemandDrivers {
  hospitals: NearbyAmenity[];
  universities: NearbyAmenity[];
  airports: NearbyAmenity[];
  trainStations: NearbyAmenity[];
  busStations: NearbyAmenity[];
  subwayStations: NearbyAmenity[];
}

// ─── Risk Profile ────────────────────────────────────────────────
export type RiskLevel = 'low' | 'moderate' | 'high';

export interface RiskProfile {
  incomeVolatility: RiskLevel;
  setupCost: RiskLevel;
  regulatory: RiskLevel;
  guestDamage: RiskLevel;
  seasonality: RiskLevel;
  platformDependency: RiskLevel;
  locationDemand: RiskLevel;
  competition: RiskLevel;
  overallScore: number;
}

// ─── Financial Summary ───────────────────────────────────────────
export interface FinancialSummary {
  shortLetGrossAnnual: number;
  shortLetNetAnnual: number;
  longLetGrossAnnual: number;
  longLetNetAnnual: number;
  monthlyDifference: number;
  annualDifference: number;
  breakEvenOccupancy: number;
}

// ─── Property Verdict ────────────────────────────────────────────
export type VerdictFit = 'strong' | 'moderate' | 'weak';

export interface PropertyVerdict {
  fit: VerdictFit;
  netDifference: number;
  riskLevel: RiskLevel;
  ownerInvolvement: RiskLevel;
  recommendation: string;
}

// ─── Data Quality ────────────────────────────────────────────────
export interface DataQuality {
  comparablesFound: number;
  comparablesTarget: number; // 12
  searchRadiusKm: number;
  searchBroadened: boolean;
  level: 'high' | 'moderate' | 'low';
  disclaimer: string | null;
}

// ─── PropertyData Sale Valuation ─────────────────────────────────
export interface PropertyDataValuation {
  estimatedValue: number;       // point estimate
  valuationRangeLow: number;    // estimate − margin (±15% when no margin was returned)
  valuationRangeHigh: number;   // estimate + margin
  /** PropertyData's own ± figure, GBP; absent on reports saved before it was read. */
  margin?: number | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  source: 'propertydata';
}

// ─── PropertyData due diligence (EPC, flood, designations, exit liquidity) ──
export interface EpcResult {
  /** A to G. */
  rating: string;
  score: number | null;
  inspectionDate: string | null;
  /** The register's own wording of the address that matched. */
  address: string;
  matched: 'address' | 'house-number';
}

export interface DueDiligence {
  postcode: string;
  outcode: string | null;
  floodRisk: { level: string; high: boolean } | null;
  conservationArea: Designation | null;
  greenBelt: Designation | null;
  aonb: Designation | null;
  nationalPark: Designation | null;
  /** The nearest listed buildings; `possiblyListed` when one is within ~80 m. */
  listedBuildings: { nearest: ListedBuilding[]; possiblyListed: boolean } | null;
  /** How the outcode's sales and rental markets are moving: the exit if short-letting stops. */
  exitLiquidity: { sale: DemandSnapshot | null; rent: DemandSnapshot | null };
  fetchedAt: string;
}

// ─── Historic price growth for the outcode (PropertyData region key stats) ──
export interface OutcodeGrowth {
  outcode: string;
  /** PropertyData region the figures were read from. */
  region: string;
  avgPrice: number | null;
  avgYieldPct: number | null;
  /** Year-on-year price growth, percent, over the period. */
  growth1y: number | null;
  growth3y: number | null;
  growth5y: number | null;
  growth7y: number | null;
  salesPerMonth: number | null;
  turnoverPct: number | null;
  /** When the region's stats were bought. */
  asOf: string | null;
}

/** A value range projected from historic growth: an assumption, never a forecast. */
export interface FutureValueRange {
  baseValue: number;
  basis: 'asking-price' | 'estimated-value';
  horizonYears: number;
  /** The outcode's historic growth over the same number of years, percent. */
  historicGrowthPct: number;
  /** That growth annualised, percent: the top end repeats it. */
  annualisedPct: number;
  /** Half the annualised rate, capped at 3% and floored at 0%: the low end. */
  haircutAnnualPct: number;
  high: number;
  low: number;
  outcode: string;
  asOf: string | null;
}

// ─── Cross-validation against secondary STR data source ───────────
export type CrossValidationConfidence = 'high' | 'medium' | 'low' | 'unverified';

export interface CrossValidation {
  // Which source produced the headline (shortLet.* values)
  source: 'pricelabs_revenue_estimator_v2' | 'airbtics_v4_aggregation';
  confidence: CrossValidationConfidence;
  // Both estimates if both ran successfully (for transparency)
  airbticsRevenue: number;
  priceLabsRevenue: number | null;
  // PriceLabs 25th–75th percentile range
  rangeLow: number | null;
  rangeHigh: number | null;
  priceLabsListings: number | null;
  divergencePct: number | null;
  note: string;
}

// ─── Listing links (Rightmove / OnTheMarket / Airbnb …) ──────────
import type { Deal, CashflowMonth } from './listing/deal';
import type { CouncilTaxFigure } from './listing/bills';
import type { DemandSnapshot, Designation, ListedBuilding } from './apis/propertydata-parse';
import type { CompetitorSummary, TrackedListing } from './listing/competitors';
import type { SecondOpinion } from './listing/quick-types';

export interface SourceListingRef {
  url: string;
  source: 'rightmove' | 'onthemarket' | 'zoopla' | 'airbnb' | 'booking';
  kind: 'sale' | 'rent' | 'str';
  title?: string;
  photo?: string;
  price?: { amount: number; period: 'total' | 'pcm' | 'pw' | 'night' };
}

export type DealResult = Deal & { basis: 'asking-price' | 'advertised-rent' | 'estimated-value' };

export interface CompetitorsResult {
  summary: CompetitorSummary;
  top: TrackedListing[];
  /** The pasted Airbnb listing's own tracked figures, when a provider has them. */
  tracked: TrackedListing | null;
  trackedMissing: boolean;
  provider: string | null;
  updatedAt: string | null;
}

// ─── Full Analysis Result ────────────────────────────────────────
export interface AnalysisResult {
  property: PropertyInput;
  coordinates: { lat: number; lng: number };
  shortLet: ShortLetData;
  longLet: LongLetData;
  demandDrivers: DemandDrivers;
  nearbyEvents: { events: NearbyEvent[]; totalEvents: number };
  financials: FinancialSummary;
  dataQuality: DataQuality;
  risk: RiskProfile;
  verdict: PropertyVerdict;
  createdAt: string;
  updatedAt: string;
  // PriceLabs cross-validation, if available. confidence='unverified'
  // means PriceLabs was not consulted (key missing or call failed).
  crossValidation?: CrossValidation;
  // PropertyData estimated sale value. null if the call failed or key is missing.
  propertyValuation?: PropertyDataValuation | null;
  /** The property's council tax band and charge (PropertyData); null when the band could not be priced. */
  councilTax?: CouncilTaxFigure | null;
  /** The address's EPC from the register (via PropertyData); null when no certificate matched. */
  epc?: EpcResult | null;
  /** Flood risk, planning designations, listed buildings and exit liquidity; null when none came back. */
  dueDiligence?: DueDiligence | null;
  /** Historic price growth for the outcode; null when the region's stats were not in the cache. */
  growth?: OutcodeGrowth | null;
  /** Value in five years from that growth; null without a growth figure or a price. */
  futureValue?: FutureValueRange | null;
  // ── Listing-link additions (all optional; older reports simply lack them) ──
  sourceListing?: SourceListingRef | null;
  deal?: DealResult | null;
  cashflow?: CashflowMonth[] | null;
  competitors?: CompetitorsResult | null;
  secondOpinion?: (SecondOpinion & { provider: 'pmi'; updatedAt: string | null }) | null;
  /**
   * Set only on an ENHANCED run whose second opinion could not be fetched.
   * Optional, so every report stored before this existed stays valid.
   *
   * Its presence is the difference between a standard report and an enhanced
   * one that silently became a standard report — see
   * src/lib/analysis/enhanced-notice.ts.
   */
  enhancedNotice?: EnhancedNotice | null;
  /** Row id in saved_searches once the report has been persisted. */
  reportId?: string;
}
