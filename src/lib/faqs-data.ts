// 7 FAQs ported from the Drive bundle's app-data.js, with Q6 updated
// to reflect the user's pricing (£39.99/month or £360/year saving 25%).

export interface FAQItem {
  q: string;
  a: string;
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
    a: "Free trial — run as many reports as you like for 14 days at no cost. Subscription is £39.99/month for unlimited analyses, or £360/year (saving 25% paid annually). Cancel any time, no contract.",
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
