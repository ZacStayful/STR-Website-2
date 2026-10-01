// FAQs ported from the Drive bundle's app-data.js.
// "What does it cost?" is built from figures (costAnswer): the pages that show
// it pass the live billing settings (src/lib/faqs-server.ts), so the welcome
// credit, the cheapest plan, the smallest top-up and the top-up rate can never
// drift from what Pricing.tsx charges. The static list carries the defaults.

export interface FAQItem {
  q: string;
  a: string;
}

/** The numbers the cost answer is written from. */
export interface CostFigures {
  welcomePence: number;
  fullAnalysisPence: number;
  pmiAddonPence: number;
  /** The cheapest active monthly plan. */
  minPlanPence: number;
  /** The smallest top-up preset. */
  minTopupPence: number;
  /** Top-up credit's spend rate against plan credit. */
  topupRate: number;
}

/** The seeded billing_settings and billing_plans values (supabase/schema.sql). */
export const DEFAULT_COST_FIGURES: CostFigures = { welcomePence: 2000, fullAnalysisPence: 400, pmiAddonPence: 200, minPlanPence: 1900, minTopupPence: 1000, topupRate: 1.3 };

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const pounds = (pence: number) => `£${pence % 100 === 0 ? pence / 100 : (pence / 100).toFixed(2)}`;

/** The rest of the cost answer: plans, top-ups, the rate. */
export function costRest(f: CostFigures): string {
  return `subscribe for monthly credit from ${pounds(f.minPlanPence)}/month — current plans and annual saving are on the pricing page — or top up as you go from ${pounds(f.minTopupPence)}. Plan credit resets each month; top-up credit never expires but is spent at ${f.topupRate}× the plan rate. Cancel any time, no contract.`;
}

/**
 * "What does it cost?" as it stands: the starter pack's lead once the pack is
 * live (src/lib/starter-pack/rules.ts costLead), else the welcome credit.
 */
export function costAnswer(offer: { costLead: string | null }, f: CostFigures = DEFAULT_COST_FIGURES): string {
  if (offer.costLead) return `${offer.costLead} Or ${costRest(f)}`;
  const analyses = f.fullAnalysisPence > 0 ? Math.floor(f.welcomePence / f.fullAnalysisPence) : 0;
  const withPmi = f.fullAnalysisPence + f.pmiAddonPence > 0 ? Math.floor(f.welcomePence / (f.fullAnalysisPence + f.pmiAddonPence)) : 0;
  return `Every account starts with ${pounds(f.welcomePence)} of free credit, no card required — about ${count(analyses)} Full analyses of deals, or ${count(withPmi)} with the PMI second opinion added. After that, ${costRest(f)}`;
}

export const FAQS: FAQItem[] = [
  {
    q: "What does the Property Analyser actually output?",
    a: "A 10-section report covering intake, live comparables, amenities and demand drivers, a gross-to-net revenue breakdown, a 12-month forecast, a local area report, a furnishing setup quote and a risk assessment. Every figure is sourced — no projections without a comparable behind them.",
  },
  {
    q: "Where does the data come from?",
    a: "Airbtics for live Airbnb comparables, PropertyData for long-let valuations and area data, Google Places for amenities, and Ticketmaster for live events and demand. Every source is named on the figure it produces.",
  },
  {
    q: "Is this making bold revenue claims?",
    a: "No. The Analyser shows you what comparable properties in your postcode actually earn — including the quiet months. You see the realistic range, not a best-case projection. The figure you take into a decision is the figure you can defend to a lender.",
  },
  {
    q: "How is this different from Airdna or AirROI?",
    a: "Those tools tell you what an area earns. The Stayful Property Analyser tells you what to do about it — a decision engine that breaks down the operational, regulatory and growth steps a specific property needs to win in its postcode.",
  },
  {
    q: "Do I need to be technical to use it?",
    a: "No. Type an address, click analyse. The 10 sections are the report — no setup, no configuration, no spreadsheets to build.",
  },
  {
    q: "What does it cost?",
    a: costAnswer({ costLead: null }),
  },
  {
    q: "Can I use this for properties I don't own yet?",
    a: "Yes — that's the most common use. Investors run prospective deals through the Analyser before making an offer. The setup-cost calculator and risk score are designed for pre-purchase decisions.",
  },
  {
    q: "Is this the same as Stayful's management service?",
    a: "Separate. The Analyser is a decision tool any owner or investor can use. Stayful Management is a full-service offering for owners who want their property run for them at 15% + VAT. Most Analyser users never become management clients — and that's fine.",
  },
];

// Shown on /methodology. These are the questions a sceptical buyer actually
// asks about provenance, including the two least comfortable ones.
export const TRUST_FAQS: FAQItem[] = [
  {
    q: "How do you know your forecasts are accurate?",
    a: "Because we operate the properties, so we find out. For the six short-lets Stayful took under management in 2025, the ledger on this page shows the Income Estimate produced before each went live next to twelve months of real bookings. Six is a small sample and we say so; it is also six more named, dated, published comparisons than the category usually offers.",
  },
  {
    q: "Isn't it a conflict of interest that you're also a management company?",
    a: "It is a fair question. Running the properties is what lets us check a forecast against reality, and it also gives us a commercial interest in you liking the number. Two things keep us honest: the estimate is produced before we know whether a property will come under management, and we publish the variance either way — including where the model was wrong. Most Analyser users never become management clients, and the tool is priced to work that way.",
  },
  {
    q: "Why isn't nightly rate in the forecast-vs-actual table?",
    a: "Because our forecast and the year-end figure are not currently measuring it the same way. Our estimate quotes a rate per booked night; the number that comes back off a host dashboard is built on a different denominator. Putting them side by side would show a gap that is partly definitional rather than a real miss, so we have left it out until we can publish both on identical terms. Owner net is measured the same way on both sides, which is why the ledger reports that.",
  },
  {
    q: "Is this making bold revenue claims?",
    a: "No. You see the realistic range, not a best-case projection. The figure you take into a decision is the figure you can defend to a lender.",
  },
  {
    q: "What happens where you don't manage properties?",
    a: "You get the market data every platform has — live comparables, long-let benchmarks, demand drivers — without the first-party layer on top. The report says which is which rather than presenting both with the same confidence.",
  },
];

const COST_Q = "What does it cost?";

/**
 * The FAQs with "What does it cost?" as it stands (Batch 20): once the
 * starter pack is live its answer leads with the pack instead of the £20
 * (src/lib/starter-pack/public.ts), and every figure is the live one when
 * the page passes them (src/lib/faqs-server.ts costFiguresNow).
 */
export function faqsWith(offer: { costLead: string | null }, figures: CostFigures = DEFAULT_COST_FIGURES): FAQItem[] {
  return FAQS.map((f) => (f.q === COST_Q ? { ...f, a: costAnswer(offer, figures) } : f));
}
