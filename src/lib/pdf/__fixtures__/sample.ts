import type { AnalysisResult, ShortLetComparable, RiskLevel } from "../../types.ts";

/**
 * A realistic analysis for exercising the report.
 *
 * Shared by the unit tests and the sample-render script so both look at the
 * same document. `sampleAnalysis` takes overrides, which is how the degraded
 * cases — no valuation, one comparable, a report saved before amenities were
 * captured — get covered without hand-writing a second fixture each time.
 */

const AMENITY_POOL: Array<[string, number]> = [
  // [key, how many of the twelve comparables have it]
  ["wifi", 12],
  ["kitchen", 12],
  ["heating", 11],
  ["washer", 9],
  ["tv", 8],
  ["dedicated_workspace", 5],
  ["free_parking_on_premises", 4],
  ["patio_or_balcony", 3],
  ["air_conditioning", 2],
  ["hot_tub", 1],
  ["ev_charger", 1],
];

function comparable(i: number): ShortLetComparable {
  const nightly = [155, 88, 190, 213, 133, 172, 138, 138, 257, 162, 237, 238][i] ?? 160;
  const occupancy = [0.57, 0.73, 0.47, 0.58, 0.62, 0.57, 0.43, 0.85, 0.46, 0.17, 0.46, 0.59][i] ?? 0.55;
  const amenities: Record<string, boolean> = {};
  for (const [key, count] of AMENITY_POOL) amenities[key] = i < count;
  const daysAvailable = 300 + (i % 5) * 12;
  return {
    title: [
      "Spacious 2 Bed Apartment | Patio | City Centre",
      "2 bedroom City Centre Apartment",
      "Majestic • Spacious 2-Bed Apt in City Centre",
      "Cntrl location | 3 Br | Contractors, large familys",
      "#117 Modern City Centre Apartment in Leicester",
      "2 Bed City Apartment | Patio | Walk to DMU",
      "Sav Apartments Regent Leicester - 2 Bed Flat",
      "Beautiful City Centre Apartment Private Balcony",
      "Luxury two-bedroom apartment in Leicester Centre",
      "GORGEOUS 2 BED FLAT NEAR MERCURE HOTEL-ENTIRE",
      "Luxury 2 Bed, City Centre, With Free standing Bath",
      "Luxury 2-Bed, City Centre, Incredible Location",
    ][i] ?? `Comparable listing ${i + 1}`,
    url: `https://www.airbnb.co.uk/rooms/${1000 + i}`,
    bedrooms: 2,
    accommodates: 4 + (i % 3),
    averageDailyRate: nightly,
    occupancyRate: occupancy,
    annualRevenue: Math.round(nightly * occupancy * 365),
    distance: 0.15 + i * 0.026,
    rating: [5, 4, 5, 5, 5, 4, 4, 5, 5, 5, 5, 5][i] ?? 4.8,
    reviewCount: 12 + i * 7,
    listingAge: 1 + (i % 4),
    daysAvailable,
    amenityCount: Object.values(amenities).filter(Boolean).length,
    amenities,
    // Booked nights over a plausible stay length, so the derived average lands
    // in the three-to-four night range a city flat actually sees.
    bookings: Math.max(1, Math.round((daysAvailable * occupancy) / (3 + (i % 3) * 0.5))),
  };
}

const lvl = (v: RiskLevel) => v;

export interface SampleOverrides {
  comparables?: ShortLetComparable[];
  /** Drops the PropertyData valuation, so page one hides the value strip. */
  noValuation?: boolean;
  /** Strips the amenity maps, as on a report saved before they were captured. */
  noAmenityData?: boolean;
  /** Strips booking counts, so stay length and repeat guests cannot be derived. */
  noBookings?: boolean;
  /** Removes every demand driver and event. */
  noDemandDrivers?: boolean;
  address?: string;
  locality?: string | null;
}

