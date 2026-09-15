"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { CaseStudyModal } from "./CaseStudyModal";
import { DATA_SOURCES } from "@/lib/provenance-data";
import { CASE_STUDIES, type CaseStudy } from "@/lib/case-studies-data";

// Sources and case studies come from the canonical modules so this panel,
// the marketing pages and the footer cannot disagree about what we use or
// what evidence exists. The previous inline lists named seven case studies,
// four of which had no real document behind them.

export function AccuracyPanel() {
  const [expanded, setExpanded] = useState(false);
  const [openStudy, setOpenStudy] = useState<CaseStudy | null>(null);

  return (
    <div className="rounded-xl border border-primary-foreground/15 bg-primary p-5 text-primary-foreground">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">🔍</span>
          <span className="text-[14px] font-semibold">
            Is this information accurate?
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-flex shrink-0 items-center rounded-full border border-primary-foreground/20 bg-primary-foreground/15 px-2.5 py-0.5 text-[11px] text-primary-foreground">
            High Confidence
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-primary-foreground/80 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <>
          {/* 4-column source grid */}
          <div className="mt-[14px] grid gap-[10px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {DATA_SOURCES.map((s) => (
              <div
                key={s.name}
                className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10"
                style={{ padding: "12px 14px" }}
              >
                <p className="text-[11px] font-semibold text-primary-foreground" style={{ marginBottom: 2 }}>
                  {s.name}
                </p>
                <p className="text-[11px] text-primary-foreground/70" style={{ marginBottom: 8 }}>
                  {s.produces}
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 overflow-hidden rounded-sm bg-primary-foreground/20"
                    style={{ height: 4 }}
                  >
                    <div
                      className="rounded-sm bg-primary-foreground"
                      style={{ height: 4, width: `${s.confidence}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-primary-foreground">
                    {s.confidence}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Case-study buttons */}
          <div className="mt-4 border-t border-primary-foreground/15 pt-3">
            <p className="mb-2 text-center text-[11px] font-semibold text-primary-foreground">
              Case Studies
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {CASE_STUDIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpenStudy(c)}
                  className="rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/20"
                >
                  {c.city}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <CaseStudyModal
        city={openStudy?.city ?? null}
        pdfUrl={openStudy?.pdf ?? null}
        onClose={() => setOpenStudy(null)}
      />
    </div>
  );
}
