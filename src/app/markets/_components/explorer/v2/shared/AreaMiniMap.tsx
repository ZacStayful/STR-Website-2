"use client";

import { useUkGeo, MAP_W, MAP_H } from "../../../useUkGeo";

/**
 * The UK map zoomed onto one postcode area (the design's market-page map and
 * header thumbnail). Areas that have data are tinted so the neighbourhood
 * reads; everything else is the no-data grey.
 */
export function AreaMiniMap({ code, dataCodes, className = "", label }: { code: string; dataCodes?: ReadonlySet<string>; className?: string; label?: string }) {
  const { paths, failed } = useUkGeo();
  const mine = paths.filter((p) => p.area === code);
  let viewBox = `0 0 ${MAP_W} ${MAP_H}`;
  if (mine.length) {
    const x0 = Math.min(...mine.map((p) => p.bbox[0]));
    const y0 = Math.min(...mine.map((p) => p.bbox[1]));
    const x1 = Math.max(...mine.map((p) => p.bbox[2]));
    const y1 = Math.max(...mine.map((p) => p.bbox[3]));
    const w = x1 - x0;
    const h = y1 - y0;
    const m = Math.max(w, h) * 0.9;
    viewBox = `${(x0 - m).toFixed(1)} ${(y0 - m).toFixed(1)} ${(w + 2 * m).toFixed(1)} ${(h + 2 * m).toFixed(1)}`;
  }
  if (failed) return <div className={`mx2-minimap mx2-minimap--empty ${className}`} aria-hidden="true" />;
  if (paths.length === 0) return <div className={`mx2-minimap mx2-minimap--loading ${className}`} aria-hidden="true" />;
  return (
    <svg className={`mx2-minimap ${className}`} viewBox={viewBox} role="img" aria-label={label ?? `${code} on the UK map`}>
      {paths.map((p) => {
        const me = p.area === code;
        const has = dataCodes?.has(p.area) ?? false;
        return <path key={p.area} d={p.d} fill={me ? "#3a5634" : has ? "#c3d1ab" : "#e8e8e2"} stroke={me ? "#2e3d2b" : "#ffffff"} strokeWidth={me ? 1.2 : 0.5} />;
      })}
    </svg>
  );
}
