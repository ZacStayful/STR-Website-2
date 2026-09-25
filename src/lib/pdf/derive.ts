import type { AnalysisResult, ShortLetComparable } from "@/lib/types";
import { directBookingScore as computeDirectBookingScore, overallRiskScore100, riskFactors100 } from "../scores.ts";
import { scoreAmenities, differentiatorPremium, type AmenityStat } from "./amenities.ts";
import { splitAddress, formatIssued } from "./format.ts";
import { liveMortgageRateLabel } from "../listing/mortgage-rate.ts";
import { diligenceNotes } from "../analysis/due-diligence.ts";
import { futureValueSentence } from "../listing/growth.ts";
import type { PdfBrand } from "./theme";
import { bandPositions, beatTargets, earningsRangeOf, estimatePosition, MIN_TOP_BADGE_LISTINGS, topQuarterThreshold, type AnnualEarningsRange, type EstimatePosition } from "../comps/earnings.ts";
import { readLocalTrend, trendShort } from "../comps/local-trend.ts";
import { comparablesSourceLine, readListingsNearby } from "../comps/nearby.ts";
import { readMonthlyOccupancy, readStayProfile, reportAvgStayNights, turnoversByMonth } from "../comps/stays.ts";

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

export interface PdfAmenity {
  name: string;
  /** 1-5. How many nearby listings already have it. */
  score: number;
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
  /** Where the value might go, from the outcode's historic growth; absent without a growth figure. */
  growthLine?: string;
}

export interface PdfLiquidity {
  rating: string | null;
  daysOnMarket: number | null;
  total: number | null;
  perMonth: number | null;
  monthsOfInventory: number | null;
}

export interface PdfGrowth {
  outcode: string;
  g1y: number | null;
  g3y: number | null;
  g5y: number | null;
  g7y: number | null;
  /** The future-value sentence (`futureValueSentence`), or null without a price. */
  rangeLine: string | null;
}

/** The due diligence page: registers, council tax, stamp duty, liquidity and growth. */
export interface PdfDiligence {
  epc: { rating: string; score: number | null; inspected: string | null } | null;
  floodRisk: { level: string; high: boolean } | null;
  councilTax: { band: string; annual: number; council: string | null } | null;
  stampDuty: { name: string; amount: number; ratePct: number | null; live: boolean } | null;
  designations: { label: string; status: "inside" | "outside" | "unknown"; detail: string | null }[];
  listed: { possiblyListed: boolean; nearest: { name: string; grade: string | null; distance: string }[] } | null;
  liquidity: { sale: PdfLiquidity | null; rent: PdfLiquidity | null } | null;
  growth: PdfGrowth | null;
  notes: string[];
}

export interface PdfReportData {
  property: {
    address: string;
    bedrooms: number;
    sleeps: number;
    postcode: string;
    /** Street line, with the town split off for the running header. */
    addressLine: string;
    /** Town, outward code, or empty when neither is known. */
    locality: string;
  };
  /**
   * `DD.MM.YYYY`, from the analysis's own creation date. Never the clock: the
   * prospect's report link re-renders on every click, and a wall-clock date
   * would change each time they opened it.
   */
  issuedAt: string | null;
  /** Who the report was produced for. Omitted from the page when absent. */
  preparedFor?: string;
  /**
   * Whose report this is. Absent for the members-only analyser, which keeps
   * the Stayful chrome; a funnel supplies its customer's.
   */
  brand?: PdfBrand;
  /** Deal economics when the report came from a listing (or an estimated value). */
  deal?: PdfDeal;
  /** Present only when the analysis carried any register data. */
  diligence?: PdfDiligence;
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
    essential: PdfAmenity[];
    recommended: PdfAmenity[];
    differentiators: PdfAmenity[];
    /**
     * The nightly-rate premium observed across the differentiators, or null
     * when too few comparables sat either side of the split to say.
     */
    premium: { low: number; high: number } | null;
    /** False when the comparables carried no amenity data and this is the
     *  standing recommendation rather than a reading of this market. */
    derived: boolean;
  };
  growth: {
    directBookingPctMonth36: number;
    /** Null when no comparable reported bookings, so stay length is unknown. */
    repeatCustomers: number | null;
    platformFeeSavingsPct: number;
    extraMonthlyProfitYr3: number;
    /** Measured from the comparables' booking counts. Null when unavailable. */
    avgStayNights: number | null;
  };
  /** "12 comparables from about 115 Airbnb listings within about 200 m". */
  compsLead: string;
  /** What similar listings earn, and where our estimate sits. Null below six comps. */
  earnings: {
    range: AnnualEarningsRange;
    estimate: number;
    position: EstimatePosition | null;
    positions: { p25: number; p50: number; p75: number; p90: number | null; estimate: number };
  } | null;
  /** Latest 12 months vs the 12 before, PDF-length. Null on older reports. */
  localTrend: string | null;
  /** Nights per stay and changeovers, Jan..Dec. Null on older reports. */
  stays: {
    months: { month: string; nights: number | null; changeovers: number | null }[];
    annualNights: number | null;
    annualChangeovers: number | null;
  } | null;
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

