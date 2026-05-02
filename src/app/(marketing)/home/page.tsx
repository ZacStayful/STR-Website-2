import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stayful — See what your property could earn as a short-term rental",
  description:
    "Calibrated UK-wide income estimates for landlords considering Airbnb or holiday let. Real comparables, seasonal demand, and an honest comparison vs long-term let.",
};

export default function HomeLandingPage() {
  return (
    <>
      <Hero />
      <TrustBar />
      <HowItWorks />
      <WhatYouGet />
      <CaseStudies />
      <Comparison />
      <Testimonials />
      <FAQ />
      <FinalCTA />
    </>
  );
}

function Hero() {
  const pills = [
    "Real Airbnb comps",
    "Seasonal demand modelling",
    "PMI-calibrated",
    "UK-wide coverage",
    "Long-let comparison",
    "Risk assessment",
  ];
  return (
    <section className="sf-section" style={{ paddingTop: 96, paddingBottom: 64 }}>
      <div className="sf-container" style={{ display: "grid", gap: 56, gridTemplateColumns: "1fr", alignItems: "start" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
          <div className="sf-eyebrow">Stayful Intelligence · 14-day free trial</div>
          <h1 style={{ marginBottom: 20 }}>
            See what your property could earn as a short-term rental.
          </h1>
          <p style={{ fontSize: 19, color: "#444", maxWidth: 680, margin: "0 auto 28px" }}>
            Stayful&rsquo;s analyser pulls real Airbnb comparables, seasonal demand, and
            a calibrated long-let benchmark for any UK property. The same engine
            that runs Stayful&rsquo;s in-house management leads, now available direct.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 32 }}>
            <Link href="/signup" className="sf-btn">
              Try free for 14 days
            </Link>
            <Link href="/pricing" className="sf-btn sf-btn--ghost">
              See pricing
            </Link>
          </div>
          <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
            No credit card required · Full access to every report · Cancel anytime
          </p>
        </div>

        <div style={{ maxWidth: 980, margin: "0 auto", width: "100%" }}>
          <div className="sf-pills" style={{ justifyContent: "center", marginBottom: 32 }}>
            {pills.map((p) => (
              <span key={p} className="sf-pill">{p}</span>
            ))}
          </div>
          <div className="sf-numbers">
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">~30 sec</span>
              <span className="sf-numbers__label">Time to a full report</span>
            </div>
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">12 × 12</span>
              <span className="sf-numbers__label">Months of seasonal modelling</span>
            </div>
            <div className="sf-numbers__tile">
              <span className="sf-numbers__value">±70% within ±30%</span>
              <span className="sf-numbers__label">PMI-calibrated accuracy</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="sf-section--alt" style={{ padding: "32px 0", borderTop: "1px solid #eee", borderBottom: "1px solid #eee" }}>
      <div className="sf-container">
        <p style={{ textAlign: "center", fontSize: 13, fontWeight: 500, color: "#777", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
          Powered by data from Airbtics · PropertyData · Google Places · Ticketmaster · Calibrated against the Stayful managed portfolio
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Enter your property",
      body: "Address, postcode, bedrooms, guests, property type. Two minutes, no obligation.",
    },
    {
      n: "02",
      title: "We pull live comparables",
      body: "Real Airbnb listings within walking distance, with their actual occupancy and ADR. Filtered by guest capacity, weighted by review count and recency.",
    },
    {
      n: "03",
      title: "Seasonality + long-let layer",
      body: "We annualise short-tenure listings, apply a 12-month seasonal curve to ADR and occupancy, and pull a calibrated long-let comparable from PropertyData.",
    },
    {
      n: "04",
      title: "You get a 11-section report",
      body: "Headline revenue, monthly forecast, profit calculator with mortgage + bills, risk assessment, demand drivers, and a presentation-ready export.",
    },
  ];
  return (
    <section id="how-it-works" className="sf-section">
      <div className="sf-container" style={{ display: "grid", gap: 56, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
        <div>
          <div className="sf-eyebrow">How it works</div>
          <h2 style={{ marginBottom: 16 }}>From postcode to report in under a minute.</h2>
          <p style={{ color: "#555", fontSize: 17 }}>
            No spreadsheets. No back-of-the-napkin maths. Just real comps,
            calibrated against a managed UK portfolio so the figures hold up
            when you put them in front of a lender or a partner.
          </p>
        </div>
        <div>
          {steps.map((s) => (
            <div key={s.n} className="sf-step">
              <span className="sf-step__num">{s.n}</span>
              <div className="sf-step__body">
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatYouGet() {
  const features = [
    {
      title: "Real comparable listings",
      body: "Up to 40 nearby Airbnb listings with their ADR, occupancy, review count, and direct links.",
    },
    {
      title: "Monthly forecast",
      body: "12-month seasonal revenue curve based on weighted historical occupancy and ADR.",
    },
    {
      title: "Profit calculator",
      body: "Layer in mortgage and bills to see net monthly profit vs an equivalent long-term let.",
    },
    {
      title: "Demand drivers",
      body: "Hospitals, universities, transport hubs, events nearby — with a booking-confidence score.",
    },
    {
      title: "Risk assessment",
      body: "Income volatility, seasonality, regulatory and platform-dependency risks scored on a /100 scale.",
    },
    {
      title: "Presentation-ready export",
      body: "Share a polished PDF with partners, lenders, or your accountant in one click.",
    },
  ];
  return (
    <section className="sf-section sf-section--alt">
      <div className="sf-container">
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 48px" }}>
          <div className="sf-eyebrow">What&rsquo;s in every report</div>
          <h2>Eleven sections. Honest figures. Source-linked.</h2>
        </div>
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {features.map((f) => (
            <div key={f.title} className="sf-card">
              <h3 style={{ marginBottom: 8, fontSize: "1.0625rem" }}>{f.title}</h3>
              <p style={{ color: "#555", fontSize: 15, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CaseStudies() {
  const studies = [
    {
      title: "Newcastle NE2 · 3-bed townhouse",
      badge: "University catchment",
      desc: "Three-bed terrace ten minutes from Newcastle Uni. Long-let comparison: £1,150 PCM. Stayful estimate: £2,350 PCM net.",
      metrics: [
        { v: "£2,350", l: "Net /mo" },
        { v: "+104%", l: "vs long-let" },
        { v: "68%", l: "Occupancy" },
      ],
    },
    {
      title: "Manchester M4 · 2-bed flat",
      badge: "City centre",
      desc: "Modern flat near Ancoats. Strong weekday business demand from nearby commercial estate plus weekend leisure crossover.",
      metrics: [
        { v: "£1,820", l: "Net /mo" },
        { v: "+58%", l: "vs long-let" },
        { v: "72%", l: "Occupancy" },
      ],
    },
    {
      title: "Bristol BS6 · 4-bed family home",
      badge: "Family + leisure",
      desc: "Four-bed Victorian in Redland. Larger group ADR offsets lower occupancy; reliable summer + half-term peaks.",
      metrics: [
        { v: "£2,980", l: "Net /mo" },
        { v: "+71%", l: "vs long-let" },
        { v: "61%", l: "Occupancy" },
      ],
    },
  ];
  return (
    <section id="case-studies" className="sf-section">
      <div className="sf-container">
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 40px" }}>
          <div className="sf-eyebrow">Case studies</div>
          <h2>What real reports look like.</h2>
          <p style={{ color: "#555", marginTop: 12 }}>
            Three illustrative properties drawn from the Stayful managed portfolio.
            Net figures shown after platform, cleaning, and management costs.
          </p>
        </div>
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {studies.map((s) => (
            <div key={s.title} className="sf-card">
              <div className="sf-card__top">
                <span className="sf-card__title">{s.title}</span>
                <span className="sf-badge">{s.badge}</span>
              </div>
              <p className="sf-card__desc">{s.desc}</p>
              <div className="sf-metrics">
                {s.metrics.map((m) => (
                  <div key={m.l} className="sf-metric">
                    <span className="sf-metric__val">{m.v}</span>
                    <span className="sf-metric__lbl">{m.l}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p style={{ textAlign: "center", color: "#888", fontSize: 13, marginTop: 24 }}>
          Past performance is not a guarantee of future income. Every property is
          modelled individually — see your own report inside Stayful.
        </p>
      </div>
    </section>
  );
}

function Comparison() {
  const rows: [string, string, string, string][] = [
    ["Real local Airbnb comparables", "Yes — up to 40", "Generic market average", "Manual research"],
    ["Seasonal monthly forecast", "12-month curve, weighted", "Flat annual ÷ 12", "Best-guess"],
    ["Long-let benchmark", "PropertyData live data", "Not included", "Online listings"],
    ["Profit after mortgage + bills", "Built-in calculator", "Not included", "Spreadsheet"],
    ["Risk assessment", "9 dimensions, /100 scored", "Not included", "Hunches"],
    ["Calibrated against managed portfolio", "Yes (PMI-trained)", "Black-box", "None"],
    ["Time to first report", "~30 seconds", "Variable", "Hours"],
  ];
  return (
    <section className="sf-section sf-section--alt">
      <div className="sf-container">
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 32px" }}>
          <div className="sf-eyebrow">How we compare</div>
          <h2>Stayful vs alternatives.</h2>
        </div>
        <div className="sf-table-wrap">
          <table className="sf-table">
            <thead>
              <tr>
                <th></th>
                <th>Stayful</th>
                <th>Generic STR calculators</th>
                <th>DIY / spreadsheet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, a, b, c]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td style={{ color: "#3B7A3B", fontWeight: 600 }}>{a}</td>
                  <td>{b}</td>
                  <td>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const quotes = [
    {
      quote:
        "I had two letting agents tell me my Bristol flat would do £1,200 a month. Stayful&rsquo;s report came back at £1,820 net with the actual comps. The numbers held up when we ran them past the lender.",
      author: "Property investor, Bristol",
    },
    {
      quote:
        "The seasonal breakdown is the bit nobody else does. Knowing that November and February are 35% off peak meant I could plan cashflow properly instead of just dividing the annual by twelve.",
      author: "Existing landlord, Manchester",
    },
    {
      quote:
        "Used the report as appendix material for a buy-to-let conversion application. The data sources page made our case in one read.",
      author: "Mortgage broker, London",
    },
  ];
  return (
    <section className="sf-section">
      <div className="sf-container">
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 40px" }}>
          <div className="sf-eyebrow">What people say</div>
          <h2>Trusted by landlords who already manage property.</h2>
        </div>
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {quotes.map((q) => (
            <div key={q.author} className="sf-card" style={{ borderLeft: "4px solid var(--sf-green)" }}>
              <p style={{ color: "#444", fontSize: 15, margin: "0 0 16px", lineHeight: 1.7 }}>
                &ldquo;{q.quote}&rdquo;
              </p>
              <p style={{ fontSize: 13, color: "#888", margin: 0, fontWeight: 500 }}>— {q.author}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "How accurate are the income estimates?",
      a: "Stayful&rsquo;s estimator is calibrated against the managed Stayful portfolio. On the most recent 30-property calibration set, mean signed error was +8.2% and 70% of estimates landed within ±30% of actual. The full methodology is in every report&rsquo;s Data Sources section.",
    },
    {
      q: "Where do the comparable listings come from?",
      a: "Live Airbnb listing data from Airbtics, filtered by guest capacity, location, and review weight. Long-let benchmarks come from PropertyData. We never use cached or stale results — every analysis is fresh.",
    },
    {
      q: "Do I need to enter card details for the trial?",
      a: "No. The 14-day trial is full-access with no card required. You only enter card details if you choose to upgrade.",
    },
    {
      q: "Is this the same engine you use for management leads?",
      a: "Yes. The same calibrated pipeline that powers Stayful&rsquo;s in-house lead generation now runs every report on this site — same comps logic, same seasonal modelling, same risk framework.",
    },
    {
      q: "Can I export reports?",
      a: "Every report has a presentation-ready export you can share or save as PDF. Useful for lenders, partners, accountants, or just your own records.",
    },
    {
      q: "What happens after my trial ends?",
      a: "Your account is preserved. You keep view-only access to past reports and can upgrade to Pro any time. We won&rsquo;t auto-charge you — you opt in when you&rsquo;re ready.",
    },
  ];
  return (
    <section id="faq" className="sf-section sf-section--alt">
      <div className="sf-container" style={{ maxWidth: 760 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div className="sf-eyebrow">FAQ</div>
          <h2>Common questions.</h2>
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

function FinalCTA() {
  return (
    <section className="sf-section" style={{ paddingTop: 64, paddingBottom: 96 }}>
      <div className="sf-container">
        <div className="sf-card" style={{ background: "var(--sf-green)", borderColor: "var(--sf-green)", textAlign: "center", padding: "56px 28px", color: "#fff" }}>
          <h2 style={{ color: "#fff", marginBottom: 12 }}>
            See what your property could earn.
          </h2>
          <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 17, maxWidth: 560, margin: "0 auto 28px" }}>
            14-day free trial · No credit card · Full access to every report.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/signup"
              className="sf-btn"
              style={{ background: "#fff", color: "var(--sf-green)" }}
            >
              Start free trial
            </Link>
            <Link
              href="/pricing"
              className="sf-btn sf-btn--ghost"
              style={{ borderColor: "#fff", color: "#fff" }}
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
