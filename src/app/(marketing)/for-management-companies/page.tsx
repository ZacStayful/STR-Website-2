import type { Metadata } from "next";
import Link from "next/link";
import { Schema } from "@/components/Schema";
import { organizationSchema, softwareApplicationSchema, webPageSchema } from "@/lib/schema";
import { siteUrl } from "@/lib/url";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { getFunnelTierSettings } from "@/lib/funnels/tiers-server";
import { bothRates, leadsFromPack, money, withRate } from "@/lib/funnels/tiers";
import { packGrants, pounds } from "@/lib/starter-pack/rules";
import { START_PATH } from "@/lib/management/stamp";
import { DEMO_MANCHESTER } from "@/lib/demo-data";
import { McViewBeacon } from "@/components/management/McViewBeacon";

/**
 * Batch 22f: the page every management company's ad points at. A first
 * touch here stamps the account at sign-up (src/lib/management/stamp.ts),
 * and Start goes straight to the lead form setup. Prices are read live from
 * billing_settings. No guarantees, no hype.
 */

const PAGE_PATH = "/for-management-companies";
const PAGE_URL = siteUrl(PAGE_PATH);
const PAGE_TITLE = "A branded short-let income report for every landlord enquiry";
const PAGE_DESCRIPTION =
  "Give every landlord who enquires a short-let income report in your name, from your own link, in about a minute. Built by Stayful. Priced per lead, cheaper as your month goes on.";
const LAST_UPDATED = "2026-10-02";

export const revalidate = 300;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

function tierRange(from: number, nextFrom: number | null): string {
  return nextFrom ? `Leads ${from}–${nextFrom - 1}` : `Lead ${from} and on`;
}

export default async function ForManagementCompanies() {
  const [tiers, settings] = await Promise.all([getFunnelTierSettings(), getBillingSettings()]);
  const topup = settings.spendRates.topup;
  const first = tiers.tiers[0].pence;
  const lc = settings.lifecycle;
  const packLeads = leadsFromPack(packGrants(lc), settings.spendRates, first);
  const demo = DEMO_MANCHESTER;

  return (
    <>
      <Schema
        items={[
          organizationSchema(),
          softwareApplicationSchema({ name: "Stayful Intelligence", url: PAGE_URL, description: PAGE_DESCRIPTION }),
          webPageSchema({ name: PAGE_TITLE, url: PAGE_URL, description: PAGE_DESCRIPTION, dateModified: LAST_UPDATED }),
        ]}
      />
      <McViewBeacon />

      <section className="section">
        <div className="wrap-narrow" style={{ display: "grid", gap: 40 }}>
          <div style={{ maxWidth: 760 }}>
            <div className="eyebrow">For letting and management companies</div>
            <h1 style={{ marginTop: 12 }}>A branded short-let income report for every landlord enquiry, in your name, in 60 seconds.</h1>
            <p className="lede" style={{ marginTop: 16 }}>
              Put your link on your website or in your ads. A landlord enters their address and gets a short-let income report
              with your logo and colours, in about a minute. You get the lead, their contact details and the report.
            </p>
            <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Link href={START_PATH} className="btn btn-primary">
                Start
              </Link>
              <span style={{ fontSize: 14, opacity: 0.75 }}>Set up in about 5 minutes. Your form stays paused until you go live.</span>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden", maxWidth: 560 }} aria-label="Sample report">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 15 }}>Your Company Lettings</strong>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Sample report · demo data</span>
            </div>
            <div style={{ padding: 16 }}>
              <p style={{ fontSize: 13, opacity: 0.75 }}>
                {demo.property.bedrooms}-bed flat, Manchester {demo.property.postcode.split(" ")[0]}
              </p>
              <p style={{ fontSize: 32, fontWeight: 700, color: "#1F5F8B", marginTop: 4 }}>
                £{demo.shortLet.annualRevenue.toLocaleString("en-GB")} a year
              </p>
              <p style={{ fontSize: 13, opacity: 0.75 }}>
                Estimated short-let income · {Math.round(demo.shortLet.occupancyRate * 100)}% occupancy · £{demo.shortLet.averageDailyRate} a night
                {demo.longLet ? ` · long let about £${demo.longLet.monthlyRent.toLocaleString("en-GB")} a month` : ""}
              </p>
              <p style={{ marginTop: 12 }}>
                <a href="/lead-form-sample" target="_blank" rel="noopener" style={{ textDecoration: "underline", fontSize: 14 }}>
                  Open the full sample report
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      <section className="section-tight">
        <div className="wrap-narrow">
          <div className="eyebrow">How it works</div>
          <ol style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", listStyle: "none", padding: 0 }}>
            {[
              ["1", "Add your logo and colours", "Two minutes. The form and the report carry your name, never ours."],
              ["2", "Share your link, website button or embed", "On your site, in your ads, in your enquiry replies."],
              ["3", "Every report lands in your inbox, Monday or CRM", "With the landlord's details and the headline figures."],
            ].map(([n, title, body]) => (
              <li key={n} className="card" style={{ padding: 16 }}>
                <p style={{ fontSize: 13, opacity: 0.6 }}>Step {n}</p>
                <p style={{ fontWeight: 600, marginTop: 4 }}>{title}</p>
                <p style={{ fontSize: 14, opacity: 0.8, marginTop: 4 }}>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <hr className="section-divider" />

      <section className="section-tight" id="pricing">
        <div className="wrap-narrow">
          <div className="eyebrow">Pricing</div>
          <h2 style={{ marginTop: 12 }}>Per lead, cheaper as your month goes on</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Each lead is priced by its number in the calendar month. You pay only for reports that ran: a repeat enquiry and a
            failed report are never charged.
          </p>
          <div className="card" style={{ marginTop: 20, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ padding: "10px 16px" }}>Leads each month</th>
                  <th style={{ padding: "10px 16px" }}>Price a lead</th>
                  <th style={{ padding: "10px 16px" }}>From top-up credit</th>
                </tr>
              </thead>
              <tbody>
                {tiers.tiers.map((t, i) => (
                  <tr key={t.from} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 16px" }}>{tierRange(t.from, tiers.tiers[i + 1]?.from ?? null)}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 600 }}>{money(t.pence)}</td>
                    <td style={{ padding: "10px 16px" }}>{money(withRate(t.pence, topup))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>
            Enhanced reports, with a second opinion on the income, add {money(tiers.enhancedExtraPence)} a lead at every tier. Prices come
            off your credit: {bothRates(first, topup)}, because top-up credit is spent at {topup}×.
          </p>
          {lc.starterPackPricePence > 0 && lc.starterPackCreditPence > 0 ? (
            <p style={{ marginTop: 12, fontSize: 14 }}>
              Start with the {pounds(lc.starterPackPricePence)} starter pack: {pounds(lc.starterPackCreditPence)} of credit, about {packLeads} standard leads.
            </p>
          ) : null}
          <p style={{ marginTop: 24 }}>
            <Link href={START_PATH} className="btn btn-primary">
              Start
            </Link>
          </p>
        </div>
      </section>

      <hr className="section-divider" />

      <section className="section-tight">
        <div className="wrap-narrow" style={{ maxWidth: 760 }}>
          <div className="eyebrow">Who built it</div>
          <p className="lede" style={{ marginTop: 12 }}>
            Built by Stayful. We run around 70 short-let properties in 15 UK cities and use the same figures ourselves.
          </p>
          <p style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>
            The report is an estimate from comparable listings nearby and local long-let rents. It is not a guarantee of what a
            property will earn.
          </p>
        </div>
      </section>
    </>
  );
}
