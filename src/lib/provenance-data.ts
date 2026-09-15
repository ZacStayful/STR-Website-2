// The canonical list of where Stayful's numbers come from.
//
// This is the single source of truth for the data-source count and naming
// across the site: ProvenanceBar, SourceLedger, the Footer credit line and
// the in-app AccuracyPanel. Before this module existed, four different files
// disagreed about how many sources there were — a bad look anywhere, worse on
// a page arguing that our figures are trustworthy.
//
// Marketing copy, reviewed before publication and rendered statically, so it
// belongs in src/lib rather than Supabase. Live commercial data (plans,
// prices) stays in Supabase and is read by Pricing.tsx.

export type SourceKind = "first-party" | "partner" | "public";

export interface DataSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** What this source contributes to a report. */
  produces: string;
  /** One honest sentence about what it can and cannot tell us. */
  detail: string;
  /** How much weight the model gives it, 0-100. */
  confidence: number;
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: "stayful-managed",
    name: "Stayful managed portfolio",
    kind: "first-party",
    produces: "Real bookings, real costs",
    detail:
      "Nightly rates, occupancy, cleaning and turnaround costs from the UK short-lets we manage ourselves. Observed, not inferred — but it only covers the markets we operate in.",
    confidence: 100,
  },
  {
    id: "stayful-direct",
    name: "Stayful direct bookings",
    kind: "first-party",
    produces: "Revenue net of platform fees",
    detail:
      "Bookings taken on our own channels, which is the only way to see what a night actually earns once the platform's cut is removed.",
    confidence: 100,
  },
  {
    id: "airbtics",
    name: "Airbtics",
    kind: "partner",
    produces: "Live Airbnb comparables",
    detail:
      "Active listings near the postcode. Strong on what a market looks like from the outside; it cannot see a listing's real costs or cancellations.",
    confidence: 95,
  },
  {
    id: "propertydata",
    name: "PropertyData",
    kind: "partner",
    produces: "Sold comparables and long-let values",
    detail:
      "Sale prices and rental benchmarks, used for yield-on-cost and the long-let comparison. Lags the market by the length of a conveyance.",
    confidence: 88,
  },
  {
    id: "google-places",
    name: "Google Places",
    kind: "partner",
    produces: "Amenities and location context",
    detail:
      "What is actually near the property. Good coverage in cities, thinner in rural areas.",
    confidence: 90,
  },
  {
    id: "ticketmaster",
    name: "Ticketmaster",
    kind: "partner",
    produces: "Demand drivers and event calendars",
    detail:
      "Scheduled events that move nightly rates. Catches arenas and festivals; misses private and unticketed demand.",
    confidence: 85,
  },
  {
    id: "epc-register",
    name: "EPC Register",
    kind: "public",
    produces: "Property size, age and efficiency",
    detail:
      "Official floor area and energy rating, which feed running costs. Only as current as the last assessment.",
    confidence: 92,
  },
  {
    id: "companies-house",
    name: "Companies House",
    kind: "public",
    produces: "Operator and ownership signals",
    detail:
      "Who else is operating at scale in the area. Statutory filings, so accurate but slow.",
    confidence: 94,
  },
];

export const FIRST_PARTY_SOURCES = DATA_SOURCES.filter(
  (s) => s.kind === "first-party",
);
export const EXTERNAL_SOURCES = DATA_SOURCES.filter(
  (s) => s.kind !== "first-party",
);

/** The count quoted in copy. Derived so it cannot drift from the list. */
export const DATA_SOURCE_COUNT = DATA_SOURCES.length;
export const EXTERNAL_SOURCE_COUNT = EXTERNAL_SOURCES.length;

export interface ProvenancePillar {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
}

export const PROVENANCE_PILLARS: ProvenancePillar[] = [
  {
    id: "partner",
    eyebrow: "01 / Partner data",
    title: "The market, from outside.",
    body: "Airbtics, PropertyData, Google Places, Ticketmaster, the EPC register and Companies House. Named on every figure they produce, so you can see which part of a report rests on someone else's data.",
  },
  {
    id: "operated",
    eyebrow: "02 / Our own bookings",
    title: "The market, from inside it.",
    body: "The UK short-lets under Stayful management, plus the direct bookings we take ourselves. Real nightly rates, real occupancy, real owner net after fees and cleaning — not comparables.",
  },
  {
    id: "check",
    eyebrow: "03 / The check",
    title: "What happens when they disagree.",
    body: "Because we operate the properties, we find out whether a forecast was right. Where the model and the year diverge, the variance is published rather than quietly corrected.",
  },
];
