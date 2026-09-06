"use client";

import { Briefcase, Search, SlidersHorizontal, Star, Target } from "lucide-react";
import { BUDGET_LABELS, isBudget, isBeds, isConf, type Region } from "@/lib/market/filters";
import { describeGoals } from "@/lib/market/goals";
import { SORT_LABELS, isSortKey } from "@/lib/market/rank";
import type { Filters, MarketGoals, SortKey } from "./types";

const REGIONS: { key: Region; label: string }[] = [
  { key: "any", label: "UK" },
  { key: "England", label: "England" },
  { key: "Scotland", label: "Scotland" },
  { key: "Wales", label: "Wales" },
  { key: "Northern Ireland", label: "N. Ireland" },
];

export function GoalBar({
  filters,
  onFilters,
  sort,
  onSort,
  goals,
  onEditGoals,
  resultCount,
  savedCount,
  mobilePane,
  onMobilePane,
  trendSortReady = false,
  listingsCount = 0,
  listingsOpen = false,
  onToggleListings,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  goals: MarketGoals | null;
  onEditGoals: () => void;
  resultCount: number;
  savedCount: number;
  mobilePane: "map" | "list";
  onMobilePane: (p: "map" | "list") => void;
  trendSortReady?: boolean;
  listingsCount?: number;
  listingsOpen?: boolean;
  onToggleListings?: () => void;
}) {
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const chips = goals ? describeGoals(goals) : [];

  return (
    <div className="mx-goalbar">
      <div className="mx-goalbar-row">
        <label className="mx-search mx-search--bar">
          <Search size={16} aria-hidden />
          <input
            type="search"
            className="mx-search-input"
            placeholder="Search an area or postcode"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            aria-label="Search area"
          />
        </label>

        <button type="button" className={"mx-goals-chip" + (goals ? " has-goals" : "")} onClick={onEditGoals} aria-haspopup="dialog">
          <Target size={14} aria-hidden />
          {goals ? (
            <>
              <span className="mx-goals-chip-list">{chips.slice(0, 4).map((c) => <span key={c}>{c}</span>)}</span>
              <span className="mx-goals-chip-edit">Edit goals</span>
            </>
          ) : (
            <span>Set your goals</span>
          )}
        </button>

        {onToggleListings && (
          <button type="button" className={"mx-goals-chip mx-listings-chip" + (listingsOpen ? " has-goals" : "")} aria-pressed={listingsOpen} onClick={onToggleListings}>
            <Briefcase size={14} aria-hidden />
            <span>My listings{listingsCount ? ` (${listingsCount})` : ""}</span>
          </button>
        )}

        <div className="mx-pane-toggle" role="group" aria-label="View">
          <button type="button" aria-pressed={mobilePane === "map"} onClick={() => onMobilePane("map")}>Map</button>
          <button type="button" aria-pressed={mobilePane === "list"} onClick={() => onMobilePane("list")}>List</button>
        </div>
      </div>

      <div className="mx-goalbar-row mx-goalbar-row--filters">
        <div className="mx-filter-group" role="group" aria-label="Region">
          {REGIONS.map((r) => (
            <button key={r.key} type="button" className="mx-pill mx-pill--sm" aria-pressed={filters.region === r.key} onClick={() => set({ region: r.key })}>
              {r.label}
            </button>
          ))}
        </div>

        <select className="mx-select" aria-label="Budget" value={filters.budget} onChange={(e) => isBudget(e.target.value) && set({ budget: e.target.value })}>
          {(Object.keys(BUDGET_LABELS) as (keyof typeof BUDGET_LABELS)[]).map((k) => <option key={k} value={k}>{BUDGET_LABELS[k]}</option>)}
        </select>

        <select className="mx-select" aria-label="Bedrooms" value={filters.beds} onChange={(e) => isBeds(e.target.value) && set({ beds: e.target.value })}>
          <option value="any">Any bedrooms</option>
          <option value="1">1 bed</option>
          <option value="2">2 bed</option>
          <option value="3">3 bed</option>
          <option value="4+">4+ bed</option>
        </select>

        <select className="mx-select" aria-label="Data confidence" value={filters.conf} onChange={(e) => isConf(e.target.value) && set({ conf: e.target.value })}>
          <option value="any">Any confidence</option>
          <option value="building+">Building &amp; up</option>
          <option value="confirmed">Confirmed only</option>
        </select>

        <button type="button" className="mx-pill mx-pill--sm mx-pill--saved" aria-pressed={filters.savedOnly} onClick={() => set({ savedOnly: !filters.savedOnly })} title="Show saved areas only">
          <Star size={13} aria-hidden /> Saved{savedCount ? ` (${savedCount})` : ""}
        </button>

        <label className="mx-sort">
          <SlidersHorizontal size={14} aria-hidden />
          <span>Sort</span>
          <select className="mx-select" aria-label="Sort by" value={sort} onChange={(e) => isSortKey(e.target.value) && onSort(e.target.value)}>
            {(Object.keys(SORT_LABELS) as SortKey[])
              .filter((k) => (goals || (k !== "personal" && k !== "distance")) && (trendSortReady || k !== "trend"))
              .map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
          </select>
        </label>

        <span className="mx-result-count">{resultCount} {resultCount === 1 ? "area" : "areas"}</span>
      </div>
    </div>
  );
}
