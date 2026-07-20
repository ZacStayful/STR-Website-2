"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { gbp, pct } from "@/lib/market/format";

export interface MapArea {
  code: string;
  slug: string;
  name: string;
  tier: "confirmed" | "building" | "early";
  tierLabel: string;
  samples: number;
  grossRevenue: number | null;
  adr: number | null;
  occupancy: number | null;
  yieldPct: number | null;
  score: number | null;
}

type Metric = "accuracy" | "yield" | "occupancy" | "revenue";

const METRICS: { key: Metric; label: string }[] = [
  { key: "accuracy", label: "Data accuracy" },
  { key: "yield", label: "Yield-on-cost" },
  { key: "occupancy", label: "Occupancy" },
  { key: "revenue", label: "Avg revenue" },
];

function metricValue(a: MapArea, m: Metric): number | null {
  if (m === "yield") return a.yieldPct;
  if (m === "occupancy") return a.occupancy;
  if (m === "revenue") return a.grossRevenue;
  return null;
}

// Sequential green ramp, pale → deep, for numeric heat metrics.
function greenRamp(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const lo = [231, 239, 221]; // #e7efdd
  const hi = [58, 86, 52]; // #3a5634
  const ch = (i: number) => Math.round(lo[i] + (hi[i] - lo[i]) * c);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

interface Feature {
  properties: { area: string };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

// Green → pale = most accurate → least; grey = no data.
const TIER_FILL: Record<string, string> = {
  confirmed: "#4c6b47",
  building: "#7fa578",
  early: "#c3d1ab",
};
const NO_DATA_FILL = "#e8e8e2";
const W = 760;
const H = 920;

export function UKMap({ areas }: { areas: MapArea[] }) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [metric, setMetric] = useState<Metric>("accuracy");
  const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/data/uk-postcode-areas.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setFeatures(d.features as Feature[]))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const areaByCode = useMemo(() => {
    const m = new Map<string, MapArea>();
    for (const a of areas) m.set(a.code.toUpperCase(), a);
    return m;
  }, [areas]);

  const project = useMemo(() => {
    if (!features) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of features)
      for (const poly of f.geometry.coordinates)
        for (const ring of poly)
          for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
    const latMid = (minLat + maxLat) / 2;
    const cos = Math.cos((latMid * Math.PI) / 180);
    const spanX = (maxLng - minLng) * cos;
    const spanY = maxLat - minLat;
    const pad = 16;
    const k = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const offX = (W - spanX * k) / 2;
    const offY = (H - spanY * k) / 2;
    return (lng: number, lat: number): [number, number] => [
      offX + (lng - minLng) * cos * k,
      offY + (maxLat - lat) * k,
    ];
  }, [features]);

  const paths = useMemo(() => {
    if (!features || !project) return [];
    return features.map((f) => {
      let d = "";
      for (const poly of f.geometry.coordinates)
        for (const ring of poly) {
          ring.forEach(([lng, lat], i) => {
            const [x, y] = project(lng, lat);
            d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
          });
          d += "Z";
        }
      return { area: f.properties.area.toUpperCase(), d };
    });
  }, [features, project]);

  function zoomBy(factor: number, cx = W / 2, cy = H / 2) {
    setView((v) => {
      const k = Math.min(12, Math.max(1, v.k * factor));
      // keep the point (cx,cy) stationary
      const x = cx - ((cx - v.x) * k) / v.k;
      const y = cy - ((cy - v.y) * k) / v.k;
      return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x, y };
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = ((e.clientX - rect.left) / rect.width) * W;
    const cy = ((e.clientY - rect.top) / rect.height) * H;
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const sx = W / rect.width;
    const sy = H / rect.height;
    setView((v) => ({
      ...v,
      x: drag.current!.vx + (e.clientX - drag.current!.px) * sx,
      y: drag.current!.vy + (e.clientY - drag.current!.py) * sy,
    }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  // Value domain for the active numeric metric (min/max over areas with data).
  const domain = useMemo(() => {
    if (metric === "accuracy") return null;
    const vals = areas.map((a) => metricValue(a, metric)).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, max: max === min ? min + 1 : max };
  }, [areas, metric]);

  function fillFor(a: MapArea | undefined): string {
    if (!a) return NO_DATA_FILL;
    if (metric === "accuracy") return TIER_FILL[a.tier];
    const v = metricValue(a, metric);
    if (v === null || !domain) return NO_DATA_FILL;
    return greenRamp((v - domain.min) / (domain.max - domain.min));
  }

  const fmtDomain = (v: number) =>
    metric === "revenue" ? gbp(v) : metric === "occupancy" ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;

  const sel = selected ? areaByCode.get(selected) ?? null : null;

  if (failed) {
    return (
      <div className="mx-empty">
        <h2>Map unavailable</h2>
        <p>We couldn’t load the map right now. Try the list view instead.</p>
      </div>
    );
  }

  return (
    <div className="mx-map-wrap">
      <div
        className="mx-map"
        ref={wrapRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {!features ? (
          <div className="mx-map-loading">Loading map…</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="mx-map-svg" role="img" aria-label="UK short-term-rental data map">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {paths.map((p) => {
                const a = areaByCode.get(p.area);
                const fill = fillFor(a);
                const isSel = selected === p.area;
                const isHover = hover === p.area;
                return (
                  <path
                    key={p.area}
                    d={p.d}
                    fill={fill}
                    stroke={isSel ? "#2E3D2B" : "#ffffff"}
                    strokeWidth={(isSel ? 1.6 : isHover ? 1.1 : 0.4) / view.k}
                    fillOpacity={a ? (isHover || isSel ? 1 : 0.92) : 0.7}
                    style={{ cursor: a ? "pointer" : "default" }}
                    onMouseEnter={() => setHover(p.area)}
                    onMouseLeave={() => setHover((h) => (h === p.area ? null : h))}
                    onClick={() => a && setSelected(p.area)}
                  />
                );
              })}
            </g>
          </svg>
        )}

        {/* Heat-metric toggle */}
        <div className="mx-map-metric" role="group" aria-label="Colour map by">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className="mx-map-metric-btn"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="mx-map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
          <button type="button" aria-label="Reset" onClick={() => setView({ k: 1, x: 0, y: 0 })}>⟲</button>
        </div>

        {/* Legend — categorical for accuracy, gradient for numeric metrics */}
        <div className="mx-map-legend">
          {metric === "accuracy" ? (
            <>
              <div className="mx-map-legend-title">Data accuracy</div>
              <div><span style={{ background: TIER_FILL.confirmed }} />Confirmed</div>
              <div><span style={{ background: TIER_FILL.building }} />Building</div>
              <div><span style={{ background: TIER_FILL.early }} />Early</div>
              <div><span style={{ background: NO_DATA_FILL }} />No data yet</div>
            </>
          ) : (
            <>
              <div className="mx-map-legend-title">{METRICS.find((m) => m.key === metric)?.label}</div>
              <div className="mx-map-legend-bar" style={{ background: `linear-gradient(90deg, ${greenRamp(0)}, ${greenRamp(1)})` }} />
              <div className="mx-map-legend-scale">
                <span>{domain ? fmtDomain(domain.min) : "low"}</span>
                <span>{domain ? fmtDomain(domain.max) : "high"}</span>
              </div>
              <div><span style={{ background: NO_DATA_FILL }} />No data</div>
            </>
          )}
        </div>

        {hover && !sel && (
          <div className="mx-map-hint">{areaByCode.get(hover)?.name ?? `${hover} — no data yet`}</div>
        )}
      </div>

      {/* Click popup */}
      {sel && (
        <div className="mx-map-popup">
          <button type="button" className="mx-map-popup-close" aria-label="Close" onClick={() => setSelected(null)}>×</button>
          <div className={`mx-conf mx-conf--${sel.tier}`} style={{ marginBottom: 8 }}>
            <span className="mx-conf-dot" />{sel.tierLabel} · {sel.samples} {sel.samples === 1 ? "sample" : "samples"}
          </div>
          <h3 style={{ margin: "0 0 10px" }}>{sel.name} <span style={{ color: "var(--mx-muted)", fontWeight: 400 }}>({sel.code})</span></h3>
          <div className="mx-map-popup-stats">
            <div><strong>{gbp(sel.grossRevenue)}</strong><span>avg revenue / yr</span></div>
            <div><strong>{gbp(sel.adr)}</strong><span>ADR</span></div>
            <div><strong>{pct(sel.occupancy, 0)}</strong><span>occupancy</span></div>
          </div>
          <Link href={`/markets/${sel.slug}`} className="mx-cta" style={{ marginTop: 4 }}>
            View full {sel.name} report →
          </Link>
        </div>
      )}
    </div>
  );
}
