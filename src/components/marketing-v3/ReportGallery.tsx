"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";
import { VerifiedTag } from "./VerifiedTag";
import {
  CASE_STUDIES,
  METRIC_LABELS,
  formatMetric,
  type CaseStudy,
  type MetricKey,
} from "@/lib/case-studies-data";

// Metrics shown on the card face. ADR is absent on purpose — see the note in
// case-studies-data.ts. It appears on /methodology, where the mismatch
// between the forecast and actual definitions can be explained properly.
const CARD_METRICS: MetricKey[] = ["ownerNet", "occupancy"];

export function ReportGallery() {
  const [open, setOpen] = useState<CaseStudy | null>(null);

  return (
    <section className="report-gallery section" id="reports">
      <div className="wrap">
        <div className="gallery-head">
          <div>
            <div className="eyebrow">The evidence</div>
            <h2>
              Six real properties.
              <br />
              Open the files.
            </h2>
          </div>
          <p className="lede">
            The full case study for each of the six — the estimate we produced
            before the property went live, the year it actually had, and the
            PDF we would hand a lender. Named addresses, not anonymised
            comparables.
          </p>
        </div>
        <div className="gallery-grid">
          {CASE_STUDIES.map((s) => (
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
                  <VerifiedTag tone="operated" label="Stayful-managed" />
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
                  {CARD_METRICS.map((key) => (
                    <div key={key} className="rc-vs-row">
                      <span>{METRIC_LABELS[key]}</span>
                      <strong>
                        {formatMetric(key, s.metrics[key].forecast)}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="rc-vs-col rc-vs-actual">
                  <span className="rc-vs-label">Actual</span>
                  {CARD_METRICS.map((key) => (
                    <div key={key} className="rc-vs-row">
                      <span>{METRIC_LABELS[key]}</span>
                      <strong>
                        {formatMetric(key, s.metrics[key].actual)}
                      </strong>
                    </div>
                  ))}
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
