"use client";

import { gbpCompact, pct } from "@/lib/market/format";
import type { SortKey } from "@/lib/market/rank";
import type { RegionCardData } from "./types";

/** The value a region sorts by for the active key (higher first); keys without a region figure fall back to reports. */
function regionSortValue(r: RegionCardData, key: SortKey): number | null {
  switch (key) {
    case "revenue": return r.headline.grossRevenue;
    case "occupancy": return r.headline.occupancy;
    case "yield": return r.yieldOnCost?.grossYieldPct ?? null;
    case "competition": return r.competition ? 100 - r.competition.intensity : null;
    case "seasonality": return r.seasonality?.score ?? null;
    case "directBooking": return r.directBooking?.score ?? null;
    default: return r.headline.totalSamples;
  }
}

export function sortRegions(regions: RegionCardData[], key: SortKey): RegionCardData[] {
  return [...regions].sort((a, b) => {
    const va = regionSortValue(a, key);
    const vb = regionSortValue(b, key);
    if (va === null && vb === null) return b.headline.totalSamples - a.headline.totalSamples;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || b.headline.totalSamples - a.headline.totalSamples;
  });
}

/**
 * The top level: one row per UK region with the same headline every level
 * shows, so a member can pick a broad area before niching down.
 */
export function RegionList({ regions, sort, sortLabel, hover, onHover, onSelect, onAll }: {
  regions: RegionCardData[];
  sort: SortKey;
  sortLabel: string;
  hover: string | null;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onAll: () => void;
}) {
  const rows = sortRegions(regions, sort);
  return (
    <div className="mx-listings">
      <div className="mx-pane-head">
        <div>
          <h2>Regions</h2>
          <p>{rows.length} regions with data · by {sortLabel.toLowerCase()} · pick one, then an area, then a sub-market</p>
        </div>
        <button type="button" className="mx-pill mx-pill--sm" onClick={onAll}>All areas</button>
      </div>
      {rows.length === 0 ? (
        <div className="mx-empty mx-empty--list"><h2>No regions yet</h2><p>As analyser reports come in, regions appear here automatically.</p></div>
      ) : (
        <div className="mx-list" role="list">
          {rows.map((r, i) => {
            const why = [r.competition ? r.competition.label : null, r.seasonality ? r.seasonality.label : null, r.directBooking ? `${r.directBooking.label} direct booking` : null].filter(Boolean) as string[];
            return (
              <div
                key={r.slug}
                className={"mx-vrow mx-vrow--region" + (hover === r.slug ? " is-hover" : "")}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(r.slug)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r.slug);
                  }
                }}
                onMouseEnter={() => onHover(r.slug)}
                onMouseLeave={() => onHover(null)}
              >
                <span className="mx-vrow-rank">{i + 1}</span>
                <div className="mx-vrow-main">
                  <div className="mx-vrow-title">
                    <strong>{r.name}</strong>
                    <em>{r.areaCodes.length} area{r.areaCodes.length === 1 ? "" : "s"}</em>
                    <span className={`mx-conf-dot mx-conf-dot--${r.confidence.tier}`} title={`${r.confidence.label} · ${r.headline.totalSamples} reports`} />
                  </div>
                  <div className="mx-vrow-stats">
                    <span>{pct(r.headline.occupancy, 0)} occupied</span>
                    <span>{gbpCompact(r.headline.adr)} a night</span>
                    <span>{r.headline.totalSamples} reports</span>
                  </div>
                  <div className="mx-vrow-why">
                    {why.length > 0 ? why.map((w) => <span key={w}>{w}</span>) : <span>{r.confidence.label} data</span>}
                  </div>
                </div>
                <div className="mx-vrow-end">
                  <span className="mx-vrow-big">{gbpCompact(r.headline.grossRevenue)}</span>
                  <span className="mx-vrow-lbl">avg rev / yr</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
