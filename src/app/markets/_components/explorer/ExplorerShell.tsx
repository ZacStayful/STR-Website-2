"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toggleSavedAreaAction } from "../../actions";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { sortRows, isSortKey } from "@/lib/market/rank";
import { hasBeds, inBudget, passesConfidence } from "@/lib/market/filters";
import { CompareBar, MAX_COMPARE } from "../CompareBar";
import { MapPane } from "./MapPane";
import { GoalBar } from "./GoalBar";
import { GoalsModal } from "./GoalsModal";
import { AreaList } from "./AreaList";
import { DetailDrawer } from "./DetailDrawer";
import { DEFAULT_FILTERS, type AreaCardData, type ExplorerRow, type Filters, type MapMetric, type MarketGoals, type SortKey } from "./types";
import { areaTrend } from "@/lib/market/trend";
import type { MarketTrendsResponse } from "@/lib/market/types";
import { MarketPulse } from "./MarketPulse";
import { ListingCheck } from "./ListingCheck";
import { ListingsPane } from "./ListingsPane";
import { ListingDrawer } from "./ListingDrawer";
import { ListingCompare } from "./ListingCompare";
import { PIPELINE_STATUSES, rowFromResolved, type CheckedListingRow, type ListingSort, type PipelineStatus } from "@/lib/listing/pipeline";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";

const DISMISS_KEY = "mx_goals_dismissed";

