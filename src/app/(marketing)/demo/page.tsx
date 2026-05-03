import type { Metadata } from "next";
import { CTABlock } from "@/components/marketing/CTABlock";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { Schema } from "@/components/Schema";
import {
  organizationSchema,
  webApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";
import { DEMO_MANCHESTER } from "@/lib/demo-data";

const PAGE_TITLE = "See a sample report";
const PAGE_DESCRIPTION =
  "A guided walkthrough of what Stayful's income-estimate software produces. Sample property, illustrative figures — sign up to see the real number for yours.";
const PAGE_URL = siteUrl("/demo");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

const sample = DEMO_MANCHESTER;
const fmt = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export default function DemoPage() {
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
        ]}
      />

      <div
        style={{
          background: "var(--sf-green)",
          color: "#fff",
          padding: "12px 24px",
          textAlign: "center",
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Sample property · this is what the software shows you · sign up to see
        your own number
      </div>

      <section className="sf-section" style={{ paddingTop: 56, paddingBottom: 24 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h1>{PAGE_TITLE}.</h1>
          <LastUpdated date={LAST_UPDATED} />
          <div className="sf-intro">
            <p>
              Below is a walkthrough of what Stayful&rsquo;s software produces
              for a single property. Every number on this page is from a
              sample property in Manchester. <strong>Your numbers will look
              different — that&rsquo;s the whole point.</strong> The trial is
              where the software pulls the comparables for your address and
              builds your own estimate.
            </p>
          </div>
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 0 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <div className="sf-card">
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--sf-green)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
              Sample property · illustrative
            </p>
            <h3 style={{ margin: "0 0 4px" }}>
              {sample.property.address}, {sample.property.postcode}
            </h3>
            <p style={{ margin: 0, fontSize: 14 }}>
              {sample.property.bedrooms} bedrooms · sleeps {sample.property.guests}
            </p>
          </div>
        </div>
      </section>

      <section className="sf-section">
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h2>What the software shows you</h2>
          <p>
            The software produces a single peak income estimate, the
            comparables that drove it, the seasonal monthly breakdown, an
            equivalent long-let figure for the same property, demand drivers
            in the area, and a profit calculator. The numbers below are for
            the sample property only.
          </p>
        </div>
      </section>

      <section className="sf-section sf-section--alt" style={{ paddingTop: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h3>Headline estimate (sample)</h3>
          <div className="sf-numbers">
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">
                {fmt(sample.shortLet.annualRevenue)}
              </span>
              <span className="sf-numbers__label">Short-let gross / year</span>
            </div>
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">
                {Math.round(sample.shortLet.occupancyRate * 100)}%
              </span>
              <span className="sf-numbers__label">Modelled occupancy</span>
            </div>
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">
                {fmt(sample.shortLet.averageDailyRate)}
              </span>
              <span className="sf-numbers__label">Average daily rate</span>
            </div>
          </div>
          <p style={{ fontSize: 13, fontStyle: "italic", color: "var(--sf-green)", opacity: 0.75, margin: "12px 0 0", textAlign: "center" }}>
            These are figures for the sample property. The software will
            produce different numbers for your property.
          </p>
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h3>Live comparables (sample)</h3>
          <p>
            The software pulls comparable nearby short-term rentals and shows
            you each one with its own occupancy, daily rate, and review
            weight. You can de-select the ones you don&rsquo;t trust and the
            estimate updates.
          </p>
          <div className="sf-table-wrap">
            <table className="sf-table">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Distance</th>
                  <th>ADR</th>
                  <th>Occupancy</th>
                  <th>Reviews</th>
                </tr>
              </thead>
              <tbody>
                {sample.shortLet.comparables.slice(0, 5).map((c) => (
                  <tr key={c.title}>
                    <td>{c.title}</td>
                    <td>{c.distance != null ? `${c.distance.toFixed(1)} mi` : "—"}</td>
                    <td>{fmt(c.averageDailyRate)}</td>
                    <td>{Math.round(c.occupancyRate * 100)}%</td>
                    <td>{c.reviewCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="sf-section sf-section--alt" style={{ paddingTop: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h3>Seasonal monthly view (sample)</h3>
          <p>
            The software shows you where the income is concentrated across
            the year, so cashflow planning isn&rsquo;t just annual ÷ 12.
          </p>
          <div className="sf-table-wrap">
            <table className="sf-table">
              <thead>
                <tr>
                  {months.map((m) => (
                    <th key={m} style={{ textAlign: "center" }}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {sample.shortLet.monthlyRevenue.map((r, i) => (
                    <td key={i} style={{ textAlign: "center" }}>{fmt(r)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 32 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <h3>Long-let comparison (sample)</h3>
          <p>
            For the same sample property, the software pulls a calibrated
            long-term let figure so you can see them side by side.
          </p>
          <div className="sf-numbers" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">
                {fmt(sample.longLet.monthlyRent)}
              </span>
              <span className="sf-numbers__label">
                Long-let rent / month (sample)
              </span>
            </div>
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">
                {fmt(Math.round(sample.shortLet.annualRevenue / 12))}
              </span>
              <span className="sf-numbers__label">
                Short-let avg / month (sample)
              </span>
            </div>
          </div>
          <p style={{ fontSize: 13, fontStyle: "italic", color: "var(--sf-green)", opacity: 0.75, margin: "12px 0 0" }}>
            Sample-property comparison. The software will produce both
            figures for your property — and the difference might point either
            way.
          </p>
        </div>
      </section>

      <section className="sf-section sf-section--alt" style={{ paddingTop: 32, paddingBottom: 96 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <CTABlock
            heading="See your property's number"
            body="Sign up and run the software on your property. The trial is full access, no card, cancel any time."
            variant="green"
          />
        </div>
      </section>
    </>
  );
}
