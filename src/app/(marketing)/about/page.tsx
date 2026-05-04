import type { Metadata } from "next";
import { CTABlock } from "@/components/marketing/CTABlock";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { RelatedLinks } from "@/components/marketing/RelatedLinks";
import { TrustSignals } from "@/components/marketing/TrustSignals";
import { ManagedGallery } from "@/components/marketing/ManagedGallery";
import { Placeholder } from "@/components/marketing/Placeholder";
import Image from "next/image";
import { IMG, hasImage } from "@/lib/images";
import { Schema } from "@/components/Schema";
import { BRAND, TRUST } from "@/lib/brand";
import { breadcrumbSchema, organizationSchema, webPageSchema } from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "About Stayful";
const PAGE_DESCRIPTION =
  "Stayful is a UK short-term let management company. The software you're looking at is the same forecasting tool we use internally to evaluate properties — now made available directly.";
const PAGE_URL = siteUrl("/about");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

const RELATED = [
  { href: "/", label: "Home", description: "What the software does." },
  {
    href: "/income-calculator",
    label: "Income calculator",
    description: "Use the calculator on your property.",
  },
  { href: "/features", label: "Features", description: "Capabilities inventory." },
  { href: "/demo", label: "Sample report", description: "What the output looks like." },
  { href: "/pricing", label: "Pricing", description: "Trial + £29/month plan." },
  {
    href: "/short-term-vs-long-term-letting",
    label: "Short-term vs long-term",
    description: "Comparison framework.",
  },
];

export default function AboutPage() {
  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          webPageSchema({
            name: PAGE_TITLE,
            url: PAGE_URL,
            description: PAGE_DESCRIPTION,
            dateModified: LAST_UPDATED,
          }),
          breadcrumbSchema([
            { name: "Home", url: siteUrl("/") },
            { name: "About", url: PAGE_URL },
          ]),
        ]}
      />

      <section className="sf-section" style={{ paddingTop: 72, paddingBottom: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h1>Built by Stayful, the UK short-term let management company.</h1>
          <LastUpdated date={LAST_UPDATED} />
          <div className="sf-intro">
            <p>
              {BRAND.name} is a UK short-term let management company. We
              manage Airbnb and direct-booking properties across the UK on
              behalf of property owners — handling listings, pricing,
              guest communications, cleaning, and maintenance.
            </p>
            <p>
              The software you&rsquo;re looking at is the same forecasting
              tool we use internally to evaluate properties before taking
              them onto management. We needed it to be accurate, because
              we&rsquo;d be running the property afterward. We made it
              available directly so anyone evaluating a property — owners,
              prospective buyers, existing hosts — can use the same
              calibrated estimates we use ourselves.
            </p>
          </div>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>The track record</h2>
          <p>
            These are the management business&rsquo;s figures. They&rsquo;re
            on this page because they&rsquo;re what underwrites the
            credibility of the software — not because they&rsquo;re a
            promise about your property&rsquo;s income.
          </p>
          <TrustSignals caption="Figures from the Stayful management business as of May 2026. The software estimates your property's potential individually — past management performance is not a guarantee of future income for a specific property." />
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 1100 }}>
          <h2>The properties we manage</h2>
          <p style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 8px" }}>
            A glimpse of the portfolio that calibrates the software. Each one
            has been forecast, taken on, and run by Stayful — the feedback
            loop is what keeps the model real-world.
          </p>
          <ManagedGallery />
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 1020, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 36, alignItems: "center" }}>
          <div style={{ borderRadius: 18, overflow: "hidden", boxShadow: "var(--sf-shadow-photo)", aspectRatio: "4 / 5" }}>
            {hasImage(IMG.team) ? (
              <Image
                src={IMG.team.src}
                alt={IMG.team.alt}
                width={IMG.team.width}
                height={IMG.team.height}
                sizes="(max-width: 900px) 100vw, 40vw"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <Placeholder width={IMG.team.width} height={IMG.team.height} label="The Stayful team" />
            )}
          </div>
          <div>
            <h2 style={{ borderTop: "none", padding: 0, margin: "0 0 16px", textAlign: "left" }}>
              The team
            </h2>
            <p>
              Stayful is a small UK team of operators who&rsquo;ve built
              software because we needed it ourselves. We forecast properties
              before taking them onto management, and we wanted the forecast
              to be calibrated against properties we&rsquo;d actually run.
              That&rsquo;s what the software does — and now anyone evaluating
              a property can use it.
            </p>
          </div>
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>Why we built the software</h2>
          <p>
            Most income calculators we tried gave us a flat market average
            with no comparable evidence behind the number. That works for
            generic stats, but it didn&rsquo;t work for evaluating a
            specific property — where pricing, demand, and seasonality
            depend on local detail. So we built our own pipeline: pull
            actual nearby listings, weight by review count and recency,
            apply seasonal demand modelling, and pair it with a calibrated
            long-let comparison. We then calibrated the estimates against
            our own managed portfolio and kept tightening the model.
          </p>
          <p>
            We use it ourselves before taking on a new property. Releasing
            it as software means the same calibration is available to
            anyone — without needing Stayful to manage the property.
          </p>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>The management company</h2>
          <p>
            If you&rsquo;d rather hand the property over and have someone
            else run the short-term let — we do that too. The management
            business operates separately from the software:{" "}
            <a href={BRAND.managementUrl} target="_blank" rel="noopener noreferrer">
              {BRAND.managementUrl.replace(/^https?:\/\//, "")}
            </a>
            . You don&rsquo;t need to use Stayful management to use the
            software, and you don&rsquo;t need to use the software to use
            Stayful management.
          </p>
          <p>
            Currently {TRUST.propertiesManaged} UK properties on
            management, with a {TRUST.googleRating}★ Google rating from
            owner reviews.
          </p>
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>Contact</h2>
          <p>
            Questions about the software, the management business, or
            anything else: <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>.
          </p>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 900 }}>
          <h2>Read more</h2>
          <RelatedLinks items={RELATED} />
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 32, paddingBottom: 96 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <CTABlock
            heading="Try the software on your property"
            body="Free for 14 days. Full access. No card required."
          />
        </div>
      </section>
    </>
  );
}
