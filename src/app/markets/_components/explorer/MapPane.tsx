"use client";

import { useMemo, useRef, useState } from "react";
import { Crosshair, Minus, Plus } from "lucide-react";
import { gbp, gbpCompact, pct } from "@/lib/market/format";
import { bucketIndex, buildBuckets, spreadPalette } from "@/lib/market/buckets";
import { useUkGeo, MAP_W as W, MAP_H as H } from "../useUkGeo";
import { MAP_METRICS, type ExplorerRow, type MapMetric } from "./types";
import { ScoreRing } from "./v2/shared/ScoreRing";

/**
 * Controlled UK choropleth: the shell owns selection/hover, this pane owns
 * zoom/pan. Fill colour follows one metric at a time in up to four quantile
 * bands (competition uses amber so "busy" reads as caution, not quality).
 */

const TIER_FILL: Record<string, string> = { confirmed: "#4c6b47", building: "#7fa578", early: "#c3d1ab" };
const NO_DATA_FILL = "#e8e8e2";
const SAGE_BUCKETS = ["#cdd8c4", "#a2b299", "#6e8467", "#3a5634"];
const AMBER_BUCKETS = ["#f5efe0", "#e4d3a4", "#c2a95a", "#9a7b2e"];

export function metricValue(row: ExplorerRow, m: MapMetric): number | null {
  const c = row.card;
  switch (m) {
    case "score": return c.score?.score ?? null;
    case "personal": return row.personal?.score ?? null;
    case "yield": return c.yieldOnCost?.grossYieldPct ?? null;
    case "occupancy": return c.headline.occupancy;
    case "revenue": return c.headline.grossRevenue;
    case "adr": return c.headline.adr;
    case "competition": return c.competition?.intensity ?? null;
    case "seasonality": return c.seasonality?.score ?? null;
    case "directBooking": return c.directBooking?.score ?? null;
    case "accuracy": return null;
  }
}

function fmtMetric(v: number, m: MapMetric): string {
  if (m === "revenue") return gbpCompact(v);
  if (m === "adr") return gbp(v);
  if (m === "occupancy" || m === "yield") return `${v.toFixed(m === "yield" ? 1 : 0)}%`;
  return String(Math.round(v));
}

/** The rounding step for the legend thresholds, so bands read as round numbers. */
function metricStep(m: MapMetric): number {
  if (m === "revenue") return 1000;
  if (m === "adr") return 10;
  if (m === "yield") return 0.5;
  return 5;
}

