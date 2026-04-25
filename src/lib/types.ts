// ─── Property Input ───────────────────────────────────────────────
export interface PropertyInput {
  address: string;
  postcode: string;
  bedrooms: number;
  guests: number;
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
  rating: number;          // 0-5 scale (converted from 0-100)
  reviewCount: number;
  listingAge: number;      // years, calculated from added_on
  daysAvailable: number;
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
}
