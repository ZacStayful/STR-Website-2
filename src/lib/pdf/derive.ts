import type {
  AnalysisResult,
  RiskLevel,
  ShortLetComparable,
} from "@/lib/types";
import { directBookingScore as computeDirectBookingScore, overallRiskScore100, riskFactors100 } from "@/lib/scores";

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

/**
 * The user's effective expense formula from the estimate page. Mirrors the
 * "Customise expenses" panel so the PDF reproduces exactly what's on screen.
 * All values are already resolved (e.g. mgmtPct is 0 when self-managed).
 */
export interface PdfExpenses {
  platformPct: number;
  mgmtPct: number;
  cleaningMonthly: number | null; // null → default 18% of gross / 12
  selfManaged: boolean;
}

export interface PdfDeal {
  kind: "purchase" | "rent-to-rent";
  basisLabel: string;
  sourceUrl: string | null;
  metrics: { label: string; value: string; sub?: string }[];
  cashflow: { month: number; revenue: number; operating: number; fixed: number; net: number }[];
  note: string;
}

export interface PdfReportData {
  property: { address: string; bedrooms: number; sleeps: number };
  /** Deal economics when the report came from a listing (or an estimated value). */
  deal?: PdfDeal;
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
    // Percentage labels (of gross) so the PDF breakdown stays in sync with the
    // adjustable expenses, plus a flag for the self-managed case where the
    // management fee is removed entirely.
    platformPct: number;
    managementPct: number;
    cleaningPct: number;
    totalCostsPct: number;
    selfManaged: boolean;
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

export function deriveReportData(result: AnalysisResult, expenses?: PdfExpenses): PdfReportData {
  const { property, shortLet, longLet, financials, risk, demandDrivers, nearbyEvents, propertyValuation, dataQuality } = result;

  // ── Overview ──
  const grossAnnual = financials.shortLetGrossAnnual;

  // ── Expense formula ──
  // Mirror the estimate page's "Customise expenses" panel. Defaults reproduce
  // the standard 15% platform + 15% management + 18% cleaning = 48% model, so
  // a PDF generated without overrides matches the previous output exactly.
  const platformPct = expenses?.platformPct ?? 15;
  const mgmtPct = expenses?.mgmtPct ?? 15; // already 0 when self-managed
  const cleaningMonthly = expenses?.cleaningMonthly
    ?? Math.max(0, Math.round((grossAnnual / 12) * 0.18));
  const cleaningAnnual = cleaningMonthly * 12;
  const selfManaged = expenses?.selfManaged ?? false;

  const platformFeeAnnual = Math.round(grossAnnual * (platformPct / 100));
  const mgmtFeeAnnual = Math.round(grossAnnual * (mgmtPct / 100));
  const totalCostsAnnual = platformFeeAnnual + mgmtFeeAnnual + cleaningAnnual;
  const netAnnual = Math.max(0, grossAnnual - platformFeeAnnual - mgmtFeeAnnual - cleaningAnnual);
  const cleaningPct = grossAnnual > 0 ? Math.round((cleaningAnnual / grossAnnual) * 100) : 0;
  const totalCostsPct = grossAnnual > 0 ? Math.round((totalCostsAnnual / grossAnnual) * 100) : 0;

  const ltlGross = financials.longLetGrossAnnual;
  const ltlNet = financials.longLetNetAnnual;

  // ── Monthly forecast (derived from gross monthlyRevenue + occupancy from scenarios if present) ──
  const scenarioBase = shortLet.scenarios?.base?.monthly;
  const ltlNetMonthly = ltlNet / 12;

  // Per-month net mirrors the estimate page: platform/management are % of that
  // month's revenue, cleaning is a flat monthly figure deducted equally.
  const monthlyNet: number[] = shortLet.monthlyRevenue.map((gross) =>
    Math.max(0, Math.round(gross - gross * (platformPct / 100) - gross * (mgmtPct / 100) - cleaningMonthly)),
  );
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

  // ── Direct booking score (shared with dashboard + presentation) ──
  const directBookingScore = computeDirectBookingScore(result);

  // ── Risk profile — same four factors and mapping as the dashboard ──
  const rf = riskFactors100(risk);
  const riskFactors = {
    revenueConsistency: rf[0].score,
    longTermComparison: rf[1].score,
    seasonalVariance: rf[2].score,
    marketDemand: rf[3].score,
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
      platformFee: platformFeeAnnual,
      managementFee: mgmtFeeAnnual,
      cleaning: cleaningAnnual,
      totalCosts: totalCostsAnnual,
      net: netAnnual,
      platformPct,
      managementPct: mgmtPct,
      cleaningPct,
      totalCostsPct,
      selfManaged,
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
      overall: overallRiskScore100(risk),
      label: overallRiskLabel(overallRiskScore100(risk)),
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

/** Builds the deal page data from the listing-link additions on a result. */
export function buildPdfDeal(result: AnalysisResult): PdfDeal | undefined {
  const d = result.deal;
  if (!d) return undefined;
  const cashflow = (result.cashflow ?? []).map((m) => ({ month: m.month, revenue: m.revenue, operating: m.operating, fixed: m.fixed, net: m.net }));
  return pdfDealFrom(d, result.sourceListing?.url ?? null, cashflow);
}

/** Same page data from a bare deal (used by the shareable deal sheet, which has no monthly series). */
export function pdfDealFrom(d: NonNullable<AnalysisResult["deal"]>, sourceUrl: string | null, cashflow: PdfDeal["cashflow"]): PdfDeal {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const basisLabel =
    d.basis === "asking-price" ? `Based on the asking price of ${gbp(d.kind === "purchase" ? d.askingPrice : 0)}`
    : d.basis === "advertised-rent" ? `Based on the advertised rent of ${gbp(d.kind === "rent-to-rent" ? d.advertisedRentPcm : 0)} pcm`
    : `Based on the estimated property value of ${gbp(d.kind === "purchase" ? d.askingPrice : 0)}`;
  if (d.kind === "purchase") {
    return {
      kind: "purchase",
      basisLabel,
      sourceUrl,
      metrics: [
        { label: "Gross yield", value: `${d.grossYieldPct}%`, sub: `on ${gbp(d.askingPrice)}` },
        { label: "Net yield", value: `${d.netYieldPct}%`, sub: "after running costs" },
        { label: "Monthly cashflow", value: `${d.cashflowMonthly < 0 ? "-" : ""}${gbp(Math.abs(d.cashflowMonthly))}`, sub: `after ${gbp(d.mortgageMonthly)} mortgage` },
        { label: "Cash on cash", value: `${d.cashOnCashPct}%`, sub: `on ${gbp(d.cashRequired)} in` },
        { label: "Stamp duty", value: gbp(d.stampDuty), sub: "additional-property rate" },
        { label: "Setup budget", value: gbp(d.setupCost) },
        { label: `Max price for ${d.targetYieldPct}% yield`, value: gbp(d.maxPriceForTargetYield) },
        { label: "Net operating / yr", value: gbp(d.netOperating), sub: "before mortgage" },
      ],
      cashflow,
      note: "Yield and cashflow use this report's gross revenue less 15% platform fees, 15% management, 18% cleaning and £250 a month bills; mortgage assumes the deposit, rate and term in your Stayful goal profile. Stamp duty is the England and Northern Ireland additional-property rate. Not financial advice.",
    };
  }
  return {
    kind: "rent-to-rent",
    basisLabel,
    sourceUrl,
    metrics: [
      { label: "Monthly margin", value: `${d.monthlyMargin < 0 ? "-" : ""}${gbp(Math.abs(d.monthlyMargin))}`, sub: `after ${gbp(d.advertisedRentPcm)} rent` },
      { label: "Annual margin", value: `${d.annualMargin < 0 ? "-" : ""}${gbp(Math.abs(d.annualMargin))}` },
      { label: "Breakeven occupancy", value: d.breakevenOccupancyPct === null ? "—" : `${d.breakevenOccupancyPct}%`, sub: "covers rent and bills" },
      { label: "Payback of setup", value: d.paybackMonths === null ? "Never" : `${d.paybackMonths} months`, sub: `${gbp(d.setupCost)} setup` },
      { label: "Monthly gross", value: gbp(d.monthlyGross) },
      { label: "Running costs", value: gbp(d.monthlyOperating), sub: "platform, management, cleaning, bills" },
      { label: "Net before rent", value: gbp(d.monthlyNetBeforeRent) },
      { label: `Max rent for ${gbp(d.targetMarginPcm)} margin`, value: gbp(d.maxRentForTargetMargin) },
    ],
    cashflow,
    note: "Rent-to-rent needs the landlord's written consent to sub-let, a lease that allows it and the lender's and insurer's agreement, and must follow the council's short-let rules. Figures use this report's gross revenue less 15% platform fees, 15% management, 18% cleaning and £250 a month bills. Not financial advice.",
  };
}
