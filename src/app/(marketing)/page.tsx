import Link from "next/link";
import type { Metadata } from "next";
import { AnswerCapsule } from "@/components/marketing/AnswerCapsule";
import { Bullets } from "@/components/marketing/Bullets";
import { CTABlock } from "@/components/marketing/CTABlock";
import { FAQ, type FAQItem } from "@/components/marketing/FAQ";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { RelatedLinks } from "@/components/marketing/RelatedLinks";
import { TrustSignals } from "@/components/marketing/TrustSignals";
import { HeroWithUICard } from "@/components/marketing/HeroWithUICard";
import { TrustStrip } from "@/components/marketing/TrustStrip";
import { ComparisonShowcase } from "@/components/marketing/ComparisonShowcase";
import { SeasonalityChart } from "@/components/marketing/SeasonalityChart";
import { PropertyTypeGrid } from "@/components/marketing/PropertyTypeGrid";
import { DetailMosaic } from "@/components/marketing/DetailMosaic";
import { AtmosphericFullbleed } from "@/components/marketing/AtmosphericFullbleed";
import { Schema } from "@/components/Schema";
import { IMG } from "@/lib/images";
import { CTA } from "@/lib/cta";
import {
  faqSchema,
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Find out if your property has potential as a short-term let";
const PAGE_DESCRIPTION =
  "Income-estimate software for UK short-term lets. Get a peak income estimate, customise based on comparable nearby properties, decide with confidence. 14-day free trial.";
const PAGE_URL = siteUrl("/");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "Stayful",
    locale: "en_GB",
    type: "website",
  },
};

const FAQS: FAQItem[] = [
  {
    q: "What does the software actually do?",
    a: "It estimates what a property could earn as a short-term let. You enter the property, the software pulls comparable nearby short-term rentals, applies seasonal demand patterns, and gives you a peak income estimate you can customise based on the comparables you trust most.",
  },
  {
    q: "Do I need to give it my property details?",
    a: "Yes — the more accurate the inputs, the more accurate the estimate. At minimum you need a UK address or postcode, the bedroom count, and the type of property. Two minutes of inputs.",
  },
  {
    q: "How accurate is it?",
    a: "The software uses live nearby comparables and a calibrated seasonal model. Every estimate is paired with the comparables it was built from, so you can see exactly which listings drove the number and adjust the comparable set yourself.",
  },
  {
    q: "Will it tell me my income before I sign up?",
    a: "No. The software produces the estimate during your trial — that's the whole point of trying it. The marketing pages explain what it does; the trial is where you find out for your specific property.",
  },
  {
    q: "What happens after the 14-day trial?",
    a: "You can upgrade to a paid plan or stop. We don't auto-charge — you only enter card details when you actively choose to upgrade. Past reports stay viewable on a free account either way.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. You can cancel from your account settings at any point. If you cancel during the trial you owe nothing; if you cancel a paid plan you keep access until the end of your billing period.",
  },
];

const RELATED = [
  {
    href: "/income-calculator",
    label: "Airbnb income calculator",
    description: "What the calculator covers and how to use it.",
  },
  {
    href: "/features",
    label: "What the software does",
    description: "Capabilities inventory across the report.",
  },
  {
    href: "/short-term-vs-long-term-letting",
    label: "Short-term vs long-term letting",
    description: "Framework for choosing between letting strategies.",
  },
  {
    href: "/pricing",
    label: "Pricing",
    description: "£29/month after a 14-day free trial.",
  },
  {
    href: "/about",
    label: "About Stayful",
    description: "The management company behind the software.",
  },
  {
    href: "/demo",
    label: "See a sample report",
    description: "Walk through what the software shows you.",
  },
];