export function ExplorerShell({
  cards,
  goals,
  savedAreas,
  initialArea = null,
  initialAreaName = null,
  initialSort = "stayful",
  initialQuery = "",
  userEmail = null,
  trends = null,
  alertWeekly = true,
  sourcingAlerts = false,
  listings: initialListings = [],
  initialSidePane = "areas",
  initialActiveListing = null,
  initialCheckUrl = null,
}: {
  cards: AreaCardData[];
  /** Monthly series from /api/market-trends, or null when unavailable. */
  trends?: MarketTrendsResponse | null;
  alertWeekly?: boolean;
  sourcingAlerts?: boolean;
  /** A listing URL prefilled in the paste box (from the sourcing email's "Add to pipeline"); the member still clicks Check. */
  initialCheckUrl?: string | null;
  /** The member's checked listings (deal pipeline). */
  listings?: CheckedListingRow[];
  /** Open on the pipeline instead of the areas list (deep links / fixtures). */
  initialSidePane?: "areas" | "listings";
  initialActiveListing?: string | null;
  goals: MarketGoals | null;
  savedAreas: string[];
  /** Postcode area code to open in the drawer (deep link). */
  initialArea?: string | null;
  /** Name for a deep-linked area that has no data yet. */
  initialAreaName?: string | null;
  initialSort?: SortKey;
  initialQuery?: string;
  userEmail?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialArea);
  const [hover, setHover] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, q: initialQuery });
  const [sort, setSort] = useState<SortKey>(isSortKey(initialSort) ? initialSort : "stayful");
  const [compare, setCompare] = useState<string[]>([]);
  const [metric, setMetric] = useState<MapMetric>("score");
  const [mobilePane, setMobilePane] = useState<"map" | "list">(initialArea ? "list" : "map");
  // First visit without goals: offer the questionnaire once. SSR renders it
  // closed; after mount we check the dismissal flag. `dismissed` is state so
  // closing the auto-opened modal actually re-renders.
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(savedAreas));
  const [, startSave] = useTransition();
  // Deal pipeline: checked listings live in the side pane next to the areas.
  const [listings, setListings] = useState<CheckedListingRow[]>(initialListings);
  const [sidePane, setSidePane] = useState<"areas" | "listings">(initialSidePane);
  const [activeListing, setActiveListing] = useState<string | null>(initialActiveListing);
  const [listingStatusFilter, setListingStatusFilter] = useState<PipelineStatus | "all">("all");
  const [listingSort, setListingSort] = useState<ListingSort>("fit");
  const [listingCompare, setListingCompare] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off mount flag for the auto-open
    setMounted(true);
  }, []);
  const autoOpenGoals = mounted && !goals && !dismissed && (() => { try { return localStorage.getItem(DISMISS_KEY) !== "1"; } catch { return false; } })();
  const closeGoals = useCallback(() => {
    setGoalsOpen(false);
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  }, []);

  // A specific bedroom count drives bedroom-specific row stats: the filter
  // first, then the goal profile.
  const bedroom = /^[1-3]$/.test(filters.beds) ? Number(filters.beds) : goals?.bedrooms && goals.bedrooms <= 3 ? goals.bedrooms : null;

  const rows = useMemo<ExplorerRow[]>(
    () =>
      cards.map((card) => ({
        card,
        personal: goals ? personaliseScore(personalInputFor(card, goals), goals) : null,
        saved: saved.has(card.code),
        trend: trends ? areaTrend(trends.areas[card.code]) : null,
      })),
    [cards, goals, saved, trends],
  );

  // The trend sort only makes sense once a handful of areas have a direction;
  // a deep link asking for it before then falls back to the Stayful score.
  const trendSortReady = useMemo(() => rows.filter((r) => r.trend && r.trend.enquiries.direction !== "insufficient").length >= 5, [rows]);
  const effectiveSort: SortKey = sort === "trend" && !trendSortReady ? "stayful" : sort;

  const q = filters.q.trim().toLowerCase();
  const visible = useMemo(() => {
    const filtered = rows.filter(({ card: c, saved: isSaved }) => {
      if (q && !(c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))) return false;
      if (filters.region !== "any" && c.licensing.nation !== filters.region) return false;
      if (!hasBeds(c.headline.bedroomsAvailable, filters.beds)) return false;
      const valueMid = bedroom != null ? c.byBedrooms.find((b) => b.bedrooms === bedroom)?.propertyValueMid ?? null : c.yieldOnCost?.propertyValueMid ?? null;
      if (!inBudget(valueMid, filters.budget)) return false;
      if (!passesConfidence(c.confidence.tier, filters.conf)) return false;
      if (filters.savedOnly && !isSaved) return false;
      return true;
    });
    return sortRows(filtered, effectiveSort, filters.savedOnly);
  }, [rows, q, filters, bedroom, effectiveSort]);

  const byCode = useMemo(() => new Map(rows.map((r) => [r.card.code, r])), [rows]);
  const selectedRow = selected ? byCode.get(selected) ?? null : null;

  // Keep the URL in step with the selection (deep links survive refresh/share).
  const select = useCallback(
    (code: string | null) => {
      setSelected(code);
      if (code) setMobilePane("list");
      const row = code ? byCode.get(code) : null;
      const path = row ? `/markets/${row.card.slug}` : "/markets";
      try { window.history.replaceState(null, "", `${path}${window.location.search}`); } catch { /* ignore */ }
    },
    [byCode],
  );

  const updateSort = (s: SortKey) => {
    setSort(s);
    try {
      const u = new URL(window.location.href);
      if (s === "stayful") u.searchParams.delete("sort"); else u.searchParams.set("sort", s);
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  };

  const toggleCompare = (code: string) =>
    setCompare((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : prev.length >= MAX_COMPARE ? prev : [...prev, code]));

  const toggleSaved = (code: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    startSave(async () => {
      const res = await toggleSavedAreaAction(code);
      if ("error" in res) {
        // roll back the optimistic flip
        setSaved((prev) => {
          const next = new Set(prev);
          if (next.has(code)) next.delete(code); else next.add(code);
          return next;
        });
      }
    });
  };

  const home = goals?.home && goals.home.lat !== null && goals.home.lng !== null ? { lat: goals.home.lat, lng: goals.home.lng, radiusMiles: goals.maxDistanceMiles } : null;
  const compareRows = compare.map((c) => byCode.get(c)).filter((r): r is ExplorerRow => !!r);

  // ── Deal pipeline helpers ──
  const areaRowOf = useCallback((l: CheckedListingRow): ExplorerRow | null => (l.postcodeArea ? byCode.get(l.postcodeArea) ?? null : null), [byCode]);
  const areaFit = useCallback((l: CheckedListingRow): number | null => areaRowOf(l)?.personal?.score ?? null, [areaRowOf]);
  const activeListingRow = activeListing ? listings.find((l) => l.id === activeListing) ?? null : null;
  const openListing = useCallback(
    (id: string) => {
      setSidePane("listings");
      setActiveListing(id);
      setMobilePane("list");
      const l = listings.find((x) => x.id === id);
      if (l?.postcodeArea && byCode.has(l.postcodeArea)) setSelected(l.postcodeArea);
    },
    [listings, byCode],
  );
  const [listingNotice, setListingNotice] = useState<string | null>(null);
  const onResolved = (res: ResolvedListing) => {
    const row = rowFromResolved(res);
    if (row?.postcodeArea && byCode.has(row.postcodeArea)) setSelected(row.postcodeArea);
    if (!row) {
      // The listing was read but not saved (database hiccup): nothing to act on yet.
      setListingNotice("We read that listing but could not save it to your pipeline. Please try again in a moment.");
      setSidePane("listings");
      setActiveListing(null);
      setMobilePane("list");
      return;
    }
    setListingNotice(null);
    setListings((prev) => {
      const existing = prev.find((l) => l.canonicalUrl === row.canonicalUrl);
      const merged = existing ? { ...existing, ...row, status: existing.status, notes: existing.notes, shareToken: existing.shareToken, analysedReportId: existing.analysedReportId } : row;
      return [merged, ...prev.filter((l) => l.canonicalUrl !== row.canonicalUrl)];
    });
    setSidePane("listings");
    setActiveListing(row.id);
    setMobilePane("list");
  };
  const updateListing = (id: string, patch: Partial<CheckedListingRow>) => setListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeListing = (id: string) => {
    setListings((prev) => prev.filter((l) => l.id !== id));
    setListingCompare((prev) => prev.filter((c) => c !== id));
    setActiveListing(null);
  };
  const toggleListingCompare = (id: string) =>
    setListingCompare((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : prev.length >= MAX_COMPARE ? prev : [...prev, id]));
  const listingCompareRows = listingCompare.map((id) => listings.find((l) => l.id === id)).filter((l): l is CheckedListingRow => !!l);
  const pins = listings
    .filter((l) => l.lat !== null && l.lng !== null && l.status !== "passed")
    .map((l) => ({ id: l.id, lat: l.lat!, lng: l.lng!, colour: PIPELINE_STATUSES.find((s) => s.key === l.status)?.colour ?? "#9a7b2e", label: `${l.title}${l.price ? ` · £${Math.round(l.price.amount).toLocaleString("en-GB")}` : ""}`, active: l.id === activeListing }));

  const listingsShown = sidePane === "listings";
  const drawerShown = listingsShown ? !!activeListingRow : !!selectedRow || (!!initialAreaName && !!selected);

  return (
    <div className={"mx-explorer" + (drawerShown ? " has-drawer" : "") + ` pane-${mobilePane}`}>
      <GoalBar
        filters={filters}
        onFilters={setFilters}
        sort={effectiveSort}
        onSort={updateSort}
        goals={goals}
        onEditGoals={() => setGoalsOpen(true)}
        resultCount={visible.length}
        savedCount={saved.size}
        mobilePane={mobilePane}
        onMobilePane={setMobilePane}
        trendSortReady={trendSortReady}
        listingsCount={listings.filter((l) => l.status !== "passed").length}
        listingsOpen={listingsShown}
        onToggleListings={() => {
          setSidePane(listingsShown ? "areas" : "listings");
          setActiveListing(null);
          setMobilePane("list");
        }}
      />
      <ListingCheck onResolved={onResolved} initialUrl={initialCheckUrl} />
      {trends && <MarketPulse national={trends.national} compact />}

      <div className="mx-explorer-body">
        <div className="mx-explorer-map">
          <MapPane
            rows={visible}
            selected={selected}
            hover={hover}
            onSelect={select}
            onHover={setHover}
            metric={goals || metric !== "personal" ? metric : "score"}
            onMetricChange={setMetric}
            hasGoals={!!goals}
            home={home}
            pins={pins}
            onPinClick={openListing}
          />
        </div>

        <div className="mx-explorer-side">
          {listingsShown ? (
            activeListingRow ? (
              <ListingDrawer
                key={activeListingRow.id}
                listing={activeListingRow}
                areaRow={areaRowOf(activeListingRow)}
                comparing={listingCompare.includes(activeListingRow.id)}
                compareDisabled={listingCompare.length >= MAX_COMPARE}
                onClose={() => setActiveListing(null)}
                onChange={updateListing}
                onRemoved={removeListing}
                onOpenArea={(code) => {
                  setSidePane("areas");
                  setActiveListing(null);
                  select(code);
                }}
                onToggleCompare={() => toggleListingCompare(activeListingRow.id)}
              />
            ) : (
              <>
              {listingNotice && <div className="mx-note mx-note--error" role="alert" style={{ margin: "10px 16px 0" }}>{listingNotice}</div>}
              <ListingsPane
                listings={listings}
                statusFilter={listingStatusFilter}
                onStatusFilter={setListingStatusFilter}
                sort={listingSort}
                onSort={setListingSort}
                areaFit={areaFit}
                compare={listingCompare}
                onToggleCompare={toggleListingCompare}
                onSelect={openListing}
                onBack={() => setSidePane("areas")}
              />
              </>
            )
          ) : selectedRow ? (
            <DetailDrawer
              row={selectedRow}
              bedroom={bedroom}
              comparing={compare.includes(selectedRow.card.code)}
              compareDisabled={compare.length >= MAX_COMPARE}
              userEmail={userEmail}
              onClose={() => select(null)}
              onToggleCompare={() => toggleCompare(selectedRow.card.code)}
              onToggleSaved={() => toggleSaved(selectedRow.card.code)}
            />
          ) : initialAreaName && selected ? (
            <aside className="mx-drawer">
              <div className="mx-drawer-head">
                <div className="mx-drawer-title"><h2>{initialAreaName}</h2></div>
                <button type="button" className="mx-cmp-close mx-drawer-close" aria-label="Close" onClick={() => select(null)}>×</button>
              </div>
              <div className="mx-drawer-body">
                <div className="mx-empty"><h2>Not enough data yet for {initialAreaName}</h2><p>As more Stayful analyser reports come in for this area, it will appear in the explorer automatically.</p></div>
              </div>
            </aside>
          ) : (
            <AreaList
              rows={visible}
              selected={selected}
              hover={hover}
              compare={compare}
              bedroom={bedroom}
              onSelect={select}
              onHover={setHover}
              onToggleCompare={toggleCompare}
              onToggleSaved={toggleSaved}
              emptyMessage={q ? `We don't have data for “${filters.q}” yet — try another area or postcode.` : "Try widening your budget, bedrooms, region, confidence or saved filter."}
            />
          )}
          {listingsShown ? (
            <ListingCompare rows={listingCompareRows} areaOf={areaRowOf} onRemove={(id) => setListingCompare((prev) => prev.filter((c) => c !== id))} onClear={() => setListingCompare([])} />
          ) : (
            <CompareBar rows={compareRows} bedroom={bedroom} onRemove={(code) => setCompare((prev) => prev.filter((c) => c !== code))} onClear={() => setCompare([])} />
          )}
        </div>
      </div>

      {(goalsOpen || autoOpenGoals) && <GoalsModal goals={goals} alertWeekly={alertWeekly} sourcingAlerts={sourcingAlerts} onClose={closeGoals} />}
    </div>
  );
}
