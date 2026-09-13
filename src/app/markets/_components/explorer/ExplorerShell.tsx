"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toggleSavedAreaAction } from "../../actions";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { sortRows, isSortKey, SORT_LABELS } from "@/lib/market/rank";
import { hasBeds, inBudget, passesConfidence } from "@/lib/market/filters";
import { CompareBar, MAX_COMPARE } from "../CompareBar";
import { MapPane } from "./MapPane";
import { TopBar } from "./TopBar";
import { GoalsModal } from "./GoalsModal";
import { AreaList } from "./AreaList";
import { DetailDrawer } from "./DetailDrawer";
import { DistrictDrawer } from "./DistrictDrawer";
import { RegionList } from "./RegionList";
import { DEFAULT_FILTERS, type AreaCardData, type Crumb, type ExplorerRow, type Filters, type MapMetric, type MarketGoals, type RegionCardData, type SortKey } from "./types";
import { areaTrend, pulse, trendLabel } from "@/lib/market/trend";
import type { MonthBucket } from "@/lib/market/types";
import { regionForSlug } from "@/lib/market/regions";
import { ListingsPane } from "./ListingsPane";
import { ListingDrawer } from "./ListingDrawer";
import { ListingCompare } from "./ListingCompare";
import { rowFromResolved, type CheckedListingRow, type ListingSort, type PipelineStatus } from "@/lib/listing/pipeline";
import { VERDICT_CHIPS, VERDICT_COLOURS } from "@/lib/listing/verdict";
import { listingVerdict } from "./verdicts";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";

const DISMISS_KEY = "mx_goals_dismissed";

