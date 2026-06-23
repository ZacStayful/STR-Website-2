"use client";

import { useEffect, useState } from "react";
import { C, ratingColors } from "../../_lib/brand";
import type { RiskData } from "../../_lib/types";
import { ChapterHeader } from "../ui/ChapterHeader";

function overallColor(score: number): string {
  if (score <= 35) return C.green;
  if (score <= 55) return C.amber;
  return C.red;
}

export function RiskChapter({ risk }: { risk: RiskData }) {
  const [count, setCount] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setCount(Math.round(risk.overall * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t = setTimeout(() => setMounted(true), 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [risk.overall]);

  const oColor = overallColor(risk.overall);

  return (
    <div className="sr-chapter-enter">
      <ChapterHeader
        number="04"
        title="Risk profile"
        subtitle="Not all STR opportunities are equal. Here are the six factors that determine how risky this property is to short let."
      />

      <div
        style={{
          border: `1px solid ${C.gray200}`,
          borderRadius: 12,
          padding: "1.25rem",
          marginTop: 16,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 12, color: C.gray500 }}>Overall STR risk score</div>
        <div style={{ fontSize: 52, fontWeight: 500, color: oColor, lineHeight: 1.1 }}>{count}</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: oColor }}>{risk.overallRating} risk</div>
        <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>Score out of 100 · lower is better</div>
      </div>

      <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "1rem 1.25rem", marginTop: 16 }}>
        {risk.factors.map((f) => {
          const rc = ratingColors(f.rating);
          return (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div className="sr-risk-label" style={{ fontSize: 12, color: C.gray800, flexShrink: 0 }}>
                {f.label}
              </div>
              <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: mounted ? `${f.score}%` : "0%",
                    background: rc.fill,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
              <span
                style={{
                  background: rc.bg,
                  color: rc.tx,
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "2px 8px",
                  borderRadius: 999,
                  flexShrink: 0,
                }}
              >
                {f.rating}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "1rem 1.25rem", marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 6 }}>Key risk to watch</div>
        <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, margin: 0 }}>{risk.keyRisk}</p>
      </div>
    </div>
  );
}
