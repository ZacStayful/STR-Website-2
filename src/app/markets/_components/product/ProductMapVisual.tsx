"use client";

import { useUkGeo, MAP_W, MAP_H } from "../useUkGeo";

/**
 * Non-interactive UK map for the public product page. Shading is ILLUSTRATIVE —
 * a deterministic pattern seeded by the postcode-area code, never real market
 * figures — so the page can look like the explorer without leaking its data.
 */

function seed(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function ramp(t: number): string {
  const lo = [231, 239, 221];
  const hi = [58, 86, 52];
  const ch = (i: number) => Math.round(lo[i] + (hi[i] - lo[i]) * t);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
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
            fill={isHl ? "#2e3d2b" : ramp(0.15 + t * 0.7)}
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
