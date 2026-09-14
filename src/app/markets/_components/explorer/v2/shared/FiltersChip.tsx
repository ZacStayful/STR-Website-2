"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Star, X } from "lucide-react";
import { BUDGET_LABELS, isBudget, isBeds, isConf, type Region } from "@/lib/market/filters";
import { SORT_LABELS, isSortKey } from "@/lib/market/rank";
import { DEFAULT_FILTERS, type Filters, type MarketGoals, type SortKey } from "../../types";

export const NATIONS: { key: Region; label: string }[] = [
  { key: "any", label: "UK" },
  { key: "England", label: "England" },
  { key: "Scotland", label: "Scotland" },
  { key: "Wales", label: "Wales" },
  { key: "Northern Ireland", label: "N. Ireland" },
];

/** How many filters are away from their default (the count on the Filters chip). */
export function activeFilterCount(f: Filters): number {
  return (f.region !== "any" ? 1 : 0) + (f.budget !== "any" ? 1 : 0) + (f.beds !== "any" ? 1 : 0) + (f.conf !== "any" ? 1 : 0) + (f.savedOnly ? 1 : 0);
}

/** The "Filters" chip and its popover: nation, budget, bedrooms, confidence, sort, saved-only. */
export function FiltersChip({
  filters,
  onFilters,
  sort,
  onSort,
  goals,
  resultCount,
  savedCount,
  trendSortReady = false,
  label = "Filters",
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  goals: MarketGoals | null;
  resultCount: number;
  savedCount: number;
  trendSortReady?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const active = activeFilterCount(filters);
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mx-filters-wrap" ref={popRef}>
      <button type="button" className={"mx-chip" + (active ? " mx-chip--on" : "")} aria-expanded={open} aria-controls="mx-filters-pop" onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={14} aria-hidden />
        {label}{active ? <small>{active} on</small> : null}
      </button>
      {open && (
        <div className="mx-filters-pop" id="mx-filters-pop" role="dialog" aria-label="Filters">
          <div className="mx-filters-pop-head">
            <strong>Filters</strong>
            <span>{resultCount} {resultCount === 1 ? "area" : "areas"}</span>
            <button type="button" className="mx-cmp-close" aria-label="Close filters" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <div className="mx-filters-pop-section">
            <span className="mx-eyebrow">Nation</span>
            <div className="mx-filter-group" role="group" aria-label="Nation">
              {NATIONS.map((r) => (
                <button key={r.key} type="button" className="mx-pill mx-pill--sm" aria-pressed={filters.region === r.key} onClick={() => set({ region: r.key })}>{r.label}</button>
              ))}
            </div>
          </div>
          <div className="mx-filters-pop-grid">
            <label><span className="mx-eyebrow">Budget</span>
              <select className="mx-select mx-select--block" value={filters.budget} onChange={(e) => isBudget(e.target.value) && set({ budget: e.target.value })}>
                {(Object.keys(BUDGET_LABELS) as (keyof typeof BUDGET_LABELS)[]).map((k) => <option key={k} value={k}>{BUDGET_LABELS[k]}</option>)}
              </select>
            </label>
            <label><span className="mx-eyebrow">Bedrooms</span>
              <select className="mx-select mx-select--block" value={filters.beds} onChange={(e) => isBeds(e.target.value) && set({ beds: e.target.value })}>
                <option value="any">Any bedrooms</option><option value="1">1 bed</option><option value="2">2 bed</option><option value="3">3 bed</option><option value="4+">4+ bed</option>
              </select>
            </label>
            <label><span className="mx-eyebrow">Data confidence</span>
              <select className="mx-select mx-select--block" value={filters.conf} onChange={(e) => isConf(e.target.value) && set({ conf: e.target.value })}>
                <option value="any">Any confidence</option><option value="building+">Building &amp; up</option><option value="confirmed">Confirmed only</option>
              </select>
            </label>
            <label><span className="mx-eyebrow">Sort areas by</span>
              <select className="mx-select mx-select--block" value={sort} onChange={(e) => isSortKey(e.target.value) && onSort(e.target.value)}>
                {(Object.keys(SORT_LABELS) as SortKey[])
                  .filter((k) => (goals || (k !== "personal" && k !== "distance")) && (trendSortReady || k !== "trend"))
                  .map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
              </select>
            </label>
          </div>
          <div className="mx-filters-pop-foot">
            <button type="button" className="mx-pill mx-pill--sm mx-pill--saved" aria-pressed={filters.savedOnly} onClick={() => set({ savedOnly: !filters.savedOnly })}>
              <Star size={13} aria-hidden /> Saved only{savedCount ? ` (${savedCount})` : ""}
            </button>
            {active > 0 && <button type="button" className="mx-pill mx-pill--sm" onClick={() => onFilters({ ...DEFAULT_FILTERS, q: filters.q })}>Clear filters</button>}
          </div>
        </div>
      )}
    </div>
  );
}
