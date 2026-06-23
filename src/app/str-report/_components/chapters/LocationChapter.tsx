"use client";

import { useEffect, useState } from "react";
import { C, ratingColors } from "../../_lib/brand";
import type { MarketData, PropertyInput } from "../../_lib/types";
import {
  directBookingRating,
  directBookingScore,
  localAreaAnalysis,
  whyBookReasons,
} from "../../_lib/location";
import { ChapterHeader } from "../ui/ChapterHeader";

const cardStyle: React.CSSProperties = {
  border: `1px solid ${C.gray200}`,
  borderRadius: 12,
  padding: "1rem 1.25rem",
  marginTop: 16,
};

function ScoreRing({ score, color }: { score: number; color: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setShown(Math.round(score * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - shown / 100);

  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r={r} fill="none" stroke={C.gray200} strokeWidth="10" />
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 64 64)"
        style={{ transition: "stroke-dashoffset 0.1s linear" }}
      />
      <text x="64" y="62" textAnchor="middle" fontSize="30" fontWeight="500" fill={color}>
        {shown}
      </text>
      <text x="64" y="82" textAnchor="middle" fontSize="11" fill={C.gray400}>
        / 100
      </text>
    </svg>
  );
}

export function LocationChapter({ input, market }: { input: PropertyInput; market: MarketData }) {
  const score = directBookingScore(input, market);
  const { rating, label } = directBookingRating(score);
  const rc = ratingColors(rating);
  const reasons = whyBookReasons(input, market);
  const area = localAreaAnalysis(input, market);

  return (
    <div className="sr-chapter-enter">
      <ChapterHeader
        number="02"
        title="Location & demand"
        subtitle={`Who books in ${input.postcode}, why they come, and how strong the direct-booking opportunity is.`}
      />

      {/* Direct booking score */}
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flexShrink: 0 }}>
          <ScoreRing score={score} color={rc.fill} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>Direct booking score</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: rc.fill, marginTop: 2 }}>{label} potential</div>
          <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6, margin: "8px 0 0" }}>
            How well this location lends itself to building repeat and direct bookings — reducing platform
            fees over time. Driven by demand diversity, occupancy and how saturated the market is.
          </p>
        </div>
      </div>

      {/* Why people book this location */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 10 }}>
          Why people book this location
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {reasons.map((rsn) => (
            <div
              key={rsn.title}
              style={{ background: C.gray50, borderRadius: 8, padding: "0.75rem 0.9rem" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.gray900 }}>{rsn.title}</span>
                <span
                  style={{
                    background: C.greenLt,
                    color: C.greenTx,
                    fontSize: 11,
                    fontWeight: 500,
                    padding: "1px 8px",
                    borderRadius: 999,
                    flexShrink: 0,
                  }}
                >
                  {rsn.share}% of demand
                </span>
              </div>
              <p style={{ fontSize: 12, color: C.gray500, lineHeight: 1.6, margin: "4px 0 0" }}>{rsn.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Local area analysis */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 8 }}>
          Local area analysis
        </div>
        <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, margin: "0 0 12px" }}>{area.summary}</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
          }}
        >
          {area.highlights.map((h) => (
            <div key={h.label} style={{ background: C.gray50, borderRadius: 8, padding: "0.7rem 0.8rem" }}>
              <div style={{ fontSize: 11, color: C.gray400 }}>{h.label}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: C.gray900, marginTop: 2 }}>{h.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
