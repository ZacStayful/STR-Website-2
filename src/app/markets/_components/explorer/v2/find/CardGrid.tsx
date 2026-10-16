"use client";

import type { ReactNode } from "react";
import { SORT_LABELS, isSortKey } from "@/lib/market/rank";
import type { Level, MarketGoals, SortKey } from "../../types";

const PRIMARY: SortKey[] = ["stayful", "personal", "revenue", "occupancy", "adr", "yield"];
const MORE: SortKey[] = ["competition", "seasonality", "directBooking", "growth", "distance", "trend"];

/** The Markets | Sub-markets | My deals switch, the count, the sort select and the grid itself. */
export function CardGrid({
  level,
  onLevel,
  counts,
  shown,
  sort,
  onSort,
  goals,
  trendSortReady,
  hideSort = false,
  btl = null,
  children,
}: {
  level: Level;
  onLevel: (l: Level) => void;
  counts: { markets: number; sub: number; deals: number };
  /** e.g. "12 markets shown". */
  shown: string;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  goals: MarketGoals | null;
  trendSortReady: boolean;
  hideSort?: boolean;
  /** Batch 28: the "Buy to let" view, switched on and off here. */
  btl?: { on: boolean; onToggle: () => void } | null;
  children: ReactNode;
}) {
  const allowed = (k: SortKey) => (goals || (k !== "personal" && k !== "distance")) && (trendSortReady || k !== "trend") && (k !== "distance" || !!goals?.home);
  return (
    <div className="mx2-find-cards">
      <div className="mx2-grid-head">
        <div className="mx2-seg" role="group" aria-label="Level">
          <button type="button" aria-pressed={level === "markets"} onClick={() => onLevel("markets")}>Markets</button>
          <button type="button" aria-pressed={level === "sub"} onClick={() => onLevel("sub")}>Sub-markets</button>
          <button type="button" aria-pressed={level === "deals"} onClick={() => onLevel("deals")}>My deals{counts.deals ? <span className="mx2-seg-count">{counts.deals}</span> : null}</button>
        </div>
        <span className="mx2-shown">{shown}</span>
        {btl && (
          <button type="button" className="mx2-seg-toggle rounded-full border border-border px-2.5 py-1 text-xs font-medium" aria-pressed={btl.on} onClick={btl.onToggle}>
            Buy to let{btl.on ? " · on" : ""}
          </button>
        )}
        {!hideSort && !btl?.on && (
          <label className="mx2-sort">
            Sort by
            <select className="mx2-select mx2-select--inline" value={sort} onChange={(e) => isSortKey(e.target.value) && onSort(e.target.value)}>
              {PRIMARY.map((k) => <option key={k} value={k} disabled={!allowed(k)}>{SORT_LABELS[k]}{k === "personal" && !goals ? " (set goals)" : ""}</option>)}
              <optgroup label="More">
                {MORE.filter(allowed).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
              </optgroup>
            </select>
          </label>
        )}
      </div>
      {children}
    </div>
  );
}
