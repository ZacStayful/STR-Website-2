"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";

export interface CaseStudy {
  id: string;
  title: string;
  city: string;
  meta: string;
  img: string;
  pdf: string;
  estimate: { ownerNet: string; adr: string; occ: string };
  actual: { ownerNet: string; adr: string; occ: string };
}

const SAMPLES: CaseStudy[] = [
  {
    id: "york-park-crescent",
    title: "17 Park Crescent",
    city: "York",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-york-park-crescent.png",
    pdf: "/assets/case-studies/york-park-crescent.pdf",
    estimate: { ownerNet: "£30,940", adr: "£207", occ: "78%" },
    actual: { ownerNet: "£34,727", adr: "£123", occ: "73.9%" },
  },
  {
    id: "leeds-beechwood-mount",
    title: "7 Beechwood Mount",
    city: "Leeds",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-leeds-beechwood-mount.png",
    pdf: "/assets/case-studies/leeds-beechwood-mount.pdf",
    estimate: { ownerNet: "£23,084", adr: "£223", occ: "54%" },
    actual: { ownerNet: "£25,782", adr: "£133", occ: "50.4%" },
  },
  {
    id: "lincoln-museum-court",
    title: "Museum Court",
    city: "Lincoln",
    meta: "2 bed · Sleeps 6",
    img: "/assets/property-lincoln-museum-court.png",
    pdf: "/assets/case-studies/lincoln-museum-court.pdf",
    estimate: { ownerNet: "£32,364", adr: "£251", occ: "68%" },
    actual: { ownerNet: "£36,288", adr: "£148", occ: "64.2%" },
  },
  {
    id: "edinburgh-geissler-drive",
    title: "21 Geissler Drive",
    city: "Edinburgh",
    meta: "1 bed · Sleeps 4",
    img: "/assets/property-edinburgh-geissler-drive.png",
    pdf: "/assets/case-studies/edinburgh-geissler-drive.pdf",
    estimate: { ownerNet: "£36,175", adr: "£252", occ: "77%" },
    actual: { ownerNet: "£46,169", adr: "£171", occ: "78.6%" },
  },
  {
    id: "manchester-eastbank-tower",
    title: "803 Eastbank Tower",
    city: "Manchester",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-manchester-eastbank-tower.png",
    pdf: "/assets/case-studies/manchester-eastbank-tower.pdf",
    estimate: { ownerNet: "£32,422", adr: "£233", occ: "73%" },
    actual: { ownerNet: "£35,917", adr: "£140", occ: "68.7%" },
  },
  {
    id: "salisbury-west-street",
    title: "West Street, Wilton",
    city: "Salisbury",
    meta: "2 bed · Sleeps 6",
    img: "/assets/property-salisbury-west-street.png",
    pdf: "/assets/case-studies/salisbury-west-street.pdf",
    estimate: { ownerNet: "£29,557", adr: "£265", occ: "70%" },
    actual: { ownerNet: "£33,654", adr: "£161", occ: "65.1%" },
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
              Six real reports.
              <br />
              No edits.
            </h2>
          </div>
          <p className="lede">
            Six real properties Stayful analysed in 2025. Each card shows the
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
              <div className="report-card-stats report-card-stats-vs">
                <div className="rc-vs-col">
                  <span className="rc-vs-label">Estimate</span>
                  <div className="rc-vs-row">
                    <span>Owner net</span>
                    <strong>{s.estimate.ownerNet}</strong>
                  </div>
                  <div className="rc-vs-row">
                    <span>ADR</span>
                    <strong>{s.estimate.adr}</strong>
                  </div>
                  <div className="rc-vs-row">
                    <span>Occ</span>
                    <strong>{s.estimate.occ}</strong>
                  </div>
                </div>
                <div className="rc-vs-col rc-vs-actual">
                  <span className="rc-vs-label">Actual</span>
                  <div className="rc-vs-row">
                    <span>Owner net</span>
                    <strong>{s.actual.ownerNet}</strong>
                  </div>
                  <div className="rc-vs-row">
                    <span>ADR</span>
                    <strong>{s.actual.adr}</strong>
                  </div>
                  <div className="rc-vs-row">
                    <span>Occ</span>
                    <strong>{s.actual.occ}</strong>
                  </div>
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
          <div className="row gap-12 center">
            <a
              className="btn btn-ghost btn-sm"
              href={sample.pdf}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="download" size={13} /> Open PDF
            </a>
            <button
              className="report-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
        <div className="report-modal-body cs-modal-pdf">
          <iframe
            src={sample.pdf}
            title={`${sample.title}, ${sample.city} — Stayful case study`}
            aria-label={`${sample.title}, ${sample.city} — Stayful case study`}
          />
        </div>
      </div>
    </div>
  );
}
