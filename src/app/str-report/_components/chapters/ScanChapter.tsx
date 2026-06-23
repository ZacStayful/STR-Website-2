"use client";

import { useEffect, useState } from "react";
import { C } from "../../_lib/brand";
import type { MarketData, PropertyInput } from "../../_lib/types";

const DURATION = 3500;
const LINE_INTERVAL = 540;

export function ScanChapter({
  input,
  market,
  onDone,
}: {
  input: PropertyInput;
  market: MarketData;
  onDone: () => void;
}) {
  const [fill, setFill] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);

  const lines = [
    `Locating STR properties near ${input.postcode}...`,
    `Analysing ${market.listingCount} comparable listings...`,
    `Pulling occupancy & ADR data for ${input.beds}-beds...`,
    `Modelling seasonal demand patterns...`,
    `Calculating your net income range...`,
    `Assessing local market risk factors...`,
  ];

  useEffect(() => {
    // Trigger the CSS width transition after mount.
    const raf = requestAnimationFrame(() => setFill(100));
    const advance = setTimeout(onDone, DURATION);
    const cycle = setInterval(() => {
      setLineIndex((i) => (i + 1) % lines.length);
    }, LINE_INTERVAL);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(advance);
      clearInterval(cycle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sr-chapter-enter" style={{ textAlign: "center", padding: "32px 0" }}>
      <h2 style={{ fontSize: 20, fontWeight: 500, color: C.gray900, margin: 0 }}>
        Building your intelligence report
      </h2>
      <p style={{ fontSize: 14, color: C.gray500, margin: "10px 0 0" }}>
        Analysing your local market — just a moment
      </p>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "28px 0" }}>
        {[0, 0.2, 0.4].map((delay, i) => (
          <span
            key={i}
            className="sr-pulse-dot"
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: C.green,
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>

      <p style={{ fontSize: 13, color: C.gray400, minHeight: 36, margin: "0 0 18px" }}>
        {lines[lineIndex]}
      </p>

      <div style={{ height: 4, borderRadius: 2, background: C.gray200, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${fill}%`,
            background: C.green,
            transition: `width ${DURATION}ms linear`,
          }}
        />
      </div>
    </div>
  );
}
