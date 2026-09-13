"use client";

import { Target } from "lucide-react";
import { BUDGET_LABELS, isBeds, isBudget, isConf, isRegion } from "@/lib/market/filters";
import { describeGoals } from "@/lib/market/goals";
import type { Filters, MarketGoals, SortKey } from "../../types";
import { ChipMenu } from "../shared/ChipMenu";
import { FiltersChip, NATIONS } from "../shared/FiltersChip";
import { SearchOrPaste, SearchHint } from "../shared/SearchOrPaste";
import type { ListingSearch } from "../shared/useListingSearch";

const BEDS = [["any", "Any bedrooms"], ["1", "1 bed"], ["2", "2 bed"], ["3", "3 bed"], ["4+", "4+ bed"]] as const;
const CONF = [["any", "Any confidence"], ["building+", "Building & up"], ["confirmed", "Confirmed only"]] as const;

function Options<T extends string>({ items, value, onPick, close }: { items: readonly (readonly [T, string])[]; value: string; onPick: (v: T) => void; close: () => void }) {
  return (
    <>
      {items.map(([k, label]) => (
        <button key={k} type="button" className="mx2-pop-item" aria-current={value === k} onClick={() => { onPick(k); close(); }}>{label}</button>
      ))}
    </>
  );
}

/** The design's filter bar: search-or-paste, four chip menus, the goals chip and "All filters". */
export function FilterBar({
  search,
  filters,
  onFilters,
  goals,
  onEditGoals,
  sort,
  onSort,
  resultCount,
  savedCount,
  trendSortReady,
  autoFocusSearch = false,
}: {
  search: ListingSearch;
  filters: Filters;
  onFilters: (f: Filters) => void;
  goals: MarketGoals | null;
  onEditGoals: () => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  resultCount: number;
  savedCount: number;
  trendSortReady: boolean;
  autoFocusSearch?: boolean;
}) {
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const showHint = search.detected || search.error || search.badLink;
  const goalChips = goals ? describeGoals(goals).slice(0, 3) : [];
  return (
    <div className="mx2-filterbar">
      <div className="mx2-filterbar-row">
        <SearchOrPaste search={search} className="mx2-find-search" placeholder="Search a market, sub-market or postcode — or paste a listing link" autoFocus={autoFocusSearch} />
        <ChipMenu label={filters.region === "any" ? "Region" : NATIONS.find((n) => n.key === filters.region)?.label ?? "Region"} active={filters.region !== "any"} ariaLabel="Nation">
          {(close) => <Options items={NATIONS.map((n) => [n.key, n.label] as const)} value={filters.region} onPick={(v) => isRegion(v) && set({ region: v })} close={close} />}
        </ChipMenu>
        <ChipMenu label={filters.beds === "any" ? "Bedrooms" : `${filters.beds} bed`} active={filters.beds !== "any"} ariaLabel="Bedrooms">
          {(close) => <Options items={BEDS} value={filters.beds} onPick={(v) => isBeds(v) && set({ beds: v })} close={close} />}
        </ChipMenu>
        <ChipMenu label={filters.budget === "any" ? "Budget" : BUDGET_LABELS[filters.budget]} active={filters.budget !== "any"} ariaLabel="Budget">
          {(close) => <Options items={(Object.keys(BUDGET_LABELS) as (keyof typeof BUDGET_LABELS)[]).map((k) => [k, BUDGET_LABELS[k]] as const)} value={filters.budget} onPick={(v) => isBudget(v) && set({ budget: v })} close={close} />}
        </ChipMenu>
        <ChipMenu label={filters.conf === "any" ? "Confidence" : CONF.find((c) => c[0] === filters.conf)?.[1] ?? "Confidence"} active={filters.conf !== "any"} ariaLabel="Data confidence">
          {(close) => <Options items={CONF} value={filters.conf} onPick={(v) => isConf(v) && set({ conf: v })} close={close} />}
        </ChipMenu>
        <button type="button" className={"mx2-btn mx2-btn--secondary mx2-chip" + (goals ? "" : " is-dashed")} onClick={onEditGoals} aria-haspopup="dialog" title="Your goals">
          <Target size={14} aria-hidden />
          {goals ? <>Your goals · {goalChips.join(" · ")}</> : "Set your goals"}
        </button>
        <FiltersChip filters={filters} onFilters={onFilters} sort={sort} onSort={onSort} goals={goals} resultCount={resultCount} savedCount={savedCount} trendSortReady={trendSortReady} label="All filters" />
      </div>
      {showHint && <div className="mx-topbar-hint"><SearchHint search={search} /></div>}
    </div>
  );
}