export function ExplorerShell({
  cards,
  regions = [],
  national = [],
  goals,
  savedAreas,
  initialArea = null,
  initialAreaName = null,
  initialRegion = null,
  initialDistrict = null,
  initialSort = "stayful",
  initialQuery = "",
  userEmail = null,
  alertWeekly = true,
  sourcingAlerts = false,
  listings: initialListings = [],
  initialSidePane = "areas",
  initialActiveListing = null,
  initialCheckUrl = null,
}: {
  cards: AreaCardData[];
  /** Region cards (the top level) and the nationwide monthly series, from the same snapshot. */
  regions?: RegionCardData[];
  national?: MonthBucket[];
  /** Region slug to open on, "all" for the flat area list, null for the region step. */
  initialRegion?: string | "all" | null;
  /** Postcode district to open inside `initialArea` (deep link). */
  initialDistrict?: string | null;
  alertWeekly?: boolean;
  sourcingAlerts?: boolean;
  /** A listing URL prefilled in the search box (from the sourcing email's "Add to pipeline"); the member still clicks Check. */
  initialCheckUrl?: string | null;
  /** The member's checked listings (deal pipeline). */
  listings?: CheckedListingRow[];
  /** Open on the deals instead of the areas list (deep links / fixtures). */
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
  // Regions › areas › districts. A deep-linked area lands inside its region;
  // otherwise the member starts at the region step (or the flat list on ?region=all).
  const [region, setRegion] = useState<string | "all" | null>(() => {
    if (initialArea) return cards.find((c) => c.code === initialArea)?.region.slug ?? initialRegion ?? "all";
    return initialRegion;
  });
  const [district, setDistrict] = useState<string | null>(() => {
    if (!initialArea || !initialDistrict) return null;
    return cards.find((c) => c.code === initialArea)?.districts.some((d) => d.code === initialDistrict) ? initialDistrict : null;
  });
  const [regionHover, setRegionHover] = useState<string | null>(null);
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
        trend: areaTrend(card.series),
      })),
    [cards, goals, saved],
  );

  // The trend sort only makes sense once a handful of areas have a direction;
  // a deep link asking for it before then falls back to the Stayful score.
  const trendSortReady = useMemo(() => rows.filter((r) => r.trend && r.trend.enquiries.direction !== "insufficient").length >= 5, [rows]);
  const effectiveSort: SortKey = sort === "trend" && !trendSortReady ? "stayful" : sort === "personal" && !goals ? "stayful" : sort;

  const q = filters.q.trim().toLowerCase();
  const visible = useMemo(() => {
    const filtered = rows.filter(({ card: c, saved: isSaved }) => {
      if (region && region !== "all" && c.region.slug !== region) return false;
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
  }, [rows, q, filters, bedroom, effectiveSort, region]);

  const byCode = useMemo(() => new Map(rows.map((r) => [r.card.code, r])), [rows]);
  const selectedRow = selected ? byCode.get(selected) ?? null : null;
  const districtRow = selectedRow && district ? selectedRow.card.districts.find((d) => d.code === district) ?? null : null;

  // Keep the URL in step with the level and selection (deep links survive refresh/share).
  const syncUrl = useCallback((code: string | null, reg: string | "all" | null, dist: string | null) => {
    try {
      const row = code ? byCode.get(code) : null;
      const u = new URL(window.location.href);
      u.pathname = row ? `/markets/${row.card.slug}` : "/markets";
      u.searchParams.delete("region");
      u.searchParams.delete("district");
      if (!row && reg) u.searchParams.set("region", reg);
      if (row && dist) u.searchParams.set("district", dist);
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  }, [byCode]);

  const select = useCallback(
    (code: string | null) => {
      setSelected(code);
      setDistrict(null);
      const row = code ? byCode.get(code) : null;
      // Landing on an area from the map or a deep link puts its region on the trail.
      const nextRegion = row ? row.card.region.slug : region;
      if (row) setRegion(nextRegion);
      if (code) setMobilePane("list");
      syncUrl(code, nextRegion, null);
    },
    [byCode, region, syncUrl],
  );

  const openRegion = useCallback((slug: string | "all" | null) => {
    setRegion(slug);
    setSelected(null);
    setDistrict(null);
    setMobilePane("list");
    syncUrl(null, slug, null);
  }, [syncUrl]);

  const openDistrict = useCallback((code: string | null) => {
    setDistrict(code);
    setMobilePane("list");
    syncUrl(selected, region, code);
  }, [selected, region, syncUrl]);

  const regionMeta = region && region !== "all" ? regionForSlug(region) : null;
  const crumbs: Crumb[] = [
    { label: "Regions", onClick: () => openRegion(null) },
    ...(region === "all" ? [{ label: "All areas", onClick: selectedRow ? () => openRegion("all") : undefined }] : []),
    ...(regionMeta ? [{ label: regionMeta.name, onClick: selectedRow ? () => openRegion(regionMeta.slug) : undefined }] : []),
    ...(selectedRow ? [{ label: selectedRow.card.name, onClick: districtRow ? () => openDistrict(null) : undefined }] : []),
    ...(districtRow ? [{ label: districtRow.code }] : []),
  ];
  // Every area on the map at the region step; only the region's areas once inside one.
  const mapRows = region === null ? rows : visible;

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
  const verdicts = useMemo(() => new Map(listings.map((l) => [l.id, listingVerdict(l)])), [listings]);
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
      setListingNotice("We read that listing but could not save it to your deals. Please try again in a moment.");
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
    .map((l) => {
      const v = verdicts.get(l.id);
      const tone = v?.tone ?? "unknown";
      return { id: l.id, lat: l.lat!, lng: l.lng!, colour: VERDICT_COLOURS[tone], legend: VERDICT_CHIPS[tone], label: `${l.title}${v ? ` · ${v.number} ${v.numberLabel}` : ""}`, active: l.id === activeListing };
    });

  const listingsShown = sidePane === "listings";
  const drawerShown = listingsShown ? !!activeListingRow : !!selectedRow || (!!initialAreaName && !!selected);
  const nationalPulse = national.length > 0 ? pulse(national) : null;
  const pulseLabel = nationalPulse && nationalPulse.enquiries.direction !== "insufficient" ? trendLabel(nationalPulse.enquiries.direction) : null;

  return (
    <div className={"mx-explorer" + (drawerShown ? " has-drawer" : "") + ` pane-${mobilePane}`}>
      <TopBar
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
        dealsCount={listings.filter((l) => l.status !== "passed").length}
        view={sidePane}
        onView={(v) => {
          setSidePane(v);
          setActiveListing(null);
          setMobilePane("list");
        }}
        onResolved={onResolved}
        initialCheckUrl={initialCheckUrl}
      />

      <div className="mx-explorer-body">
        <div className="mx-explorer-map">
          <MapPane
            rows={mapRows}
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
            pulse={pulseLabel ? <><b className={`mx-pulse-word mx-pulse-word--${nationalPulse!.enquiries.direction}`}>{pulseLabel}</b> across the UK this month</> : null}
          />
        </div>

        <div className="mx-explorer-side">
          {listingsShown ? (
            activeListingRow ? (
              <ListingDrawer
                key={activeListingRow.id}
                listing={activeListingRow}
                verdict={verdicts.get(activeListingRow.id) ?? listingVerdict(activeListingRow)}
                areaRow={areaRowOf(activeListingRow)}
                areaFit={areaFit(activeListingRow)}
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
                verdicts={verdicts}
                statusFilter={listingStatusFilter}
                onStatusFilter={setListingStatusFilter}
                sort={listingSort}
                onSort={setListingSort}
                areaFit={areaFit}
                onSelect={openListing}
              />
              </>
            )
          ) : selectedRow && districtRow ? (
            <DistrictDrawer
              key={`${selectedRow.card.code}-${districtRow.code}`}
              district={districtRow}
              area={selectedRow.card}
              bedroom={bedroom}
              crumbs={crumbs}
              onClose={() => openDistrict(null)}
            />
          ) : selectedRow ? (
            <DetailDrawer
              row={selectedRow}
              bedroom={bedroom}
              goals={goals}
              comparing={compare.includes(selectedRow.card.code)}
              compareDisabled={compare.length >= MAX_COMPARE}
              userEmail={userEmail}
              crumbs={crumbs}
              onClose={() => select(null)}
              onToggleCompare={() => toggleCompare(selectedRow.card.code)}
              onToggleSaved={() => toggleSaved(selectedRow.card.code)}
              onOpenDistrict={openDistrict}
            />
          ) : region === null && !q && !filters.savedOnly ? (
            <RegionList
              regions={regions}
              sort={effectiveSort}
              sortLabel={SORT_LABELS[effectiveSort]}
              hover={regionHover}
              onHover={setRegionHover}
              onSelect={openRegion}
              onAll={() => openRegion("all")}
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
              total={region && region !== "all" ? rows.filter((r) => r.card.region.slug === region).length : rows.length}
              selected={selected}
              hover={hover}
              bedroom={bedroom}
              goals={goals}
              sortLabel={SORT_LABELS[effectiveSort]}
              crumbs={crumbs}
              scopeName={regionMeta?.name ?? null}
              onSelect={select}
              onHover={setHover}
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
