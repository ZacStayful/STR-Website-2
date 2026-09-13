"use client";

import { Target } from "lucide-react";
import { describeGoals } from "@/lib/market/goals";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";
import type { Filters, MarketGoals, SortKey } from "./types";
import { useListingSearch } from "./v2/shared/useListingSearch";
import { SearchOrPaste, SearchHint } from "./v2/shared/SearchOrPaste";
import { FiltersChip } from "./v2/shared/FiltersChip";

export { activeFilterCount } from "./v2/shared/FiltersChip";

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
  const search = useListingSearch({ q: filters.q, onQuery: (q) => onFilters({ ...filters, q }), onResolved, initialCheckUrl });
  const goalChips = goals ? describeGoals(goals) : [];
  const hint = <SearchHint search={search} />;
  const showHint = search.detected || search.error || search.badLink;

  return (
    <div className="mx-topbar">
      <div className="mx-topbar-row">
        <SearchOrPaste search={search} className="mx-topbar-search" autoFocus={Boolean(initialCheckUrl)} />

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

        <FiltersChip filters={filters} onFilters={onFilters} sort={sort} onSort={onSort} goals={goals} resultCount={resultCount} savedCount={savedCount} trendSortReady={trendSortReady} />

        <div className="mx-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "areas"} onClick={() => onView("areas")}>Areas</button>
          <button type="button" aria-pressed={view === "listings"} onClick={() => onView("listings")}>My deals{dealsCount ? <span className="mx-seg-count">{dealsCount}</span> : null}</button>
        </div>

        <div className="mx-pane-toggle" role="group" aria-label="Map or list">
          <button type="button" aria-pressed={mobilePane === "map"} onClick={() => onMobilePane("map")}>Map</button>
          <button type="button" aria-pressed={mobilePane === "list"} onClick={() => onMobilePane("list")}>List</button>
        </div>
      </div>
      {showHint && <div className="mx-topbar-hint">{hint}</div>}
    </div>
  );
}
