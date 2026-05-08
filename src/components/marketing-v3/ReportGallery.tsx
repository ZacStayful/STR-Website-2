"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";

export interface CaseStudy {
  id: string;
  title: string;
  city: string;
  meta: string;
  img: string;
  est: string;
  estM: string;
  net: string;
  netM: string;
  adr: string;
  occ: string;
  compCount: number;
  actual: {
    occ: string;
    nights: number;
    gross: string;
    net: string;
    ownerNet: string;
    gdr: string;
    ndr: string;
    odr: string;
    stay: number;
    lead: number;
  };
}

const SAMPLES: CaseStudy[] = [
  {
    id: "york",
    title: "Flat 14, Chapel Apartments",
    city: "York",
    meta: "2 bed · Sleeps 4",
    img: "/assets/property-terrace.png",
    est: "£52,561",
    estM: "£4,380 / month",
    net: "£27,331",
    netM: "£2,278 / month",
    adr: "£170",
    occ: "90%",
    compCount: 10,
    actual: {
      occ: "85.99%",
      nights: 313,
      gross: "£48,362",
      net: "£36,670",
      ownerNet: "£30,543",
      gdr: "£154.51",
      ndr: "£117.16",
      odr: "£97.58",
      stay: 2.72,
      lead: 30.4,
    },
  },
  {
    id: "leeds",
    title: "7 Beechwood Mount",
    city: "Leeds",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-interior.png",
    est: "£62,604",
    estM: "£5,217 / month",
    net: "£32,554",
    netM: "£2,713 / month",
    adr: "£258",
    occ: "72%",
    compCount: 12,
    actual: {
      occ: "68.06%",
      nights: 245,
      gross: "£57,595",
      net: "£44,469",
      ownerNet: "£37,018",
      gdr: "£235.08",
      ndr: "£181.51",
      odr: "£151.09",
      stay: 2.55,
      lead: 40.1,
    },
  },
  {
    id: "lincoln",
    title: "9 Museum Court",
    city: "Lincoln",
    meta: "2 bed · Sleeps 4",
    img: "/assets/property-coastal.png",
    est: "£37,187",
    estM: "£3,099 / month",
    net: "£19,337",
    netM: "£1,611 / month",
    adr: "£133",
    occ: "82%",
    compCount: 12,
    actual: {
      occ: "77.78%",
      nights: 280,
      gross: "£34,213",
      net: "£26,528",
      ownerNet: "£22,226",
      gdr: "£122.19",
      ndr: "£94.74",
      odr: "£79.38",
      stay: 3.7,
      lead: 23.2,
    },
  },
];

