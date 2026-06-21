// 10 sections of the analyser — verbatim port of the Drive bundle's app-data.js.
// Used by Walkthrough rail + section content + each SectionMock.

import type { IconName } from "@/lib/icons";

export interface AnalyserSection {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  description: string;
  bullets: string[];
  icon: IconName;
}

export const SECTIONS: AnalyserSection[] = [
  {
    id: "intake",
    number: "01",
    title: "Property intake",
    subtitle: "Address, postcode, type, capacity",
    description:
      "Start with your property's address. Stayful auto-detects the postcode, property type and capacity from UK address data — no spreadsheets, no guessing the right inputs.",
    bullets: [
      "UK address autocomplete",
      "Auto-detected postcode + EPC",
      "Bedrooms, bathrooms, max guests",
    ],
    icon: "search",
  },
  {
    id: "loading",
    number: "02",
    title: "Live data ingest",
    subtitle: "11 data sources in 10–20 seconds",
    description:
      "While you wait, Stayful pulls live comparables from Airbnb, long-let valuations from PropertyData, amenities from Google Places and demand drivers from Ticketmaster — for your exact postcode.",
    bullets: [
      "Airbtics live comp data",
      "PropertyData long-let comps",
      "Google Places amenities",
      "Ticketmaster events",
    ],
    icon: "loading",
  },
  {
    id: "overview",
    number: "03",
    title: "Decision overview",
    subtitle: "Top potential vs. your filtered estimate",
    description:
      "Two figures, side by side: what a top performer in this postcode actually earns, and the average of the comps you've kept. Net revenue is shown after platform fees, cleaning and management — the number that lands in your account.",
    bullets: [
      "Top market vs filtered estimate",
      "Net of all fees",
      "ADR, occupancy, value range",
    ],
    icon: "overview",
  },
  {
    id: "comparables",
    number: "04",
    title: "Comparables",
    subtitle: "Real listings, real revenue, your call",
    description:
      "Every nearby listing pulled from Airbnb with nightly rate, occupancy, annual revenue and reviews. Exclude any that don't match your property — your filtered estimate updates instantly.",
    bullets: [
      "Live Airbnb comps in your radius",
      "Annual revenue + occupancy per listing",
      "Exclude/include to refine",
    ],
    icon: "comparables",
  },
  {
    id: "amenities",
    number: "05",
    title: "Amenities & demand drivers",
    subtitle: "Why this postcode books — or doesn't",
    description:
      "Hospitals, universities, transport hubs, construction projects, event venues. Each one rated for booking impact, with distance and a plain-English explanation of how it affects your direct booking potential.",
    bullets: [
      "Healthcare, education, transport, events",
      "Impact rating per driver",
      "Direct-booking opportunity score",
    ],
    icon: "amenities",
  },
  {
    id: "revenue",
    number: "06",
    title: "Revenue breakdown",
    subtitle: "Gross to net, line by line",
    description:
      "Platform fees, cleaning, laundry, management — every cost itemised against gross bookings. The figure at the bottom is what you actually take home each month.",
    bullets: [
      "Itemised platform & operating costs",
      "Monthly + annual net",
      "Cleaning passed at cost",
    ],
    icon: "revenue",
  },
  {
    id: "forecast",
    number: "07",
    title: "12-month forecast",
    subtitle: "Quiet months, peak months, full year",
    description:
      "Month-by-month occupancy and revenue projection based on live seasonal patterns in your postcode. The quietest month is shown as prominently as the peak — the figure no other tool tells you.",
    bullets: [
      "Seasonal demand curve",
      "Quiet month + peak month",
      "Cashflow planning per month",
    ],
    icon: "forecast",
  },
  {
    id: "local",
    number: "08",
    title: "Local area report",
    subtitle: "Long-term direct booking potential",
    description:
      "Hospitals, universities and major construction projects within reach — the lifeblood of repeat bookings. Each driver is rated for impact so you know whether direct bookings will compound or fade.",
    bullets: [
      "Up to 50km demand catchment",
      "Per-driver impact assessment",
      "Direct booking forecast",
    ],
    icon: "local",
  },
  {
    id: "bookings",
    number: "09",
    title: "Setup costs",
    subtitle: "Furnishing, beds, décor, appliances",
    description:
      "Built-in setup quote with real prices from Dunelm, Argos, Amazon and B&Q. Adjust quantities to your property — get a defensible setup budget you can take to a lender.",
    bullets: [
      "14+ furnishing line items",
      "Real retailer pricing",
      "Copy-quote for funding apps",
    ],
    icon: "setup",
  },
  {
    id: "risk",
    number: "10",
    title: "Risk assessment",
    subtitle: "Regulation, supply, seasonality",
    description:
      "Local council short-let restrictions, supply saturation in your postcode, planning rule changes on the horizon. Honest scoring — not best-case projections.",
    bullets: [
      "Council regulation tracker",
      "Supply saturation index",
      "Seasonality + concentration risk",
    ],
    icon: "risk",
  },
];
