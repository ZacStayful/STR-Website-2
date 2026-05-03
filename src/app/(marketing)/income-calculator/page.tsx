import type { Metadata } from "next";
import { AnswerCapsule } from "@/components/marketing/AnswerCapsule";
import { Bullets } from "@/components/marketing/Bullets";
import { CTABlock } from "@/components/marketing/CTABlock";
import { FAQ, type FAQItem } from "@/components/marketing/FAQ";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { RelatedLinks } from "@/components/marketing/RelatedLinks";
import { Schema } from "@/components/Schema";
import {
  faqSchema,
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Airbnb income calculator — UK short-term let estimates";
const PAGE_DESCRIPTION =
  "A calculator that estimates what a UK property could earn as an Airbnb short-term let, built from live nearby comparables. Free 14-day trial, no card required.";
const PAGE_URL = siteUrl("/income-calculator");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

const FAQS: FAQItem[] = [
  {
    q: "What is an Airbnb income calculator?",
    a: "A tool that estimates what a property would earn if it were let on Airbnb (or another short-term platform). Stayful's calculator uses live nearby comparables to build the estimate, rather than a flat market average.",
  },
  {
    q: "Is the calculator UK-specific?",
    a: "Yes. The calculator is built for UK properties — comparables are pulled from UK platforms, the long-let benchmark uses UK rental data, and seasonality is modelled on UK demand patterns.",
  },
  {
    q: "How is this different from Airbnb's own estimator?",
    a: "Airbnb's estimator gives you a flat figure for an area. Stayful pulls actual nearby listings — with their own occupancy and daily rates — and lets you choose which ones to weight in your estimate. You see the comparables, not just a number.",
  },
  {
    q: "Do I need card details to use the calculator?",
    a: "No. The 14-day trial is full access with no card required. You only enter card details if you choose to upgrade to the £29/month plan after the trial.",
  },
  {
    q: "Can I use it on multiple properties?",
    a: "Yes. There is no cap on how many properties you can analyse during the trial or on the Pro plan.",
  },
];

const RELATED = [
  { href: "/", label: "Home", description: "What the software does, in summary." },
  { href: "/features", label: "Features", description: "Full capabilities inventory." },
  { href: "/demo", label: "Sample report", description: "Walk through an example output." },
  { href: "/pricing", label: "Pricing", description: "Trial details and the £29/month plan." },
  {
    href: "/short-term-vs-long-term-letting",
    label: "Short-term vs long-term",
    description: "Comparison framework.",
  },
  { href: "/about", label: "About Stayful", description: "Who built this." },
];

export default function IncomeCalculatorPage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          webApplicationSchema({
            name: "Stayful Airbnb Income Calculator",
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
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

      <section className="sf-section" style={{ paddingTop: 72, paddingBottom: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h1>Airbnb income calculator for UK properties.</h1>
          <LastUpdated date={LAST_UPDATED} />
          <div className="sf-intro">
            <p>
              Stayful&rsquo;s income calculator estimates what a UK property
              could earn if you let it on Airbnb or another short-term
              platform. Enter the address, the bedroom count, and a few
              details. The software pulls live nearby comparable listings,
              applies a seasonal demand model, and gives you a peak income
              estimate you can customise based on which comparables match
              your property best.
            </p>
          </div>

          <AnswerCapsule>
            <p>
              Stayful&rsquo;s calculator estimates short-term let income for
              UK properties. It uses live nearby comparables — not a flat
              market average — so you can see exactly which listings drove
              the estimate and adjust the comparable set yourself. Free for
              14 days, full access, no card required.
            </p>
          </AnswerCapsule>

          <CTABlock
            heading="Use the calculator on your property"
            body="Sign up and the software produces the estimate during your trial."
            variant="green"
          />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>What the calculator covers</h2>
          <Bullets
            items={[
              <span key="1"><strong>Live comparable listings.</strong> Real nearby short-term rentals, weighted by review count and recency.</span>,
              <span key="2"><strong>Peak income estimate.</strong> A revenue figure for typical occupancy and seasonal demand.</span>,
              <span key="3"><strong>Customisable comparable set.</strong> Pick which listings count toward your estimate.</span>,
              <span key="4"><strong>Seasonal monthly view.</strong> 12-month curve showing where the income is concentrated.</span>,
              <span key="5"><strong>Long-let comparison.</strong> Side-by-side equivalent monthly long-term let figure.</span>,
              <span key="6"><strong>Profit calculator.</strong> Net monthly profit after mortgage and bills.</span>,
              <span key="7"><strong>Demand drivers.</strong> Hospitals, universities, transport, events nearby.</span>,
              <span key="8"><strong>Risk score.</strong> Income volatility, regulatory exposure, platform dependency.</span>,
            ]}
          />
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>How to use it</h2>
          <p>
            Sign up, paste in the property address (or postcode), confirm
            bedrooms and guest capacity, and the calculator runs. You can
            adjust the comparable set, layer in mortgage and bills, and
            export the report as a PDF in one click. The whole flow takes
            about a minute.
          </p>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 760 }}>
          <h2>Common questions</h2>
          <FAQ items={FAQS} />
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
            heading="See the calculator on your property"
            body="Sign up and run it on your specific address. No card required during the trial."
          />
        </div>
      </section>
    </>
  );
}
