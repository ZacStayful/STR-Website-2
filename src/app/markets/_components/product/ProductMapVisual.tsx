"use client";

import { useUkGeo, MAP_W, MAP_H } from "../useUkGeo";

/**
 * Non-interactive UK map for the public product page. Shading is ILLUSTRATIVE —
 * a deterministic pattern seeded by the postcode-area code, quantised into the
 * explorer's four bands, never real market figures — so the page can look like
 * the explorer without leaking its data.
 */

function seed(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** The explorer's four quantile bands, lightest to darkest. */
const BANDS = ["#cdd8c4", "#a2b299", "#6e8467", "#3a5634"];
const NO_DATA = "#e8e8e2";

function band(t: number): string {
  // Roughly a third of areas have no data yet; the rest fall into four bands.
  if (t < 0.34) return NO_DATA;
  return BANDS[Math.min(3, Math.floor(((t - 0.34) / 0.66) * 4))];
}

export function ProductMapVisual({ highlight = [], compact = false }: { highlight?: string[]; compact?: boolean }) {
  const { paths, failed } = useUkGeo();
  const hl = new Set(highlight.map((h) => h.toUpperCase()));

  if (failed) return <div className="mxp-map-fallback" aria-hidden />;

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className={"mxp-map" + (compact ? " compact" : "")}
      role="img"
      aria-label="Illustrative UK postcode-area map"
    >
      {paths.map((p, i) => {
        const t = seed(p.area);
        const isHl = hl.has(p.area);
        return (
          <path
            key={p.area}
            d={p.d}
            fill={isHl ? "#5d8156" : band(t)}
            stroke="#ffffff"
            strokeWidth={0.5}
            className="mxp-map-area"
            style={{ animationDelay: `${(i % 23) * 90}ms` }}
          />
        );
      })}
    </svg>
  );
}