export default function HomePage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          webApplicationSchema({
            name: "Stayful",
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

      <HeroWithUICard image={IMG.heroProperty} cardVariant="peak-estimate-loading" showUICard={false}>
        <h1 className="sf-display">{PAGE_TITLE}.</h1>
        <LastUpdated date={LAST_UPDATED} />
        <p style={{ fontSize: 17, fontWeight: 600, maxWidth: 520 }}>
          Income-estimate software for UK short-term lets. Get a peak income
          estimate, customise based on comparable nearby properties, decide
          with confidence.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          <Link href={CTA.primaryHref} className="sf-btn">
            {CTA.primary}
          </Link>
          <Link href={CTA.secondaryHref} className="sf-btn sf-btn--ghost">
            {CTA.secondary}
          </Link>
        </div>
        <p style={{ fontSize: 13, color: "var(--sf-green)", opacity: 0.75, fontWeight: 600, marginTop: 4 }}>
          {CTA.trialNote}
        </p>
      </HeroWithUICard>

      <TrustStrip />

      <section className="sf-section" style={{ paddingTop: 56, paddingBottom: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <AnswerCapsule>
            <p>
              <strong>Stayful</strong> estimates short-term let income for any
              UK property. You enter the address and a few details; the
              software pulls comparable nearby listings, applies a seasonal
              demand model, and gives you a peak income estimate you can
              customise by selecting the comparables you trust most. Free for
              14 days, full access, no card required.
            </p>
          </AnswerCapsule>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <h2>Why this beats a flat-average tool</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            Most STR calculators give you a single market average with nothing
            behind it. Stayful shows you the actual nearby listings the
            estimate is built from, then lets you decide which ones count.
          </p>
          <ComparisonShowcase />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>What the software does</h2>
          <Bullets
            items={[
              <span key="1"><strong>Peak income estimate.</strong> A revenue figure for the property at typical occupancy and seasonality.</span>,
              <span key="2"><strong>Live comparable listings.</strong> Up to 40 nearby short-term rentals, each shown with their own occupancy, ADR, and review weight.</span>,
              <span key="3"><strong>Customisable.</strong> Pick which comparables you trust; the estimate updates based on your selection.</span>,
              <span key="4"><strong>Seasonal monthly view.</strong> A 12-month curve showing where the income is concentrated across the year.</span>,
              <span key="5"><strong>Long-let comparison.</strong> An equivalent monthly long-term let figure for the same property, side by side.</span>,
              <span key="6"><strong>Profit calculator.</strong> Layer in mortgage and bills to see net monthly profit at your modelled occupancy.</span>,
              <span key="7"><strong>Risk assessment.</strong> Income volatility, regulatory exposure, platform dependency — scored.</span>,
              <span key="8"><strong>Exportable report.</strong> Share with a partner, accountant, or lender as a single PDF.</span>,
            ]}
          />
          <SeasonalityChart caption="Your year isn't annual ÷ 12. Cashflow planning gets specific to the property." />
        </div>
      </section>

      <DetailMosaic />

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 1020 }}>
          <h2>Works for any UK property</h2>
          <PropertyTypeGrid />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>Who it&rsquo;s for</h2>
          <h3>Existing landlords considering a switch</h3>
          <p>
            You&rsquo;ve been long-letting and you&rsquo;re wondering whether
            short-term would earn more, after the additional work and cost.
            The software gives you the comparison side by side, on your
            specific property — not a city average.
          </p>
          <h3>Prospective buyers evaluating a property</h3>
          <p>
            You&rsquo;re looking at a property and you want to know if it has
            short-term let potential before you commit. Run it through the
            software, get the comparable evidence, decide before you offer.
          </p>
          <h3>Existing short-term hosts checking optimisation</h3>
          <p>
            You already short-let and you want to know whether your pricing
            and occupancy are tracking the local market — or whether
            you&rsquo;re leaving income on the table that comparable nearby
            listings are capturing.
          </p>
          <h3>Owners deciding whether to let or sell</h3>
          <p>
            You&rsquo;re weighing up letting vs selling. Knowing the realistic
            short-term and long-term income, with seasonality, gives you a
            cleaner number to compare against a sale price.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>How it works</h2>
          <h3>1. Enter your property</h3>
          <p>
            Address or postcode, bedrooms, guests, property type. Two minutes,
            no obligation, no card.
          </p>
          <h3>2. The software pulls live comparables</h3>
          <p>
            Real nearby short-term rentals, filtered by guest capacity,
            weighted by review count and recency. You see the listings
            themselves, not a black-box average.
          </p>
          <h3>3. Review and customise</h3>
          <p>
            The software shows you the peak income estimate. You can de-select
            comparables that don&rsquo;t match your property, and the estimate
            updates. You can also layer in mortgage and bills to see net
            monthly profit.
          </p>
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>Built by people who manage UK short-term lets</h2>
          <p>
            Stayful runs an in-house management company across the UK. The
            software you&rsquo;re looking at is the same forecasting tool we
            use internally to evaluate properties before taking them onto
            management — now made available directly. The track record below
            is the management business; it&rsquo;s the underwriting on the
            software.
          </p>
          <TrustSignals />
        </div>
      </section>

      <section id="faq" className="sf-section">
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

      <AtmosphericFullbleed image={IMG.atmosphereCottageDusk}>
        <h2>See your property&rsquo;s number.</h2>
        <p>
          Free for 14 days, full access, no card required. Past reports stay
          viewable on a free account either way.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href={CTA.primaryHref} className="sf-btn sf-btn--white">
            {CTA.primary}
          </Link>
          <Link href={CTA.secondaryHref} className="sf-btn sf-btn--ghost" style={{ borderColor: "#fff", color: "#fff" }}>
            {CTA.secondary}
          </Link>
        </div>
      </AtmosphericFullbleed>
    </>
  );
}
