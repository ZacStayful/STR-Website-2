import type {
  AnalysisResult,
  RiskLevel,
  ShortLetComparable,
} from "@/lib/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface PdfMonth {
  month: string;
  net: number;
  vsLtl: number;
  occupancy: number;
  peak: boolean;
}

export interface PdfComparable {
  name: string;
  distance: string;
  nightly: number;
  occupancy: number;
  annual: number;
  rating: number;
  top: boolean;
}

export interface PdfDemandDriver {
  type: string;
  nearest: string;
  distance: string;
  count: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
}

export interface PdfSetupLineItem {
  id: string;
  name: string;
  supplier: string;
  qty: number;
  unitCost: number;
  total: number;
}

export interface PdfSetupCategory {
  category: string;
  items: PdfSetupLineItem[];
  subtotal: number;
}

export interface PdfSetupSnapshot {
  furnishingLabel: string;
  bedrooms: number;
  itemCount: number;
  grandTotal: number;
  categories: PdfSetupCategory[];
}

export interface PdfReportData {
  property: { address: string; bedrooms: number; sleeps: number };
  overview: {
    grossRevenue: number;
    netRevenue: number;
    grossMonthly: number;
    netMonthly: number;
    adr: number;
    occupancy: number;
    marketOccupancy: number;
    valueConservative: number | null;
    valueUpper: number | null;
  };
  strVsLtl: {
    annualDiff: number;
    monthlyDiff: number;
    percentUplift: number;
  };
  shortLetAnnual: {
    gross: number;
    platformFee: number;
    managementFee: number;
    cleaning: number;
    totalCosts: number;
    net: number;
  };
  longLetAnnual: {
    gross: number;
    agentFee: number;
    net: number;
  };
  monthly: PdfMonth[];
  comparables: PdfComparable[];
  compsBenchmark: {
    avgNightly: number;
    avgOccupancy: number;
    avgAnnual: number;
    avgRating: number;
    avgReviews: number;
    count: number;
    radiusKm: number;
  };
  marketTargets: {
    matchNightly: number;
    matchOccupancy: number;
    matchRevenue: number;
    beatNightly: number;
    beatOccupancy: number;
    beatRevenue: number;
  };
  demandDrivers: PdfDemandDriver[];
  directBookingScore: number;
  risk: {
    overall: number;
    label: string;
    factors: {
      revenueConsistency: number;
      longTermComparison: number;
      seasonalVariance: number;
      marketDemand: number;
    };
  };
  amenities: {
    essential: string[];
    recommended: string[];
    differentiators: string[];
  };
  growth: {
    directBookingPctMonth36: number;
    repeatCustomers: number;
    platformFeeSavingsPct: number;
    extraMonthlyProfitYr3: number;
  };
  setup?: PdfSetupSnapshot;
}

/**
 * Converts the raw calculator snapshot (active line items + category groups)
 * into the shape the PDF page renders. Returns null if there's nothing to
 * include (zero items or grandTotal === 0).
 */
export function buildSetupSnapshot(raw: {
  furnishing: "fully" | "part" | "unfurnished";
  bedrooms: number;
  items: Array<{
    id: string;
    name: string;
    category: string;
    supplier: string;
    qty: number;
    unitCost: number;
    active: boolean;
  }>;
}): PdfSetupSnapshot | null {
  const FURNISHING_LABELS: Record<string, string> = {
    fully: "Fully Furnished",
    part: "Part Furnished",
    unfurnished: "Unfurnished",
  };
  const active = raw.items.filter((i) => i.active && i.qty > 0 && i.unitCost > 0);
  if (active.length === 0) return null;

  const groups = new Map<string, PdfSetupLineItem[]>();
  for (const it of active) {
    const arr = groups.get(it.category) ?? [];
    arr.push({
      id: it.id,
      name: it.name,
      supplier: it.supplier,
      qty: it.qty,
      unitCost: it.unitCost,
      total: Math.round(it.qty * it.unitCost),
    });
    groups.set(it.category, arr);
  }

  const categories: PdfSetupCategory[] = Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items,
    subtotal: items.reduce((s, i) => s + i.total, 0),
  }));

  const grandTotal = categories.reduce((s, c) => s + c.subtotal, 0);
  return {
    furnishingLabel: FURNISHING_LABELS[raw.furnishing] ?? raw.furnishing,
    bedrooms: raw.bedrooms,
    itemCount: active.length,
    grandTotal,
    categories,
  };
}

function riskLevelToScore(level: RiskLevel): number {
  if (level === "low") return 25;
  if (level === "moderate") return 50;
  return 75;
}