export function ReportGallery() {
  const [open, setOpen] = useState<CaseStudy | null>(null);

  return (
    <section className="report-gallery section" id="reports">
      <div className="wrap">
        <div className="gallery-head">
          <div>
            <div className="eyebrow">Sample output</div>
            <h2>
              Three real reports.
              <br />
              No edits.
            </h2>
          </div>
          <p className="lede">
            Three real properties Stayful analysed in 2025. Each card shows the
            original Income Estimate next to actual 2025 performance from the
            Airbnb dashboard — the model vs the result.
          </p>
        </div>
        <div className="gallery-grid">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              className="report-card"
              onClick={() => setOpen(s)}
            >
              <div
                className="report-card-img"
                style={{ backgroundImage: `url(${s.img})` }}
              >
                <span className="report-card-tag">
                  <Icon name="file" size={11} /> Real case study
                </span>
              </div>
              <h3 className="report-card-title">
                {s.title}
                <span className="report-card-city">{s.city}</span>
              </h3>
              <div className="report-card-meta">{s.meta}</div>
              <div className="report-card-stats">
                <div>
                  <span>Owner net</span>
                  <strong>{s.actual.ownerNet}</strong>
                </div>
                <div>
                  <span>Filtered est.</span>
                  <strong>{s.est}</strong>
                </div>
                <div>
                  <span>Actual occ</span>
                  <strong>{s.actual.occ}</strong>
                </div>
              </div>
              <div className="report-card-cta">
                View case study <Icon name="arrow" size={13} />
              </div>
            </button>
          ))}
        </div>
      </div>
      {open && <ReportModal sample={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ReportModal({
  sample,
  onClose,
}: {
  sample: CaseStudy;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="report-modal" onClick={onClose}>
      <div
        className="report-modal-inner"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="report-modal-head">
          <div
            className="row gap-12 center"
            style={{ justifyContent: "flex-start" }}
          >
            <span className="brand-mark">Stayful</span>
            <span className="muted" style={{ fontSize: 13 }}>
              / Case study — {sample.title}, {sample.city}
            </span>
          </div>
          <button className="report-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="report-modal-body">
          <CaseStudyReport sample={sample} />
        </div>
      </div>
    </div>
  );
}

function CaseStudyReport({ sample }: { sample: CaseStudy }) {
  const a = sample.actual;
  return (
    <div className="cs">
      {/* Page 1 — Income Estimate (light) */}
      <div className="cs-page">
        <div className="cs-page-tag">Page 1 · Income Estimate</div>
        <div className="cs-h1">
          <span className="brand-mark" style={{ fontSize: 36 }}>
            Stayful
          </span>
        </div>
        <div className="cs-eyebrow">Income Estimate</div>
        <h2 className="cs-title">
          {sample.title}
          <br />
          <span>{sample.city}</span>
        </h2>
        <div className="cs-sub">{sample.meta}</div>
        <div className="cs-hero">
          <div className="cs-hero-block">
            <div className="cs-l">Your filtered estimate</div>
            <div className="cs-l-sub">Jan 1, 2025 — Dec 31, 2025</div>
            <div className="cs-big">{sample.est}</div>
            <div className="cs-big-sub">{sample.estM}</div>
          </div>
          <div className="cs-hero-block">
            <div className="cs-l">Net revenue</div>
            <div className="cs-l-sub">After platform fees, cleaning, laundry &amp; management</div>
            <div className="cs-big">{sample.net}</div>
            <div className="cs-big-sub">{sample.netM}</div>
          </div>
        </div>
        <div className="cs-stats">
          <div>
            <span>Average daily rate</span>
            <strong>{sample.adr}</strong>
          </div>
          <div>
            <span>Occupancy</span>
            <strong>{sample.occ}</strong>
          </div>
          <div>
            <span>Comparables</span>
            <strong>{sample.compCount}</strong>
          </div>
        </div>
        <div className="cs-foot">
          stayful.co.uk · Income Estimation Software
          <br />
          Estimates based on live Airbnb &amp; Booking.com market data. Individual results may vary.
        </div>
      </div>

      {/* Page 2 — Actual 2025 Performance (dark) */}
      <div className="cs-page cs-page-dark">
        <div className="cs-page-tag" style={{ color: "rgba(239,236,225,0.55)" }}>
          Page 2 · Actual 2025 Performance
        </div>
        <div className="cs-eyebrow" style={{ color: "var(--sage-200)" }}>
          Insights
        </div>
        <h3 className="cs-h3">Actionable insights and key performance indicators</h3>
        <div className="cs-sub" style={{ color: "rgba(239,236,225,0.6)" }}>
          Jan 1, 2025 — Dec 31, 2025 · {sample.title}, {sample.city}
          <br />
          Metrics are updated every 24 hours from the Airbnb dashboard.
        </div>
        <div className="cs-kpi-grid">
          <div className="cs-kpi"><span>Occupancy</span><strong>{a.occ}</strong></div>
          <div className="cs-kpi"><span>Average length of stay</span><strong>{a.stay} nights</strong></div>
          <div className="cs-kpi"><span>Booked nights</span><strong>{a.nights}</strong></div>
          <div className="cs-kpi"><span>Average lead time</span><strong>{a.lead} days</strong></div>
          <div className="cs-kpi"><span>Gross revenue (GBP)</span><strong>{a.gross}</strong></div>
          <div className="cs-kpi"><span>Net revenue (GBP)</span><strong>{a.net}</strong></div>
          <div className="cs-kpi"><span>Owner net revenue (GBP)</span><strong>{a.ownerNet}</strong></div>
          <div className="cs-kpi"><span>Gross daily rate (GBP)</span><strong>{a.gdr}</strong></div>
          <div className="cs-kpi"><span>Net daily rate (GBP)</span><strong>{a.ndr}</strong></div>
          <div className="cs-kpi"><span>Owner daily rate (GBP)</span><strong>{a.odr}</strong></div>
        </div>
        <div className="cs-compare">
          <div className="cs-compare-l">Estimate vs reality</div>
          <div className="cs-compare-grid">
            <div>
              <span>Estimated owner net</span>
              <strong>{sample.net}</strong>
            </div>
            <div className="sep">vs</div>
            <div>
              <span>Actual owner net</span>
              <strong>{a.ownerNet}</strong>
            </div>
          </div>
        </div>
        <div className="cs-foot" style={{ color: "rgba(239,236,225,0.5)" }}>
          Data: Airbnb host dashboard · Verified by Stayful.
        </div>
      </div>
    </div>
  );
}
