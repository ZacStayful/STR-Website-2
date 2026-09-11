"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Search, SlidersHorizontal, Star, Target, X } from "lucide-react";
import { BUDGET_LABELS, isBudget, isBeds, isConf, type Region } from "@/lib/market/filters";
import { describeGoals } from "@/lib/market/goals";
import { SORT_LABELS, isSortKey } from "@/lib/market/rank";
import { detectListingUrl, SOURCE_LABELS } from "@/lib/listing/detect";
import { readResolvedListing, RESOLVE_NETWORK_ERROR, type ResolvedListing } from "@/app/estimate/_components/listing-client-types";
import { DEFAULT_FILTERS, type Filters, type MarketGoals, type SortKey } from "./types";

const REGIONS: { key: Region; label: string }[] = [
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

/**
 * One bar: a single box that searches areas or takes a listing link, the
 * goals chip, the filters behind one button, and the Areas | My deals switch.
 */
export function TopBar({
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
  dealsCount,
  view,
  onView,
  onResolved,
  initialCheckUrl = null,
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
  dealsCount: number;
  view: "areas" | "listings";
  onView: (v: "areas" | "listings") => void;
  onResolved: (r: ResolvedListing) => void;
  /** A listing URL prefilled from a deep link; the member still clicks Check. */
  initialCheckUrl?: string | null;
}) {
  const [text, setText] = useState(initialCheckUrl ?? filters.q);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const detected = detectListingUrl(text);
  const active = activeFilterCount(filters);
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFiltersOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const onText = (v: string) => {
    setText(v);
    setError(null);
    // A pasted link is a listing check, not an area search.
    const q = detectListingUrl(v) ? "" : v;
    if (q !== filters.q) set({ q });
  };

  async function check() {
    if (!detected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/listing/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: text.trim() }) });
      const result = await readResolvedListing(res);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(result.listing);
      setText("");
    } catch {
      setError(RESOLVE_NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const goalChips = goals ? describeGoals(goals) : [];

  return (
    <div className="mx-topbar">
      <div className="mx-topbar-row">
        <label className={"mx-search mx-search--bar mx-topbar-search" + (detected ? " is-link" : "")}>
          {detected ? <Link2 size={16} aria-hidden /> : <Search size={16} aria-hidden />}
          <input
            type="search"
            className="mx-search-input"
            placeholder="Search an area or postcode, or paste a Rightmove, OnTheMarket or Airbnb link"
            value={text}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && detected) {
                e.preventDefault();
                void check();
              }
            }}
            disabled={busy}
            aria-label="Search an area or paste a listing link"
            autoFocus={Boolean(initialCheckUrl)}
          />
          {detected && (
            <button type="button" className="mx-cta mx-cta--sm" onClick={check} disabled={busy}>
              {busy ? <Loader2 size={14} className="mx-spin" aria-hidden /> : "Check listing"}
            </button>
          )}
        </label>

        <button type="button" className={"mx-chip" + (goals ? " mx-chip--goals" : " mx-chip--set")} onClick={onEditGoals} aria-haspopup="dialog" title="Your goals">
          <Target size={14} aria-hidden />
          {goals ? (
            <>
              <span className="mx-chip-text">{goalChips.slice(0, 3).join(" · ")}</span>
              <small>Edit</small>
            </>
          ) : (
            <span>Set your goals</span>
          )}
        </button>

        <div className="mx-filters-wrap" ref={popRef}>
          <button type="button" className={"mx-chip" + (active ? " mx-chip--on" : "")} aria-expanded={filtersOpen} aria-controls="mx-filters-pop" onClick={() => setFiltersOpen((o) => !o)}>
            <SlidersHorizontal size={14} aria-hidden />
            Filters{active ? <small>{active} on</small> : null}
          </button>
          {filtersOpen && (
            <div className="mx-filters-pop" id="mx-filters-pop" role="dialog" aria-label="Filters">
              <div className="mx-filters-pop-head">
                <strong>Filters</strong>
                <span>{resultCount} {resultCount === 1 ? "area" : "areas"}</span>
                <button type="button" className="mx-cmp-close" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><X size={16} /></button>
              </div>
              <div className="mx-filters-pop-section">
                <span className="mx-eyebrow">Region</span>
                <div className="mx-filter-group" role="group" aria-label="Region">
                  {REGIONS.map((r) => (
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

        <div className="mx-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "areas"} onClick={() => onView("areas")}>Areas</button>
          <button type="button" aria-pressed={view === "listings"} onClick={() => onView("listings")}>My deals{dealsCount ? <span className="mx-seg-count">{dealsCount}</span> : null}</button>
        </div>

        <div className="mx-pane-toggle" role="group" aria-label="Map or list">
          <button type="button" aria-pressed={mobilePane === "map"} onClick={() => onMobilePane("map")}>Map</button>
          <button type="button" aria-pressed={mobilePane === "list"} onClick={() => onMobilePane("list")}>List</button>
        </div>
      </div>
      {(detected || error) && (
        <div className="mx-topbar-hint">
          {error ? (
            <span className="mx-listing-check-error" role="alert">{error}</span>
          ) : detected ? (
            <span className="mx-listing-check-hint">{SOURCE_LABELS[detected.source]} listing · {initialCheckUrl && text === initialCheckUrl ? "press Check listing to add it to your deals" : "free quick view, no report used"}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
