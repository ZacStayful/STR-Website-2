import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Stayful",
  description:
    "Simple pricing for Stayful Intelligence. 14-day free trial, no credit card required. Pro plan for active landlords.",
};

export default function PricingPage() {
  return (
    <>
      <PricingHero />
      <PricingTable />
      <PricingFAQ />
    </>
  );
}

function PricingHero() {
  return (
    <section className="sf-section" style={{ paddingBottom: 32 }}>
      <div className="sf-container" style={{ textAlign: "center", maxWidth: 720, marginInline: "auto" }}>
        <div className="sf-eyebrow">Pricing</div>
        <h1 style={{ marginBottom: 16 }}>Simple, honest pricing.</h1>
        <p style={{ color: "#555", fontSize: 18, margin: 0 }}>
          Try every feature free for 14 days. Upgrade only if it pays for itself.
        </p>
      </div>
    </section>
  );
}

function PricingTable() {
  return (
    <section className="sf-section" style={{ paddingTop: 32 }}>
      <div className="sf-container" style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", maxWidth: 880, marginInline: "auto" }}>
        {/* Free trial tile */}
        <div className="sf-card" style={{ padding: 32 }}>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 4 }}>Free trial</h3>
            <p style={{ color: "#666", fontSize: 14, margin: 0 }}>Full access, no card needed.</p>
          </div>
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--sf-green)" }}>£0</span>
            <span style={{ color: "#888", fontSize: 15, marginLeft: 6 }}>for 14 days</span>
          </div>
          <Link href="/signup" className="sf-btn sf-btn--ghost" style={{ width: "100%", marginBottom: 24 }}>
            Start free trial
          </Link>
          <FeatureList
            items={[
              "Unlimited property analyses",
              "All 11 report sections",
              "Real Airbnb comparables",
              "Seasonal forecast & profit calc",
              "PDF/presentation export",
              "Email support",
            ]}
          />
        </div>

        {/* Pro tile */}
        <div
          className="sf-card"
          style={{ padding: 32, borderColor: "var(--sf-green)", borderWidth: 2, position: "relative" }}
        >
          <span
            className="sf-pill"
            style={{ position: "absolute", top: -14, right: 24, background: "var(--sf-green)", color: "#fff", borderColor: "var(--sf-green)" }}
          >
            Most popular
          </span>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 4 }}>Pro</h3>
            <p style={{ color: "#666", fontSize: 14, margin: 0 }}>For active landlords and investors.</p>
          </div>
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--sf-green)" }}>£29</span>
            <span style={{ color: "#888", fontSize: 15, marginLeft: 6 }}>/ month</span>
            <p style={{ fontSize: 13, color: "#888", margin: "4px 0 0" }}>or £290/year (save 17%)</p>
          </div>
          <Link href="/signup" className="sf-btn" style={{ width: "100%", marginBottom: 24 }}>
            Start free trial
          </Link>
          <FeatureList
            items={[
              "Everything in Free trial",
              "Unlimited saved searches",
              "Side-by-side property compare",
              "CSV export of comparables",
              "Priority support",
              "Early access to new features",
            ]}
          />
        </div>
      </div>
      <p style={{ textAlign: "center", color: "#888", fontSize: 13, marginTop: 24 }}>
        Pricing shown is illustrative — update before launch. VAT applied where applicable.
      </p>
    </section>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
      {items.map((item) => (
        <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, color: "#444" }}>
          <span aria-hidden="true" style={{ color: "var(--sf-green)", fontWeight: 700, lineHeight: 1.5 }}>✓</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PricingFAQ() {
  const faqs = [
    {
      q: "Can I cancel any time?",
      a: "Yes. Cancel from your account page in one click. You keep access until the end of your billing period.",
    },
    {
      q: "What happens to my data if I cancel?",
      a: "Your saved reports are preserved view-only. Re-subscribe any time and they&rsquo;ll be there.",
    },
    {
      q: "Do you offer team or agency plans?",
      a: "Get in touch at hello@stayful.co.uk — we&rsquo;ll size something for multi-property portfolios or letting agencies.",
    },
    {
      q: "Is there a usage limit?",
      a: "Pro is uncapped on standard use. Heavy programmatic usage (1000+ reports/month) goes through a custom API plan.",
    },
  ];
  return (
    <section className="sf-section sf-section--alt">
      <div className="sf-container" style={{ maxWidth: 760 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div className="sf-eyebrow">Billing FAQ</div>
          <h2>Things people ask before they upgrade.</h2>
        </div>
        <div>
          {faqs.map((f) => (
            <details key={f.q} className="sf-faq">
              <summary className="sf-faq__q">{f.q}</summary>
              <div className="sf-faq__a">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
