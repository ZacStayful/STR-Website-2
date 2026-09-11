"use client";

import { useMemo, useRef, useState } from "react";
import { gbp } from "@/lib/market/format";
import { useUkGeo, MAP_W as W, MAP_H as H } from "../useUkGeo";
import { MAP_METRICS, type ExplorerRow, type MapMetric } from "./types";

/**
 * Controlled UK choropleth: the shell owns selection/hover, this pane owns
 * zoom/pan. Fill colour follows one metric at a time on a single sage ramp
 * (competition uses amber so "busy" reads as caution, not quality).
 */

const TIER_FILL: Record<string, string> = { confirmed: "#4c6b47", building: "#7fa578", early: "#c3d1ab" };
const NO_DATA_FILL = "#e8e8e2";

function ramp(t: number, amber = false): string {
  const c = Math.max(0, Math.min(1, t));
  const lo = amber ? [245, 239, 224] : [231, 239, 221];
  const hi = amber ? [154, 123, 46] : [58, 86, 52];
  const ch = (i: number) => Math.round(lo[i] + (hi[i] - lo[i]) * c);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

export function metricValue(row: ExplorerRow, m: MapMetric): number | null {
  const c = row.card;
  switch (m) {
    case "score": return c.score?.score ?? null;
    case "personal": return row.personal?.score ?? null;
    case "yield": return c.yieldOnCost?.grossYieldPct ?? null;
    case "occupancy": return c.headline.occupancy;
    case "revenue": return c.headline.grossRevenue;
    case "competition": return c.competition?.percentile ?? null;
    case "directBooking": return c.directBooking?.score ?? null;
    case "accuracy": return null;
  }
}

function fmtMetric(v: number, m: MapMetric): string {
  if (m === "revenue") return gbp(v);
  if (m === "occupancy" || m === "yield") return `${v.toFixed(m === "yield" ? 1 : 0)}%`;
  if (m === "competition") return `${Math.round(v)}th pct`;
  return String(Math.round(v));
}

export function MapPane({
  rows,
  selected,
  hover,
  onSelect,
  onHover,
  metric,
  onMetricChange,
  hasGoals,
  home,
  pins = [],
  onPinClick,
}: {
  rows: ExplorerRow[];
  selected: string | null;
  hover: string | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  metric: MapMetric;
  onMetricChange: (m: MapMetric) => void;
  hasGoals: boolean;
  home: { lat: number; lng: number; radiusMiles: number | null } | null;
  /** Checked listings drawn as dots, coloured by pipeline status. */
  pins?: { id: string; lat: number; lng: number; colour: string; label: string; active?: boolean }[];
  onPinClick?: (id: string) => void;
}) {
  const { features, paths, failed, project } = useUkGeo();
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  // Survives pointerup so the click that follows a pan can be ignored.
  const movedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const byCode = useMemo(() => new Map(rows.map((r) => [r.card.code, r])), [rows]);

  const domain = useMemo(() => {
    if (metric === "accuracy") return null;
    const vals = rows.map((r) => metricValue(r, metric)).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, max: max === min ? min + 1 : max };
  }, [rows, metric]);

  function fillFor(row: ExplorerRow | undefined): string {
    if (!row) return NO_DATA_FILL;
    if (metric === "accuracy") return TIER_FILL[row.card.confidence.tier];
    const v = metricValue(row, metric);
    if (v === null || !domain) return NO_DATA_FILL;
    return ramp((v - domain.min) / (domain.max - domain.min), metric === "competition");
  }

  function zoomBy(factor: number, cx = W / 2, cy = H / 2) {
    setView((v) => {
      const k = Math.min(12, Math.max(1, v.k * factor));
      const x = cx - ((cx - v.x) * k) / v.k;
      const y = cy - ((cy - v.y) * k) / v.k;
      return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x, y };
    });
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, ((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H);
  }
  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    movedRef.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.px) * (W / rect.width);
    const dy = (e.clientY - drag.current.py) * (H / rect.height);
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  const homePt = home && project ? project(home.lng, home.lat) : null;
  // ~ degrees of latitude per mile, then projected: use two points to size the ring
  const homeRadiusPx = (() => {
    if (!home || !home.radiusMiles || !project) return 0;
    const dLat = home.radiusMiles / 69;
    const [, y1] = project(home.lng, home.lat);
    const [, y2] = project(home.lng, home.lat + dLat);
    return Math.abs(y2 - y1);
  })();

  const hoverRow = hover ? byCode.get(hover) : undefined;
  const hoverVal = hoverRow && metric !== "accuracy" ? metricValue(hoverRow, metric) : null;

  if (failed) {
    return <div className="mx-empty"><h2>Map unavailable</h2><p>We couldn’t load the map right now. The list still works.</p></div>;
  }

  return (
    <div className="mx-mappane">
      <div
        className="mx-map mx-map--pane"
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
          <svg viewBox={`0 0 ${W} ${H}`} className="mx-map-svg" role="img" aria-label="UK short-term-rental market map">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {paths.map((p) => {
                const row = byCode.get(p.area);
                const isSel = selected === p.area;
                const isHover = hover === p.area;
                return (
                  <path
                    key={p.area}
                    d={p.d}
                    fill={fillFor(row)}
                    stroke={isSel ? "#2E3D2B" : "#ffffff"}
                    strokeWidth={(isSel ? 1.8 : isHover ? 1.1 : 0.4) / view.k}
                    fillOpacity={row ? (isHover || isSel ? 1 : 0.92) : 0.6}
                    style={{ cursor: row ? "pointer" : "default" }}
                    onMouseEnter={() => onHover(p.area)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => {
                      if (movedRef.current) return;
                      if (row) onSelect(isSel ? null : p.area);
                    }}
                  />
                );
              })}
              {homePt && (
                <g pointerEvents="none">
                  {homeRadiusPx > 0 && (
                    <circle cx={homePt[0]} cy={homePt[1]} r={homeRadiusPx} fill="rgba(46,61,43,0.06)" stroke="#2E3D2B" strokeWidth={1 / view.k} strokeDasharray={`${4 / view.k} ${3 / view.k}`} />
                  )}
                  <circle cx={homePt[0]} cy={homePt[1]} r={6 / view.k} fill="#2E3D2B" stroke="#fff" strokeWidth={2 / view.k} />
                </g>
              )}
              {project && pins.length > 0 && (
                <g>
                  {pins.map((pin) => {
                    const pt = project(pin.lng, pin.lat);
                    if (!pt) return null;
                    return (
                      <circle
                        key={pin.id}
                        cx={pt[0]}
                        cy={pt[1]}
                        r={(pin.active ? 7 : 5) / view.k}
                        fill={pin.colour}
                        stroke="#fff"
                        strokeWidth={(pin.active ? 2.5 : 1.5) / view.k}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!movedRef.current) onPinClick?.(pin.id);
                        }}
                      >
                        <title>{pin.label}</title>
                      </circle>
                    );
                  })}
                </g>
              )}
            </g>
          </svg>
        )}

        <div className="mx-map-metric" role="group" aria-label="Colour map by">
          {MAP_METRICS.filter((m) => !m.needsGoals || hasGoals).map((m) => (
            <button key={m.key} type="button" className="mx-map-metric-btn" aria-pressed={metric === m.key} onClick={() => onMetricChange(m.key)}>
              {m.label}
            </button>
          ))}
        </div>

        <div className="mx-map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
          <button type="button" aria-label="Reset" onClick={() => setView({ k: 1, x: 0, y: 0 })}>⟲</button>
        </div>

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
              <div className="mx-map-legend-title">{MAP_METRICS.find((m) => m.key === metric)?.label}</div>
              <div className="mx-map-legend-bar" style={{ background: `linear-gradient(90deg, ${ramp(0, metric === "competition")}, ${ramp(1, metric === "competition")})` }} />
              <div className="mx-map-legend-scale">
                <span>{domain ? fmtMetric(domain.min, metric) : "low"}</span>
                <span>{domain ? fmtMetric(domain.max, metric) : "high"}</span>
              </div>
              {metric === "competition" && <div style={{ fontSize: "0.7rem", color: "var(--mx-muted)" }}>Darker = more competitive</div>}
              <div><span style={{ background: NO_DATA_FILL }} />No data</div>
              {home && <div><span style={{ background: "#2E3D2B", borderRadius: 99 }} />Your home{home.radiusMiles ? ` · ${home.radiusMiles} mi` : ""}</div>}
              {pins.length > 0 && <div><span style={{ background: "#9a7b2e", borderRadius: 99 }} />Your listings ({pins.length})</div>}
            </>
          )}
        </div>

        {hover && (
          <div className="mx-map-hint">
            {hoverRow ? hoverRow.card.name : `${hover} — no data yet`}
            {hoverVal !== null && hoverVal !== undefined ? ` · ${fmtMetric(hoverVal, metric)}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