/** The comp revenue at which the top 25% start (shared with the web page). */
function topRevenueThreshold(comps: ShortLetComparable[]): number {
  if (comps.length < MIN_TOP_BADGE_LISTINGS) return Infinity;
  return topQuarterThreshold(comps.map((c) => c.annualRevenue)) ?? Infinity;
}

function formatDistance(km: number | undefined): string {
  if (km === undefined || Number.isNaN(km)) return "—";
  return `${km.toFixed(2)} km`;
}

export function deriveReportData(result: AnalysisResult, expenses?: PdfExpenses): PdfReportData {
  const { property, shortLet, financials, risk, demandDrivers, nearbyEvents, propertyValuation, dataQuality } = result;

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

  // Occupancy per month: the forecast's own (stored since it was kept), else
  // the base scenario's (a 0–100 percentage), else the annual rate.
  const storedOcc = readMonthlyOccupancy(shortLet.monthlyOccupancy);
  const monthly: PdfMonth[] = shortLet.monthlyRevenue.map((_, i) => {
    const net = monthlyNet[i];
    const scenarioOcc = scenarioBase?.[i]?.occupancy;
    const occ = storedOcc?.[i] ?? (typeof scenarioOcc === "number" ? scenarioOcc / 100 : shortLet.occupancyRate);
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
  // Match = benchmark mean. Beat = where the top 25% start (interpolated 75th
  // percentile of each signal) — the same definition as the web page.
  const beat = beatTargets(shortLet.comparables);
  const beatNightly = beat?.nightly || compsBenchmark.avgNightly;
  const beatOccupancy = beat?.occupancy || compsBenchmark.avgOccupancy;
  const beatRevenue = beat?.revenue || compsBenchmark.avgAnnual;

  // ── What similar listings earn (stored range, or derived from the comps) ──
  const range = earningsRangeOf(shortLet).annual;
  const earnings = range
    ? {
        range,
        estimate: grossAnnual,
        position: estimatePosition(annualValues, grossAnnual),
        positions: bandPositions(range, grossAnnual),
      }
    : null;
  const trend = readLocalTrend(shortLet.localTrend);
  const compsLead = comparablesSourceLine({
    comparables: shortLet.comparables.length,
    radiusKm: dataQuality?.searchRadiusKm ?? 0,
    nearby: readListingsNearby(shortLet.listingsNearby),
  });

  // ── Demand drivers ──
  //
  // Ordered transport, events, education, healthcare: that is roughly their
  // strength as a reason a guest books, and the page reads left to right.
  // Counts carry their unit so a card never reads just "3".
  const drivers: PdfDemandDriver[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const transport = [...demandDrivers.trainStations, ...demandDrivers.busStations, ...demandDrivers.subwayStations, ...demandDrivers.airports]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
  if (transport.length > 0) {
    drivers.push({
      type: "Transport Links",
      nearest: transport[0].name,
      distance: formatDistance(transport[0].distance),
      count: plural(transport.length, "link", "links"),
      impact: transport.length >= 3 ? "HIGH" : "MEDIUM",
    });
  }
  if (nearbyEvents.totalEvents > 0) {
    const nearest = nearbyEvents.events[0];
    drivers.push({
      type: "Events & Entertainment",
      nearest: nearest?.venue ?? "Local venues",
      distance: nearest?.distance !== null && nearest?.distance !== undefined ? formatDistance(nearest.distance) : "—",
      count: plural(nearbyEvents.totalEvents, "event", "events"),
      impact: nearbyEvents.totalEvents >= 100 ? "HIGH" : "MEDIUM",
    });
  }
  if (demandDrivers.universities.length > 0) {
    drivers.push({
      type: "Educational Institutions",
      nearest: demandDrivers.universities[0].name,
      distance: formatDistance(demandDrivers.universities[0].distance),
      count: plural(demandDrivers.universities.length, "institution", "institutions"),
      impact: "HIGH",
    });
  }
  if (demandDrivers.hospitals.length > 0) {
    drivers.push({
      type: "Healthcare Facilities",
      nearest: demandDrivers.hospitals[0].name,
      distance: formatDistance(demandDrivers.hospitals[0].distance),
      count: plural(demandDrivers.hospitals.length, "facility", "facilities"),
      impact: "HIGH",
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

  // ── Amenities, read from the comparable set ──
  //
  // What the market already expects, and what would set this listing apart,
  // is a fact about the neighbours rather than an opinion — so it comes from
  // how many of them carry each amenity. Comparables stored before the
  // amenity map was captured have nothing to read, and fall back to the
  // standing recommendation rather than showing an empty section.
  const amenityRead = scoreAmenities(
    shortLet.comparables.map((c) => ({
      amenities: c.amenities ?? null,
      nightly: c.averageDailyRate,
    })),
  );
  const asPdfAmenity = (a: AmenityStat) => ({ name: a.name, score: a.score });
  const amenities = amenityRead
    ? {
        essential: amenityRead.essential.map(asPdfAmenity),
        recommended: amenityRead.edge.map(asPdfAmenity),
        differentiators: amenityRead.differentiators.map(asPdfAmenity),
        premium: differentiatorPremium(amenityRead.differentiators),
        derived: true,
      }
    : {
        essential: [{ name: "WiFi", score: 5 }, { name: "Kitchen", score: 5 }],
        recommended: [
          { name: "Garden", score: 3 },
          { name: "Workspace", score: 2 },
          { name: "Free parking", score: 1 },
          { name: "Smart TV", score: 1 },
        ],
        differentiators: [
          { name: "Hot tub", score: 1 },
          { name: "EV charger", score: 1 },
          { name: "Pet friendly", score: 1 },
          { name: "Self check-in", score: 1 },
          { name: "Pool", score: 1 },
        ],
        premium: null,
        derived: false,
      };

  // ── Growth, scaled to this property ──
  //
  // The direct-booking share is the 30-50% band the location page quotes,
  // positioned by this property's own direct-booking score. The fee saved is
  // simply the fee the owner is actually paying.
  const directBookingPct = Math.round(30 + (directBookingScore / 100) * 20);
  const netMonthly = netAnnual / 12;
  const extraMonthlyProfitYr3 = Math.round(netMonthly * (platformPct / 100) * (directBookingPct / 100));

  // Average stay length from the comparables' real booking counts: booked
  // nights divided by bookings. Without it there is no honest way to turn
  // occupancy into a number of guests.
  // Newer reports carry a month-by-month profile pooled across the comps'
  // histories; older ones fall back to each comp's annual figures.
  const avgStayNights = reportAvgStayNights(shortLet);
  const stayProfile = readStayProfile(shortLet.stayProfile);
  const turnovers = stayProfile
    ? turnoversByMonth({ monthlyOccupancy: storedOcc, occupancyRate: shortLet.occupancyRate, profile: stayProfile })
    : null;
  const stays = stayProfile && turnovers
    ? {
        months: turnovers.months.map((m, i) => ({ month: MONTH_NAMES[i], nights: stayProfile.months[i], changeovers: m.turnovers })),
        annualNights: stayProfile.annual,
        annualChangeovers: turnovers.annual,
      }
    : null;

  // Repeat guests over three years. Every input is measured except the repeat
  // rate, which tracks the direct-booking score: the same things that make a
  // location easy to book direct make guests easy to win back.
  const repeatRate = 0.20 + (directBookingScore / 100) * 0.15;
  const annualStays = avgStayNights
    ? (365 * Math.max(0, Math.min(1, shortLet.occupancyRate))) / avgStayNights
    : null;
  const repeatCustomers = annualStays
    ? Math.round(3 * annualStays * repeatRate)
    : null;

  const growth = {
    directBookingPctMonth36: directBookingPct,
    repeatCustomers,
    platformFeeSavingsPct: platformPct,
    extraMonthlyProfitYr3,
    avgStayNights: avgStayNights ? Math.round(avgStayNights * 10) / 10 : null,
  };

  const annualDiff = netAnnual - ltlNet;
  const monthlyDiff = Math.round(annualDiff / 12);
  const percentUplift = ltlNet > 0 ? Math.round((annualDiff / ltlNet) * 100) : 0;

  // The geocoder's town when the analysis captured one; otherwise the address
  // is parsed, which is what older saved reports rely on.
  const parsed = splitAddress(property.address, property.postcode);

  return {
    property: {
      address: property.address,
      bedrooms: property.bedrooms,
      sleeps: property.guests,
      postcode: property.postcode,
      addressLine: parsed.line1,
      locality: property.locality ?? parsed.locality,
    },
    issuedAt: formatIssued(result.createdAt) ?? formatIssued(result.updatedAt),
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
    compsLead,
    earnings,
    localTrend: trend ? trendShort(trend) : null,
    stays,
  };
}

export function sanitiseAddressForFilename(address: string): string {
  return address
    .replace(/[^a-zA-Z0-9 ,\-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "Property";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Jan 2023" from a YYYY-MM-DD date, read as a calendar date (no time zone), or null. */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/**
 * The due diligence page, from the register data the analysis stored.
 * Undefined when there is none, so older reports keep their page count.
 */
export function buildPdfDiligence(result: AnalysisResult): PdfDiligence | undefined {
  const dd = result.dueDiligence ?? null;
  const epc = result.epc ?? null;
  const ct = result.councilTax ?? null;
  const growth = result.growth ?? null;
  if (!dd && !epc && !ct && !growth) return undefined;
  const deal = result.deal && result.deal.kind === "purchase" ? result.deal : null;

  const designation = (label: string, d: { inside: boolean; name: string | null } | null | undefined) => ({
    label,
    status: d ? (d.inside ? ("inside" as const) : ("outside" as const)) : ("unknown" as const),
    detail: d?.name ?? null,
  });
  const liquidity = (d: { rating: string | null; daysOnMarket: number | null; total: number | null; perMonth: number | null; monthsOfInventory: number | null } | null | undefined): PdfLiquidity | null =>
    d ? { rating: d.rating, daysOnMarket: d.daysOnMarket, total: d.total, perMonth: d.perMonth, monthsOfInventory: d.monthsOfInventory } : null;

  const notes = diligenceNotes(result);

  return {
    epc: epc ? { rating: epc.rating, score: epc.score, inspected: shortDate(epc.inspectionDate) } : null,
    floodRisk: dd?.floodRisk ?? null,
    councilTax: ct ? { band: ct.band, annual: Math.round(ct.annual), council: ct.council } : null,
    stampDuty: deal
      ? { name: deal.stampDutyName ?? "SDLT", amount: deal.stampDuty, ratePct: deal.stampDutyEffectiveRatePct ?? null, live: deal.stampDutySource === "propertydata" }
      : null,
    designations: dd
      ? [
          designation("Conservation area", dd.conservationArea),
          designation("Green belt", dd.greenBelt),
          designation("Area of Outstanding Natural Beauty", dd.aonb),
          designation("National park", dd.nationalPark),
        ]
      : [],
    listed: dd?.listedBuildings
      ? {
          possiblyListed: dd.listedBuildings.possiblyListed,
          nearest: dd.listedBuildings.nearest.map((b) => ({ name: b.name, grade: b.grade, distance: b.distanceMiles !== null ? `${b.distanceMiles.toFixed(2)} mi` : "—" })),
        }
      : null,
    liquidity: dd ? { sale: liquidity(dd.exitLiquidity.sale), rent: liquidity(dd.exitLiquidity.rent) } : null,
    growth: growth
      ? {
          outcode: growth.outcode,
          g1y: growth.growth1y,
          g3y: growth.growth3y,
          g5y: growth.growth5y,
          g7y: growth.growth7y,
          rangeLine: result.futureValue ? futureValueSentence(result.futureValue) : null,
        }
      : null,
    notes,
  };
}

/** Builds the deal page data from the listing-link additions on a result. */
export function buildPdfDeal(result: AnalysisResult): PdfDeal | undefined {
  const d = result.deal;
  if (!d) return undefined;
  const cashflow = (result.cashflow ?? []).map((m) => ({ month: m.month, revenue: m.revenue, operating: m.operating, fixed: m.fixed, net: m.net }));
  const deal = pdfDealFrom(d, result.sourceListing?.url ?? null, cashflow);
  if (d.kind === "purchase" && result.futureValue) deal.growthLine = futureValueSentence(result.futureValue);
  return deal;
}

/** Same page data from a bare deal (used by the shareable deal sheet, which has no monthly series). */
export function pdfDealFrom(d: NonNullable<AnalysisResult["deal"]>, sourceUrl: string | null, cashflow: PdfDeal["cashflow"]): PdfDeal {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const basisLabel =
    d.basis === "asking-price" ? `Based on the asking price of ${gbp(d.kind === "purchase" ? d.askingPrice : 0)}`
    : d.basis === "advertised-rent" ? `Based on the advertised rent of ${gbp(d.kind === "rent-to-rent" ? d.advertisedRentPcm : 0)} pcm`
    : `Based on the estimated property value of ${gbp(d.kind === "purchase" ? d.askingPrice : 0)}`;
  const bills = d.billsPcm ?? 250;
  if (d.kind === "purchase") {
    const taxName = d.stampDutyName ?? "SDLT";
    const taxWhere = taxName === "LBTT" ? "Scotland's" : taxName === "LTT" ? "Wales's" : "the England and Northern Ireland";
    const mortgage =
      d.mortgageRateSource === "live" && d.mortgageRateLive
        ? `mortgage assumes a ${d.depositPct}% deposit over ${d.termYears} years at the market ${liveMortgageRateLabel(d.mortgageRateLive)}`
        : d.mortgageRateSource === "default"
          ? `mortgage assumes a ${d.depositPct}% deposit over ${d.termYears} years at ${d.mortgageRatePct}%, Stayful's standing assumption (no market average was available)`
          : "mortgage assumes the deposit, rate and term in your Stayful goal profile";
    const councilTax = d.councilTax ? `, of which £${Math.round(d.councilTax.annual / 12)} is band ${d.councilTax.band} council tax` : "";
    return {
      kind: "purchase",
      basisLabel,
      sourceUrl,
      metrics: [
        { label: "Gross yield", value: `${d.grossYieldPct}%`, sub: `on ${gbp(d.askingPrice)}` },
        { label: "Net yield", value: `${d.netYieldPct}%`, sub: "after running costs" },
        { label: "Monthly cashflow", value: `${d.cashflowMonthly < 0 ? "-" : ""}${gbp(Math.abs(d.cashflowMonthly))}`, sub: `after ${gbp(d.mortgageMonthly)} mortgage` },
        { label: "Cash on cash", value: `${d.cashOnCashPct}%`, sub: `on ${gbp(d.cashRequired)} in` },
        { label: "Stamp duty", value: gbp(d.stampDuty), sub: `${taxName}, additional-property rate${d.stampDutySource === "propertydata" ? " (live)" : ""}` },
        { label: "Setup budget", value: gbp(d.setupCost) },
        { label: `Max price for ${d.targetYieldPct}% yield`, value: gbp(d.maxPriceForTargetYield) },
        { label: "Net operating / yr", value: gbp(d.netOperating), sub: "before mortgage" },
      ],
      cashflow,
      note: `Yield and cashflow use this report's gross revenue less 15% platform fees, 15% management, 18% cleaning and £${bills} a month bills${councilTax}; ${mortgage}. Stamp duty is ${taxName} at ${taxWhere} additional-property rate${d.stampDutySource === "propertydata" ? ", from PropertyData's calculator on the report date" : ""}. Not financial advice.`,
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
    note: `Rent-to-rent needs the landlord's written consent to sub-let, a lease that allows it and the lender's and insurer's agreement, and must follow the council's short-let rules. Figures use this report's gross revenue less 15% platform fees, 15% management, 18% cleaning and £${bills} a month bills${d.councilTax ? ` (band ${d.councilTax.band} council tax included)` : ""}. Not financial advice.`,
  };
}