function overallRiskLabel(score: number): string {
  if (score <= 25) return "Low Risk";
  if (score <= 50) return "Low-Medium Risk";
  if (score <= 75) return "Medium-High Risk";
  return "High Risk";
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function topRevenueThreshold(comps: ShortLetComparable[]): number {
  if (comps.length === 0) return Infinity;
  const sorted = [...comps].map((c) => c.annualRevenue).sort((a, b) => a - b);
  return percentile(sorted, 0.75);
}

function formatDistance(km: number | undefined): string {
  if (km === undefined || Number.isNaN(km)) return "—";
  return `${km.toFixed(2)} km`;
}

function directBookingScoreFromSignals(result: AnalysisResult): number {
  const d = result.demandDrivers;
  const events = result.nearbyEvents?.totalEvents ?? 0;
  const raw =
    (d.hospitals?.length ?? 0) * 10 +
    (d.universities?.length ?? 0) * 15 +
    (d.trainStations?.length ?? 0) * 10 +
    (d.subwayStations?.length ?? 0) * 5 +
    (events >= 200 ? 40 : events / 5);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function deriveReportData(result: AnalysisResult): PdfReportData {
  const { property, shortLet, longLet, financials, risk, demandDrivers, nearbyEvents, propertyValuation, dataQuality } = result;

  // ── Overview ──
  const grossAnnual = financials.shortLetGrossAnnual;
  const netAnnual = financials.shortLetNetAnnual;
  const netRatio = grossAnnual > 0 ? netAnnual / grossAnnual : 0.52;
  const ltlGross = financials.longLetGrossAnnual;
  const ltlNet = financials.longLetNetAnnual;

  // ── Monthly forecast (derived from gross monthlyRevenue + occupancy from scenarios if present) ──
  const scenarioBase = shortLet.scenarios?.base?.monthly;
  const ltlNetMonthly = ltlNet / 12;

  const monthlyNet: number[] = shortLet.monthlyRevenue.map((gross) => Math.round(gross * netRatio));
  const peakThreshold = [...monthlyNet].sort((a, b) => b - a)[2] ?? 0; // top-3 cut-off

  const monthly: PdfMonth[] = shortLet.monthlyRevenue.map((_, i) => {
    const net = monthlyNet[i];
    const occ = scenarioBase?.[i]?.occupancy ?? shortLet.occupancyRate;
    return {
      month: MONTH_NAMES[i],
      net,
      vsLtl: Math.round(net - ltlNetMonthly),
      occupancy: Math.max(0, Math.min(1, occ)),
      peak: net >= peakThreshold,
    };
  });

  // ── Comparables ──
  const topThreshold = topRevenueThreshold(shortLet.comparables);
  const comparables: PdfComparable[] = shortLet.comparables.map((c) => ({
    name: c.title,
    distance: formatDistance(c.distance),
    nightly: Math.round(c.averageDailyRate),
    occupancy: c.occupancyRate,
    annual: Math.round(c.annualRevenue),
    rating: c.rating,
    top: c.annualRevenue >= topThreshold,
  }));

  // ── Benchmark (mean of comps) ──
  const nightlyValues = shortLet.comparables.map((c) => c.averageDailyRate);
  const occValues = shortLet.comparables.map((c) => c.occupancyRate);
  const annualValues = shortLet.comparables.map((c) => c.annualRevenue);
  const ratingValues = shortLet.comparables.map((c) => c.rating).filter((r) => r > 0);
  const reviewValues = shortLet.comparables.map((c) => c.reviewCount).filter((n) => n > 0);

  const compsBenchmark = {
    avgNightly: Math.round(mean(nightlyValues)),
    avgOccupancy: mean(occValues),
    avgAnnual: Math.round(mean(annualValues)),
    avgRating: Number(mean(ratingValues).toFixed(1)),
    avgReviews: Math.round(mean(reviewValues)),
    count: shortLet.comparables.length,
    radiusKm: dataQuality.searchRadiusKm,
  };

  // ── Match vs Beat market targets ──
  // Match = benchmark mean. Beat = 75th percentile of each signal.
  const sortedNightly = [...nightlyValues].sort((a, b) => a - b);
  const sortedOcc = [...occValues].sort((a, b) => a - b);
  const sortedAnnual = [...annualValues].sort((a, b) => a - b);

  const beatNightly = Math.round(percentile(sortedNightly, 0.75)) || compsBenchmark.avgNightly;
  const beatOccupancy = percentile(sortedOcc, 0.75) || compsBenchmark.avgOccupancy;
  const beatRevenue = Math.round(percentile(sortedAnnual, 0.75)) || compsBenchmark.avgAnnual;

  // ── Demand drivers (map to 4-row table) ──
  const drivers: PdfDemandDriver[] = [];
  if (demandDrivers.hospitals.length > 0) {
    drivers.push({
      type: "Healthcare Facilities",
      nearest: demandDrivers.hospitals[0].name,
      distance: formatDistance(demandDrivers.hospitals[0].distance),
      count: String(demandDrivers.hospitals.length),
      impact: "HIGH",
    });
  }
  if (demandDrivers.universities.length > 0) {
    drivers.push({
      type: "Educational Institutions",
      nearest: demandDrivers.universities[0].name,
      distance: formatDistance(demandDrivers.universities[0].distance),
      count: String(demandDrivers.universities.length),
      impact: "HIGH",
    });
  }
  const transport = [...demandDrivers.trainStations, ...demandDrivers.subwayStations, ...demandDrivers.airports]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
  if (transport.length > 0) {
    drivers.push({
      type: "Transport Links",
      nearest: transport[0].name,
      distance: formatDistance(transport[0].distance),
      count: String(transport.length),
      impact: "HIGH",
    });
  }
  if (nearbyEvents.totalEvents > 0) {
    const nearest = nearbyEvents.events[0];
    drivers.push({
      type: "Events & Entertainment",
      nearest: nearest?.venue ?? "Local venues",
      distance: nearest?.distance !== null && nearest?.distance !== undefined ? formatDistance(nearest.distance) : "—",
      count: `${nearbyEvents.totalEvents.toLocaleString()} events`,
      impact: nearbyEvents.totalEvents >= 100 ? "HIGH" : "MEDIUM",
    });
  }

  // ── Direct booking score ──
  const directBookingScore = directBookingScoreFromSignals(result);

  // ── Risk (map 8 levels → 4 numeric factors shown in PDF) ──
  const riskFactors = {
    revenueConsistency: riskLevelToScore(risk.incomeVolatility),
    longTermComparison: riskLevelToScore(risk.platformDependency),
    seasonalVariance: riskLevelToScore(risk.seasonality),
    marketDemand: riskLevelToScore(risk.locationDemand),
  };

  // ── Amenities (Stayful defaults; future: compute from comps) ──
  const amenities = {
    essential: ["WiFi (5/5)", "Kitchen (5/5)"],
    recommended: [
      "Garden (3/5)",
      "Workspace (2/5)",
      "Free Parking (1/5)",
      "Smart TV (1/5)",
    ],
    differentiators: ["Hot Tub", "EV Charger", "Pet Friendly", "Smart Lock", "Pool"],
  };

  // ── Growth (Stayful business defaults) ──
  const growth = {
    directBookingPctMonth36: 50,
    repeatCustomers: 126,
    platformFeeSavingsPct: 15,
    extraMonthlyProfitYr3: Math.round((netAnnual / 12) * 0.15 * 0.80),
  };

  const annualDiff = netAnnual - ltlNet;
  const monthlyDiff = Math.round(annualDiff / 12);
  const percentUplift = ltlNet > 0 ? Math.round((annualDiff / ltlNet) * 100) : 0;

  return {
    property: {
      address: property.address,
      bedrooms: property.bedrooms,
      sleeps: property.guests,
    },
    overview: {
      grossRevenue: grossAnnual,
      netRevenue: netAnnual,
      grossMonthly: Math.round(grossAnnual / 12),
      netMonthly: Math.round(netAnnual / 12),
      adr: Math.round(shortLet.averageDailyRate),
      occupancy: shortLet.occupancyRate,
      marketOccupancy: compsBenchmark.avgOccupancy,
      valueConservative: propertyValuation?.valuationRangeLow ?? null,
      valueUpper: propertyValuation?.valuationRangeHigh ?? null,
    },
    strVsLtl: {
      annualDiff,
      monthlyDiff,
      percentUplift,
    },
    shortLetAnnual: {
      gross: grossAnnual,
      platformFee: Math.round(grossAnnual * 0.15),
      managementFee: Math.round(grossAnnual * 0.15),
      cleaning: Math.round(grossAnnual * 0.18),
      totalCosts: Math.round(grossAnnual * 0.48),
      net: netAnnual,
    },
    longLetAnnual: {
      gross: ltlGross,
      agentFee: Math.round(ltlGross * 0.10),
      net: ltlNet,
    },
    monthly,
    comparables,
    compsBenchmark,
    marketTargets: {
      matchNightly: compsBenchmark.avgNightly,
      matchOccupancy: compsBenchmark.avgOccupancy,
      matchRevenue: compsBenchmark.avgAnnual,
      beatNightly,
      beatOccupancy,
      beatRevenue,
    },
    demandDrivers: drivers,
    directBookingScore,
    risk: {
      overall: risk.overallScore,
      label: overallRiskLabel(risk.overallScore),
      factors: riskFactors,
    },
    amenities,
    growth,
  };
}

export function sanitiseAddressForFilename(address: string): string {
  return address
    .replace(/[^a-zA-Z0-9 ,\-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "Property";
}