export function MapPane({
  rows,
  selected,
  hover,
  onSelect,
  onHover,
  onOpen,
  metric,
  onMetricChange,
  hasGoals,
  home,
  pins = [],
  onPinClick,
  pulse,
}: {
  rows: ExplorerRow[];
  selected: string | null;
  hover: string | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  /** When set, clicking an area calls this instead of toggling the selection (the v2 find screen navigates). */
  onOpen?: (code: string) => void;
  metric: MapMetric;
  onMetricChange: (m: MapMetric) => void;
  hasGoals: boolean;
  home: { lat: number; lng: number; radiusMiles: number | null } | null;
  /** The member's deals as markers, coloured by verdict. */
  pins?: { id: string; lat: number; lng: number; colour: string; label: string; legend: string; active?: boolean }[];
  onPinClick?: (id: string) => void;
  /** A small overlay (the UK market pulse) in the map's corner. */
  pulse?: React.ReactNode;
}) {
  const { features, paths, failed, project } = useUkGeo();
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  // Survives pointerup so the click that follows a pan can be ignored.
  const movedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const byCode = useMemo(() => new Map(rows.map((r) => [r.card.code, r])), [rows]);

  const scale = useMemo(() => {
    if (metric === "accuracy") return null;
    const vals = rows.map((r) => metricValue(r, metric)).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const buckets = buildBuckets(vals, metricStep(metric), (v) => fmtMetric(v, metric));
    const colours = spreadPalette(metric === "competition" ? AMBER_BUCKETS : SAGE_BUCKETS, buckets.thresholds.length + 1);
    return { ...buckets, colours };
  }, [rows, metric]);

  function fillFor(row: ExplorerRow | undefined): string {
    if (!row) return NO_DATA_FILL;
    if (metric === "accuracy") return TIER_FILL[row.card.confidence.tier];
    const v = metricValue(row, metric);
    if (v === null || !scale) return NO_DATA_FILL;
    return scale.colours[bucketIndex(v, scale.thresholds)];
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

  const pinLegend = useMemo(() => {
    const m = new Map<string, { legend: string; colour: string; n: number }>();
    for (const p of pins) {
      const e = m.get(p.legend);
      if (e) e.n += 1; else m.set(p.legend, { legend: p.legend, colour: p.colour, n: 1 });
    }
    return [...m.values()];
  }, [pins]);
  const hoverRow = hover ? byCode.get(hover) : undefined;
  const metricLabel = MAP_METRICS.find((m) => m.key === metric)?.label ?? "";

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
                    fill={isHover && row ? "#5d8156" : fillFor(row)}
                    stroke={isSel ? "#2E3D2B" : isHover && row ? "#5d8156" : "#ffffff"}
                    strokeWidth={(isSel ? 1.8 : isHover ? 1.1 : 0.4) / view.k}
                    fillOpacity={row ? 1 : 0.6}
                    style={{ cursor: row ? "pointer" : "default" }}
                    onMouseEnter={() => onHover(p.area)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => {
                      if (movedRef.current || !row) return;
                      if (onOpen) onOpen(p.area); else onSelect(isSel ? null : p.area);
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
                    const s = (pin.active ? 1.3 : 1) / view.k;
                    return (
                      <path
                        key={pin.id}
                        // A teardrop with its point on the listing.
                        d="M0 0 L-6 -11 A7 7 0 1 1 6 -11 Z"
                        transform={`translate(${pt[0]} ${pt[1]}) scale(${s})`}
                        fill={pin.colour}
                        stroke={pin.active ? "#2E3D2B" : "#fff"}
                        strokeWidth={pin.active ? 2 : 1.5}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!movedRef.current) onPinClick?.(pin.id);
                        }}
                      >
                        <title>{pin.label}</title>
                      </path>
                    );
                  })}
                </g>
              )}
            </g>
          </svg>
        )}

        <div className="mx2-map-ctl">
          <select
            className="mx2-select mx2-select--pill"
            aria-label="Colour map by"
            value={metric}
            onChange={(e) => onMetricChange(e.target.value as MapMetric)}
          >
            {MAP_METRICS.filter((m) => !m.needsGoals || hasGoals).map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <div className="mx2-map-legend" aria-label={`Legend: ${metricLabel}`}>
            {metric === "accuracy" ? (
              <>
                <div><span style={{ background: TIER_FILL.confirmed }} />Confirmed</div>
                <div><span style={{ background: TIER_FILL.building }} />Building</div>
                <div><span style={{ background: TIER_FILL.early }} />Early</div>
              </>
            ) : scale ? (
              scale.labels.map((label, i) => <div key={label}><span style={{ background: scale.colours[i] }} />{label}</div>)
            ) : null}
            <div className="mx2-map-legend-muted"><span style={{ background: NO_DATA_FILL, border: "1px solid var(--mx-line)" }} />No data yet</div>
            {metric === "competition" && <div className="mx2-map-legend-muted">Darker = more competitive</div>}
            {home && <div><span style={{ background: "#2E3D2B", borderRadius: 99 }} />Your home{home.radiusMiles ? ` · ${home.radiusMiles} mi` : ""}</div>}
            {pinLegend.map((l) => <div key={l.legend}><span style={{ background: l.colour, borderRadius: 99 }} />{l.legend} ({l.n})</div>)}
          </div>
        </div>

        <div className="mx2-map-zoom">
          <button type="button" className="mx2-btn mx2-btn--icon" aria-label="Reset" onClick={() => setView({ k: 1, x: 0, y: 0 })}><Crosshair size={16} aria-hidden /></button>
          <button type="button" className="mx2-btn mx2-btn--icon" aria-label="Zoom in" onClick={() => zoomBy(1.4)}><Plus size={16} aria-hidden /></button>
          <button type="button" className="mx2-btn mx2-btn--icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}><Minus size={16} aria-hidden /></button>
        </div>

        {pulse && <div className="mx-map-pulse">{pulse}</div>}

        {hoverRow ? (
          <div className="mx2-map-pop" aria-hidden="true">
            <div className="mx2-map-pop-head">
              <ScoreRing value={hoverRow.card.score?.score ?? null} size={40} label={`Stayful score ${hoverRow.card.score?.score ?? "not yet available"}`} />
              <div className="mx2-map-pop-name">{hoverRow.card.name}</div>
            </div>
            <div className="mx2-map-pop-kpis">
              <div><b>{gbpCompact(hoverRow.card.headline.grossRevenue)}</b><span>Revenue potential</span></div>
              <div><b>{pct(hoverRow.card.headline.occupancy, 0)}</b><span>Occupancy</span></div>
              <div><b>{gbp(hoverRow.card.headline.adr)}</b><span>Daily rate</span></div>
            </div>
            {metric !== "accuracy" && metricValue(hoverRow, metric) !== null && (
              <div className="mx2-map-pop-metric">{metricLabel} · <b>{fmtMetric(metricValue(hoverRow, metric)!, metric)}</b></div>
            )}
            <span className="mx2-btn mx2-btn--primary">View market</span>
          </div>
        ) : hover ? (
          <div className="mx-map-hint">{hover} — no data yet</div>
        ) : null}
      </div>
    </div>
  );
}
