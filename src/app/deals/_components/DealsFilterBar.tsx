import Link from "next/link";
import { areaMetaForCode } from "@/lib/market/areas";
import { filtersToSearch, KIND_LABELS, SORT_LABELS, VIEW_LABELS, type DealFilters, type DealKindFilter, type DealSort, type DealView } from "@/lib/marketplace/grid";
import type { AreaCount } from "@/lib/marketplace/queries";

const BEDS = ["any", "1", "2", "3", "4+"] as const;

/**
 * A plain GET form: every change is a server round trip that re-queries the
 * pool, so the grid never holds more than one page in the browser and the
 * URL is always the whole filter.
 */
export function DealsFilterBar({ filters, counts, total }: { filters: DealFilters; counts: AreaCount[]; total: number }) {
  const select = "rounded-md border border-border bg-card px-2.5 py-1.5 text-sm";
  const input = "w-28 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm";
  const areasWithDeals = counts.filter((c) => c.total > 0);
  const chosen = filters.areas.map((code) => areaMetaForCode(code));
  return (
    <form method="get" action="/deals" className="rounded-xl border border-border bg-card p-3">
      {/* Kept / Passed is the member's own list, so it survives Apply like any other filter. */}
      {filters.view !== "all" && <input type="hidden" name="view" value={filters.view} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          <span className="block">Deal</span>
          <select name="kind" defaultValue={filters.kind} className={select}>
            {(Object.keys(KIND_LABELS) as DealKindFilter[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block">Bedrooms</span>
          <select name="beds" defaultValue={filters.beds} className={select}>
            {BEDS.map((b) => (
              <option key={b} value={b}>{b === "any" ? "Any" : b}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block">Min price</span>
          <input name="minPrice" type="number" inputMode="numeric" min={0} step={1000} defaultValue={filters.minPrice ?? ""} placeholder="£" className={input} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block">Max price</span>
          <input name="maxPrice" type="number" inputMode="numeric" min={0} step={1000} defaultValue={filters.maxPrice ?? ""} placeholder="£" className={input} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block">Min profit / yr</span>
          <input name="minProfit" type="number" inputMode="numeric" min={0} step={1000} defaultValue={filters.minProfit ?? ""} placeholder="£" className={input} />
        </label>
        <label className="text-xs text-muted-foreground" title="Sales only: a rent-to-rent deal has no uplift figure">
          <span className="block">Min uplift % (buy)</span>
          <input name="minUplift" type="number" inputMode="numeric" min={0} step={5} defaultValue={filters.minUplift ?? ""} placeholder="%" className={input} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block">Sort</span>
          <select name="sort" defaultValue={filters.sort} className={select}>
            {(Object.keys(SORT_LABELS) as DealSort[]).map((s) => (
              <option key={s} value={s}>{SORT_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <details className="relative text-xs text-muted-foreground">
          <summary className={select + " cursor-pointer list-none"}>{chosen.length === 0 ? "All areas" : `${chosen.length} area${chosen.length === 1 ? "" : "s"}`}</summary>
          <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-border bg-card p-2 shadow-lg">
            {areasWithDeals.length === 0 && <p className="p-2 text-xs">No live deals yet.</p>}
            {areasWithDeals.map((c) => {
              const meta = areaMetaForCode(c.code);
              return (
                <label key={c.code} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-foreground hover:bg-muted">
                  <input type="checkbox" name="areas" value={c.code} defaultChecked={filters.areas.includes(c.code)} />
                  <span className="flex-1">{meta.name}</span>
                  <span className="text-xs text-muted-foreground">{filters.kind === "sale" ? c.sale : filters.kind === "rent" ? c.rent : c.total}</span>
                </label>
              );
            })}
          </div>
        </details>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Apply</button>
        {filtersToSearch(filters) !== "" && (
          <Link href="/deals" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">Clear</Link>
        )}
        <nav className="ml-auto flex items-center gap-1 text-xs" aria-label="Your deals">
          {(Object.keys(VIEW_LABELS) as DealView[]).map((v) => (
            <Link
              key={v}
              href={`/deals${filtersToSearch({ ...filters, view: v, page: 1 })}`}
              aria-current={filters.view === v ? "page" : undefined}
              className={"rounded-md px-2 py-1 font-medium " + (filters.view === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
            >
              {VIEW_LABELS[v]}
            </Link>
          ))}
        </nav>
        <span className="text-xs text-muted-foreground">{total.toLocaleString("en-GB")} {filters.view === "kept" ? "kept" : filters.view === "passed" ? "passed" : "live"} deal{total === 1 ? "" : "s"}</span>
      </div>
      {chosen.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {chosen.map((a) => (
            <Link key={a.code} href={`/deals${filtersToSearch({ ...filters, areas: filters.areas.filter((c) => c !== a.code), page: 1 })}`} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted/70" title="Remove">
              {a.name} ×
            </Link>
          ))}
        </p>
      )}
    </form>
  );
}
