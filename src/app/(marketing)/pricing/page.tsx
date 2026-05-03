import type { Metadata } from "next";
import Link from "next/link";
import { Bullets } from "@/components/marketing/Bullets";
import { CTABlock } from "@/components/marketing/CTABlock";
import { FAQ, type FAQItem } from "@/components/marketing/FAQ";
import { LastUpdated } from "@/components/marketing/LastUpdated";
import { Schema } from "@/components/Schema";
import { CTA } from "@/lib/cta";
import {
  faqSchema,
  softwareApplicationSchema,
  webPageSchema,
} from "@/lib/schema";
import { siteUrl } from "@/lib/url";

const PAGE_TITLE = "Pricing";
const PAGE_DESCRIPTION =
  "14 days free, then £29/month. Full access during the trial, no credit card required.";
const PAGE_URL = siteUrl("/pricing");
const LAST_UPDATED = "2026-05-03";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} — Stayful`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
};

const FAQS: FAQItem[] = [
  {
    q: "What if I cancel before the trial ends?",
    a: "You owe nothing. The trial is full access with no card required, so there's nothing to cancel from a billing point of view — you just don't upgrade. You'll get a reminder email a couple of days before the trial ends so you're never surprised.",
  },
  {
    q: "Do you keep my data after I cancel?",
    a: "Your saved reports stay viewable on a free account so you can come back to them. If you'd like everything deleted, email hello@stayful.co.uk and we'll wipe the account within five working days. We don't share or sell your inputs.",
  },
  {
    q: "How do I cancel?",
    a: "From your account settings in one click. If you've upgraded to Pro, you keep access until the end of your billing period and aren't charged again.",
  },
  {
    q: "Is the trial really full access?",
    a: "Yes. Every feature in the software is available during the trial. The only thing you can't do without upgrading is keep using the software past day 14.",
  },
  {
    q: "Do you do team or agency plans?",
    a: "Email hello@stayful.co.uk and we'll size something. Multi-property portfolios and letting agencies get a custom price.",
  },
  {
    q: "Why £29 per month?",
    a: "It's the price point where running the software pays for itself if it informs a single decent decision — a property purchase, a switch from long-let, a pricing change. Cheaper than getting one report wrong.",
  },
];

export default function PricingPage() {
  return (
    <>
      <Schema
        items={[
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

      <section className="sf-section" style={{ paddingTop: 72, paddingBottom: 32 }}>
        <div className="sf-container" style={{ maxWidth: 720, textAlign: "center" }}>
          <h1>14 days, full access, no credit card required.</h1>
          <LastUpdated date={LAST_UPDATED} />
          <p style={{ fontSize: 17, fontWeight: 600, marginTop: 16 }}>
            One plan after that: £29/month. Cancel any time. Past reports stay
            viewable on a free account either way.
          </p>
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 32 }}>
        <div className="sf-container" style={{ maxWidth: 880 }}>
          <div
            style={{
              display: "grid",
              gap: 24,
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <div className="sf-card" style={{ padding: 32 }}>
              <h3 style={{ margin: "0 0 4px" }}>14-day free trial</h3>
              <p style={{ fontSize: 14, margin: "0 0 20px" }}>
                Full access. No card required.
              </p>
              <div style={{ marginBottom: 24 }}>
                <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--sf-green)" }}>£0</span>
                <span style={{ fontSize: 15, marginLeft: 8, fontWeight: 600 }}>for 14 days</span>
              </div>
              <Link
                href={CTA.primaryHref}
                className="sf-btn sf-btn--ghost"
                style={{ width: "100%", marginBottom: 24 }}
              >
                {CTA.primary}
              </Link>
              <Bullets
                items={[
                  "Unlimited property analyses",
                  "All report sections",
                  "Live nearby comparables",
                  "Seasonal forecast and profit calculator",
                  "PDF / presentation export",
                  "Email support",
                ]}
              />
            </div>

            <div
              className="sf-card"
              style={{
                padding: 32,
                borderColor: "var(--sf-green)",
                borderWidth: 2,
                position: "relative",
              }}
            >
              <span
                className="sf-pill"
                style={{
                  position: "absolute",
                  top: -14,
                  right: 24,
                  background: "var(--sf-green)",
                  color: "#fff",
                  borderColor: "var(--sf-green)",
                }}
              >
                After your trial
              </span>
              <h3 style={{ margin: "0 0 4px" }}>Pro</h3>
              <p style={{ fontSize: 14, margin: "0 0 20px" }}>
                Same software, no time limit.
              </p>
              <div style={{ marginBottom: 24 }}>
                <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--sf-green)" }}>£29</span>
                <span style={{ fontSize: 15, marginLeft: 8, fontWeight: 600 }}>/ month</span>
                <p style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 0", opacity: 0.75 }}>
                  Cancel any time, billed monthly.
                </p>
              </div>
              <Link
                href={CTA.primaryHref}
                className="sf-btn"
                style={{ width: "100%", marginBottom: 24 }}
              >
                {CTA.primary}
              </Link>
              <Bullets
                items={[
                  "Everything in the trial",
                  "Unlimited saved properties",
                  "Side-by-side property comparison",
                  "CSV export of comparables",
                  "Priority email support",
                  "Early access to new features",
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="sf-section sf-section--alt">
        <div className="sf-container" style={{ maxWidth: 760 }}>
          <h2>Billing questions</h2>
          <FAQ items={FAQS} />
        </div>
      </section>

      <section className="sf-section" style={{ paddingTop: 32, paddingBottom: 96 }}>
        <div className="sf-container" style={{ maxWidth: 820 }}>
          <CTABlock
            heading="Try it free for 14 days"
            body="No card. Cancel any time. Past reports stay viewable on a free account."
          />
        </div>
      </section>
    </>
  );
}
