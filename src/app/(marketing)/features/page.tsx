import type { Metadata } from "next";
import { CTABlock } from "@/components/marketing/CTABlock";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { RelatedLinks } from "@/components/marketing/RelatedLinks";
import { ProductAnatomy } from "@/components/marketing/ProductAnatomy";
import { DemandConstellation } from "@/components/marketing/DemandConstellation";
import { SeasonalityChart } from "@/components/marketing/SeasonalityChart";
import { StressTest } from "@/components/marketing/StressTest";
import { ComparablesMap } from "@/components/marketing/ComparablesMap";
import { Schema } from "@/components/Schema";
import {
  faqSchema,
  organizationSchema,
  softwareApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "What the software does — features";
const PAGE_DESCRIPTION =
  "A complete inventory of what Stayful's income-estimate software produces: live comparables, seasonal monthly view, long-let comparison, profit calculator, demand drivers, risk scoring, exportable reports.";
const PAGE_URL = siteUrl("/features");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

const FAQS = [
  {
    q: "Do all features come with the trial?",
    a: "Yes. Every feature on this page is available during the 14-day free trial, no card required. The Pro plan after the trial is the same software with no time limit.",
  },
  {
    q: "Can I export the report?",
    a: "Yes — the software includes a one-click PDF and presentation-ready export. Useful for sharing with a partner, accountant, lender, or buyer.",
  },
  {
    q: "How current are the comparables?",
    a: "Comparables are pulled live for each analysis. We don't cache stale data — every time you run a property, the listings are fresh.",
  },
];

const FEATURES: Array<{ heading: string; body: string }> = [
  {
    heading: "Peak income estimate",
    body:
      "A single short-term let revenue figure for your property at typical occupancy and seasonality. Built from the comparable listings the software pulls for your area, not a flat market average.",
  },
  {
    heading: "Live nearby comparables",
    body:
      "Up to 40 nearby short-term rentals shown with their own daily rate, occupancy, review weight, listing age, and a direct link. You see what's actually happening locally — not a black-box number.",
  },
  {
    heading: "Customisable comparable set",
    body:
      "Select or de-select comparables based on whether they actually match your property. Different bedroom counts, different price tiers, different management styles — keep what's relevant; drop what isn't. The estimate updates as you change the set.",
  },
  {
    heading: "Seasonal monthly view",
    body:
      "A 12-month curve of expected revenue, weighted by historical occupancy and ADR patterns for the area. Cashflow planning becomes specific to the property rather than annual ÷ 12.",
  },
  {
    heading: "Long-let comparison",
    body:
      "An equivalent long-term let figure for the same property, calibrated against current UK rental data. Both numbers presented side by side so the comparison is direct.",
  },
  {
    heading: "Profit calculator",
    body:
      "Layer in mortgage payments, council tax, utilities, insurance, cleaning, and management fees to see net monthly profit at your modelled occupancy. Adjustable so you can stress-test pessimistic months.",
  },
  {
    heading: "Demand drivers",
    body:
      "Hospitals, universities, transport hubs, airports, and event venues nearby — with distance and rating. The software identifies the demand sources behind the comparable performance and gives you a booking-confidence signal.",
  },
  {
    heading: "Risk assessment",
    body:
      "Income volatility, seasonality, regulatory exposure, platform dependency, and other risk factors scored on a /100 scale. So the income estimate isn't divorced from the risks of earning it.",
  },
  {
    heading: "Exportable report",
    body:
      "Every analysis exports to a presentation-ready PDF you can share with a partner, accountant, broker, or lender. Useful for buy-to-let mortgage applications, partnership decisions, or just your own records.",
  },
  {
    heading: "Saved properties",
    body:
      "Save analyses across multiple properties in your account, re-run them when comparables change, and compare them side by side on the Pro plan.",
  },
];

const RELATED = [
  { href: "/", label: "Home", description: "What the software does, in summary." },
  {
    href: "/income-calculator",
    label: "Income calculator",
    description: "What the calculator covers.",
  },
  { href: "/demo", label: "Sample report", description: "Walk through an example output." },
  { href: "/pricing", label: "Pricing", description: "Trial + £29/month plan." },
  {
    href: "/short-term-vs-long-term-letting",
    label: "Short-term vs long-term",
    description: "Comparison framework.",
  },
  { href: "/about", label: "About Stayful", description: "Who built this." },
];

export default function FeaturesPage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          softwareApplicationSchema({
            name: "Stayful",
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            price: "29",
          }),
          webPageSchema({
            name: PAGE_TITLE,
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            dateModified: LAST_UPDATED,
          }),
          faqSchema(FAQS),
        ]}
      />

      <section className="sf-section" style={{ paddingTop: 72, paddingBottom: 24 }}>
        <div className="sf-container" style={{ maxWidth: 820, textAlign: "center" }}>
          <h1 className="sf-display">What the software does.</h1>
          <LastUpdated date={LAST_UPDATED} />
          <div className="sf-intro">
            <p style={{ textAlign: "left" }}>
              Stayful is income-estimate software for UK short-term lets.
              Every feature here is available during the 14-day trial — no
              card required.
            </p>
          </div>
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 0, paddingBottom: 24 }}>
        <div className="sf-container" style={{ maxWidth: 1100 }}>
          <ProductAnatomy />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>Every component in the report</h2>
          {FEATURES.map((f) => (
            <div key={f.heading}>
              <h3>{f.heading}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <h2>Demand drivers nearby</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            The software identifies what makes the area book — transport,
            universities, hospitals, venues — so the estimate sits on top of
            an actual demand model, not just a list of comparables.
          </p>
          <DemandConstellation />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>The seasonal monthly view</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            Twelve months of expected revenue shape, side by side with your
            long-let figure.
          </p>
          <SeasonalityChart caption="Sample shape · the software calculates yours from your address." />
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <h2>Worst-case stress test</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            The software re-runs your numbers at &minus;10% and &minus;20% to
            show what happens if every assumption is wrong. The floor is the
            test, not the peak.
          </p>
          <StressTest />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <h2>Live comparables, on a map</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            Up to 40 nearby short-term rentals, each shown with its own ADR,
            occupancy, and review weight.
          </p>
          <ComparablesMap />
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>How it&rsquo;s built</h2>
          <p>
            The estimates are calibrated against the in-house Stayful managed
            portfolio — properties we forecast and then actually run. That
            calibration loop is what makes the figures real-world rather
            than theoretical. The same forecasting pipeline that supports
            our management decisions runs every analysis on the software.
          </p>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 760 }}>
          <h2>Common questions</h2>
          <div>
            {FAQS.map((f) => (
              <details key={f.q} className="sf-faq">
                <summary className="sf-faq__q">{f.q}</summary>
                <div className="sf-faq__a">
                  <p>{f.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>Read more</h2>
          <RelatedLinks items={RELATED} />
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 32, paddingBottom: 96 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <CTABlock
            heading="Run the software on your property"
            body="Free for 14 days. Full access. No card required."
          />
        </div>
      </section>
    </>
  );
}