export function sampleAnalysis(o: SampleOverrides = {}): AnalysisResult {
  let comparables = o.comparables ?? Array.from({ length: 12 }, (_, i) => comparable(i));
  const omit = (c: ShortLetComparable, key: "amenities" | "bookings") => {
    const copy: ShortLetComparable = { ...c };
    delete copy[key];
    return copy;
  };
  if (o.noAmenityData) comparables = comparables.map((c) => omit(c, "amenities"));
  if (o.noBookings) comparables = comparables.map((c) => omit(c, "bookings"));

  const monthlyRevenue: AnalysisResult["shortLet"]["monthlyRevenue"] = [
    2686, 2532, 2546, 2087, 2760, 3061, 3446, 2969, 3288, 2765, 2455, 3236,
  ];

  const grossAnnual = monthlyRevenue.reduce((a, b) => a + b, 0);
  const netAnnual = Math.round(grossAnnual * 0.52);
  const ltlGross = 9516;
  const ltlNet = Math.round(ltlGross * 0.9);

  const amenity = (name: string, type: string, distance: number) => ({
    name, type, address: `${name}, Leicester`, distance, rating: 4.4,
  });

  return {
    property: {
      address: o.address ?? "22 Princess Road West, Leicester, LE1 6TE",
      postcode: "LE1 6TE",
      bedrooms: 2,
      guests: 6,
      ...(o.locality === null ? {} : { locality: o.locality ?? "Leicester" }),
    },
    coordinates: { lat: 52.6297, lng: -1.1301 },
    shortLet: {
      annualRevenue: grossAnnual,
      monthlyRevenue,
      occupancyRate: 0.57,
      averageDailyRate: 164,
      activeListings: 12,
      comparables,
    },
    longLet: {
      monthlyRent: 793,
      estimateHigh: 860,
      estimateLow: 720,
      comparables: [
        { address: "14 Princess Road East", rent: 800, distance: 0.2, bedrooms: 2 },
        { address: "3 Regent Street", rent: 775, distance: 0.4, bedrooms: 2 },
      ],
    },
    demandDrivers: o.noDemandDrivers
      ? { hospitals: [], universities: [], airports: [], trainStations: [], busStations: [], subwayStations: [] }
      : {
          hospitals: [amenity("Glenfield Hospital", "hospital", 4.26), amenity("Leicester Royal Infirmary", "hospital", 1.1), amenity("Spire Leicester", "hospital", 3.4)],
          universities: [amenity("University of Leicester", "university", 0.97), amenity("De Montfort University", "university", 1.2)],
          airports: [],
          trainStations: [amenity("Leicester", "train_station", 0.42), amenity("South Wigston", "train_station", 4.1)],
          busStations: [amenity("Haymarket Bus Station", "bus_station", 0.8), amenity("St Margaret's", "bus_station", 1.3)],
          subwayStations: [],
        },
    nearbyEvents: o.noDemandDrivers
      ? { events: [], totalEvents: 0 }
      : {
          events: [
            { name: "Live at the O2", date: "2026-10-12", time: "19:00", venue: "O2 Academy Leicester", category: "Music", genre: "Rock", distance: 0.62, url: "https://example.com/e/1" },
          ],
          totalEvents: 236,
        },
    financials: {
      shortLetGrossAnnual: grossAnnual,
      shortLetNetAnnual: netAnnual,
      longLetGrossAnnual: ltlGross,
      longLetNetAnnual: ltlNet,
      monthlyDifference: Math.round((netAnnual - ltlNet) / 12),
      annualDifference: netAnnual - ltlNet,
      breakEvenOccupancy: 0.31,
    },
    dataQuality: {
      comparablesFound: comparables.length,
      comparablesTarget: 12,
      searchRadiusKm: 0.57,
      searchBroadened: false,
      level: "high",
      disclaimer: null,
    },
    risk: {
      incomeVolatility: lvl("moderate"),
      setupCost: lvl("low"),
      regulatory: lvl("low"),
      guestDamage: lvl("low"),
      seasonality: lvl("low"),
      platformDependency: lvl("moderate"),
      locationDemand: lvl("low"),
      competition: lvl("moderate"),
      overallScore: 3.5,
    },
    verdict: {
      fit: "strong",
      netDifference: netAnnual - ltlNet,
      riskLevel: lvl("low"),
      ownerInvolvement: lvl("moderate"),
      recommendation: "A strong short-let candidate on current market evidence.",
    },
    createdAt: "2026-09-18T09:30:00.000Z",
    updatedAt: "2026-09-18T09:30:00.000Z",
    ...(o.noValuation
      ? {}
      : {
          propertyValuation: {
            estimatedValue: 130000,
            valuationRangeLow: 110500,
            valuationRangeHigh: 149500,
            source: "propertydata" as const,
          },
        }),
  };
}

