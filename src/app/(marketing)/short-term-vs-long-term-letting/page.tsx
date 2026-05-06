import type { Metadata } from "next";
import { AnswerCapsule } from "@/components/marketing/AnswerCapsule";
import { Bullets } from "@/components/marketing/Bullets";
import { CTABlock } from "@/components/marketing/CTABlock";
import { FAQ, type FAQItem } from "@/components/marketing/FAQ";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { RelatedLinks } from "@/components/marketing/RelatedLinks";
import { LongVsShortSplit } from "@/components/marketing/LongVsShortSplit";
import { PropertyTypeGrid } from "@/components/marketing/PropertyTypeGrid";
import { Schema } from "@/components/Schema";
import {
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE =
  "Short-term vs long-term letting — which is right for your property?";
const PAGE_DESCRIPTION =
  "A framework for choosing between short-term and long-term letting on a UK property. The trade-offs, the questions to ask, and how to actually find out for your specific property.";
const PAGE_URL = siteUrl("/short-term-vs-long-term-letting");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

const FAQS: FAQItem[] = [
  {
    q: "Does short-term letting always earn more than long-term?",
    a: "No. The answer depends on the property, the location, the seasonality of demand nearby, and the quality of management. Some properties earn substantially more short-term; others barely cover the additional cost and work. The only honest answer is to model it for your specific property.",
  },
  {
    q: "What about the Renters Reform Act and Section 21?",
    a: "Recent changes to long-let regulation in England (and parallel changes elsewhere in the UK) have shifted the calculus for some landlords. Short-term letting sits under different rules. We don't take a position on which is better for you legally — that's a question for your solicitor — but the income comparison is what the software helps you answer.",
  },
  {
    q: "Is short-term letting more work?",
    a: "Yes, in absolute terms. Short-term letting involves more turnover, more guest contact, and more variable income to manage. Many landlords use a management company to absorb that work. The financial comparison is gross income minus all costs (including management, if you use one) — that's what the software calculates.",
  },
  {
    q: "What happens to my mortgage if I switch?",
    a: "Most buy-to-let mortgages have terms about how the property may be let. Some allow short-term letting, some don't. Always check with your lender before switching — this is independent of any income estimate.",
  },
  {
    q: "How do I find out for my specific property?",
    a: "Run it through Stayful. The software pulls comparable nearby short-term rentals, models the seasonal demand, and produces both a short-let estimate and an equivalent long-term let figure. You see them side by side. The trial is free for 14 days, no card required.",
  },
];

const RELATED = [
  {
    href: "/income-calculator",
    label: "Income calculator",
    description: "What the calculator covers.",
  },
  {
    href: "/features",
    label: "Features",
    description: "Full software capabilities.",
  },
  { href: "/demo", label: "Sample report", description: "Walk through an example." },
  { href: "/pricing", label: "Pricing", description: "Trial + £29/month plan." },
  { href: "/", label: "Home", description: "What the software does." },
  { href: "/about", label: "About Stayful", description: "Who built this." },
];

export default function ShortVsLongPage() {
  return (
    <>
      <Schema
        items={[
          articleSchema({
            headline: PAGE_TITLE,
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            datePublished: LAST_UPDATED,
            dateModified: LAST_UPDATED,
          }),
          webPageSchema({
            name: PAGE_TITLE,
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            dateModified: LAST_UPDATED,
          }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl("/") },
            { name: "Short-term vs long-term letting", url: PAGE_URL },
          ]),
          faqSchema(FAQS),
        ]}
      />

      <section className="sf-section" style={{ paddingTop: 72, paddingBottom: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h1>Short-term vs long-term letting — which is right for your property?</h1>
          <LastUpdated date={LAST_UPDATED} />
          <div className="sf-intro">
            <p>
              The choice between short-term letting (Airbnb,
              Booking.com, holiday lets) and long-term letting (assured
              shorthold tenancies, six- and twelve-month contracts) is one of
              the bigger decisions you make as a UK landlord. The right
              answer depends on the property, not on a general rule.
            </p>
            <p>
              This page sets out the framework for thinking about the choice.
              The actual numbers — what your property would earn either way
              — come from running it through the software. We don&rsquo;t
              put figures on this page because the figures depend on your
              specific address.
            </p>
          </div>

          <AnswerCapsule>
            <p>
              <strong>Short-term letting</strong> trades higher gross income
              and more flexibility for more work, more variable income, and
              tighter regulation in some areas.{" "}
              <strong>Long-term letting</strong> trades stable monthly rent
              for typically lower gross and stricter long-let regulation.
              Stayful&rsquo;s software produces both figures for any UK
              property so you can compare them directly. Free 14-day trial.
            </p>
          </AnswerCapsule>

          <CTABlock
            heading="Find out for your property"
            body="The software produces both figures side by side."
            variant="green"
          />
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 16 }}>
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <LongVsShortSplit showRibbons={false} />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>The four trade-offs</h2>
          <h3>Income volatility</h3>
          <p>
            Long-term letting gives you a fixed monthly rent. Short-term
            letting gives you variable income — usually concentrated in
            peak months, with quieter periods in between. The annual total
            can be larger, smaller, or comparable depending on the property.
            The software shows you the monthly distribution so cashflow
            planning isn&rsquo;t guesswork.
          </p>
          <h3>Work involved</h3>
          <p>
            Long-term tenancies have a one-time setup, periodic check-ins,
            and end-of-tenancy turnover. Short-term lets have continuous
            turnover — cleans, communications, listings, pricing decisions —
            either done by you or by a management company. That cost is
            absorbed into the financial comparison.
          </p>
          <h3>Control over the property</h3>
          <p>
            Short-term letting keeps the property accessible to you (between
            bookings, for personal use, for sale viewings if you ever decide
            to sell). Long-term tenancies hand exclusive possession to the
            tenant for the duration of the contract.
          </p>
          <h3>Regulation</h3>
          <p>
            Long-term letting in England has been reshaped by the Renters
            Reform Act and changes to Section 21. Short-term letting has its
            own rules — local council registration in some areas, the 90-day
            cap in Greater London, planning use-class considerations. Both
            paths involve compliance work; neither is inherently lighter.
          </p>
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>Which earns more?</h2>
          <p>
            For some properties — central locations near demand drivers,
            properties with character or a unique offering, places with
            strong tourist or business travel — short-term letting earns
            substantially more after costs. For others — properties in
            commuter belts, properties without standout features, areas with
            limited short-stay demand — long-term letting earns more, or
            comparably, with much less work.
          </p>
          <p>
            We don&rsquo;t put a percentage on this page because the answer
            varies enormously by property. The point of the software is to
            tell you which side your specific property lands on.
          </p>
          <h3>What the software shows for both options</h3>
          <Bullets
            items={[
              <span key="1"><strong>Short-let income estimate</strong> — peak figure with seasonal monthly breakdown.</span>,
              <span key="2"><strong>Long-let monthly rent</strong> — calibrated against current local rental data.</span>,
              <span key="3"><strong>Net comparison</strong> — both options after mortgage, bills, and (for short-let) management/cleaning costs.</span>,
              <span key="4"><strong>Comparables for both sides</strong> — actual nearby short-term and long-term listings, not a flat average.</span>,
              <span key="5"><strong>Risk scoring</strong> — income volatility, regulatory exposure, platform dependency for short-let; vacancy and Section 21 risk for long-let.</span>,
            ]}
          />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <h2>Whatever the property, the software runs it</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            City flats, terraced houses, cottages, coastal stays, period
            flats. The framework above works for any of them — the actual
            comparison comes from running yours through the trial.
          </p>
          <PropertyTypeGrid />
        </div>
      </section>

      <section className="sf-section sf-section--alt">
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
            heading="Compare both options for your property"
            body="The software produces a short-let estimate and a long-let figure side by side."
          />
        </div>
      </section>
    </>
  );
}