/** The setup-calculator snapshot the estimate page hands to the renderer. */
export function sampleSetup(itemCount: "few" | "many" = "few") {
  const base = [
    { id: "soft", name: "Soft furnishings (per room)", category: "Soft Furnishings & Décor", supplier: "Dunelm", qty: 3, unitCost: 300, active: true },
    { id: "paint", name: "Paint (per room)", category: "Soft Furnishings & Décor", supplier: "B&Q", qty: 3, unitCost: 100, active: true },
    { id: "photo", name: "Professional photography", category: "Services", supplier: "Stayful", qty: 1, unitCost: 250, active: true },
    { id: "labour", name: "Labour", category: "Services", supplier: "Stayful", qty: 1, unitCost: 600, active: true },
    { id: "tv", name: "TV & stand", category: "Appliances & Tech", supplier: "Argos", qty: 1, unitCost: 350, active: true },
    { id: "elec", name: "Electrical pack", category: "Appliances & Tech", supplier: "Stayful", qty: 1, unitCost: 330, active: true },
    { id: "kitchen", name: "Kitchen pack (fully stocked)", category: "Kitchen", supplier: "Stayful", qty: 1, unitCost: 350, active: true },
    { id: "keysafe", name: "Keysafes", category: "Other", supplier: "Amazon", qty: 2, unitCost: 15, active: true },
  ];
  const extra = [
    { id: "mattress", name: "Mattresses", category: "Furniture & Beds", supplier: "Dunelm", qty: 2, unitCost: 350, active: true },
    { id: "frames", name: "Bed frames", category: "Furniture & Beds", supplier: "Argos", qty: 2, unitCost: 200, active: true },
    { id: "sofa", name: "Sofa", category: "Furniture & Beds", supplier: "Dunelm", qty: 1, unitCost: 750, active: true },
    { id: "dining", name: "Dining set", category: "Furniture & Beds", supplier: "Argos", qty: 1, unitCost: 250, active: true },
    { id: "linen", name: "Linen sets", category: "Soft Furnishings & Décor", supplier: "Amazon", qty: 6, unitCost: 20, active: true },
    { id: "towels", name: "Towel sets", category: "Soft Furnishings & Décor", supplier: "Amazon", qty: 6, unitCost: 20, active: true },
    { id: "lamps", name: "Lamps & lighting", category: "Soft Furnishings & Décor", supplier: "Dunelm", qty: 4, unitCost: 45, active: true },
    { id: "rugs", name: "Rugs", category: "Soft Furnishings & Décor", supplier: "Dunelm", qty: 3, unitCost: 80, active: true },
    { id: "smoke", name: "Smoke & CO alarms", category: "Other", supplier: "Amazon", qty: 4, unitCost: 25, active: true },
    { id: "extinguish", name: "Fire extinguisher & blanket", category: "Other", supplier: "Amazon", qty: 1, unitCost: 45, active: true },
  ];
  return {
    furnishing: "fully" as const,
    bedrooms: 2,
    items: itemCount === "many" ? [...base, ...extra] : base,
  };
}
