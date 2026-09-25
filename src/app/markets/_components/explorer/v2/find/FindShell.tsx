"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleSavedAreaAction } from "../../../../actions";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { sortRows, isSortKey } from "@/lib/market/rank";
import { hasBeds, inBudget, passesConfidence } from "@/lib/market/filters";
import { areaTrend, pulse, trendLabel } from "@/lib/market/trend";
import { regionForSlug } from "@/lib/market/regions";
import { districtMatches } from "@/lib/market/labels";
import type { MonthBucket } from "@/lib/market/types";
import type { AreaCardData, DistrictCardData } from "@/lib/market/explorer";
import { rowFromResolved, type CheckedListingRow, type ListingSort, type PipelineStatus } from "@/lib/listing/pipeline";
import { VERDICT_CHIPS, VERDICT_COLOURS } from "@/lib/listing/verdict";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";
import { MAX_COMPARE } from "../../../CompareBar";
import { MapPane } from "../../MapPane";
import { GoalsModal } from "../../GoalsModal";
import { ListingsPane } from "../../ListingsPane";
import { ListingDrawer } from "../../ListingDrawer";
import { ListingCompare } from "../../ListingCompare";
import { listingVerdict } from "../../verdicts";
import { DEFAULT_FILTERS, type ExplorerRow, type Filters, type Level, type MapMetric, type MarketGoals, type RegionCardData, type SortKey } from "../../types";
import { useListingSearch } from "../shared/useListingSearch";
import { useCompareStore } from "../shared/useCompareStore";
import { CompareDock } from "../shared/CompareDock";
import { FindHeader } from "./FindHeader";
import { FilterBar } from "./FilterBar";
import { CardGrid } from "./CardGrid";
import { MarketCard } from "./MarketCard";
import { SubMarketCard } from "./SubMarketCard";

const DISMISS_KEY = "mx_goals_dismissed";

/** Districts sort by the figures they carry; keys that need a score fall back to revenue. */
function districtSortValue(d: DistrictCardData, key: SortKey): number | null {
  switch (key) {
    case "occupancy": return d.headline.occupancy;
    case "adr": return d.headline.adr;
    case "yield": return d.yieldOnCost?.grossYieldPct ?? null;
    case "competition": return d.competition ? 100 - d.competition.intensity : null;
    case "seasonality": return d.seasonality?.score ?? null;
    case "directBooking": return d.directBooking?.score ?? null;
    case "growth": return d.keyStats?.growth5y ?? null;
    default: return d.headline.grossRevenue;
  }
}

/**
 * The find screen (design screen 1): filters, a card grid on the left and
 * the sticky choropleth on the right. Cards and map paths navigate to the
 * market page; the deal pipeline is the third level of the grid.
 */
export function FindShell({
  cards,
  regions = [],
  national = [],
  goals,
  savedAreas,
  listings: initialListings = [],
  initialRegion = null,
  initialLevel = "markets",
  initialActiveListing = null,
  initialCheckUrl = null,
  initialGoalsOpen = false,
  initialSort = "stayful",
  initialQuery = "",
}: {
  cards: AreaCardData[];
  regions?: RegionCardData[];
  national?: MonthBucket[];
  goals: MarketGoals | null;
  savedAreas: string[];
  listings?: CheckedListingRow[];
  /** Region slug to open on; null for every area. */
  initialRegion?: string | null;
  initialLevel?: Level;
  initialActiveListing?: string | null;
  /** A listing URL prefilled in the search box (from the sourcing email); the member still clicks Check. */
  initialCheckUrl?: string | null;
  /** /markets?goals=1 (the "set my filter" button in the pick email) opens the goals modal straight away. */
  initialGoalsOpen?: boolean;
  initialSort?: SortKey;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [level, setLevel] = useState<Level>(initialLevel);
  const [region, setRegion] = useState<string | null>(initialRegion);
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, q: initialQuery });
  const [sort, setSort] = useState<SortKey>(isSortKey(initialSort) ? initialSort : "stayful");
  const [metric, setMetric] = useState<MapMetric>("score");
  const [hover, setHover] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"cards" | "map">(initialActiveListing ? "map" : "cards");
  const [goalsOpen, setGoalsOpen] = useState(initialGoalsOpen);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(savedAreas));
  const [, startSave] = useTransition();
  const compare = useCompareStore();
  // Deal pipeline: the member's checked listings, the third level of the grid.
  const [listings, setListings] = useState<CheckedListingRow[]>(initialListings);
  const [activeListing, setActiveListing] = useState<string | null>(initialActiveListing);
  const [listingStatusFilter, setListingStatusFilter] = useState<PipelineStatus | "all">("all");
  const [listingSort, setListingSort] = useState<ListingSort>("fit");
  const [listingCompare, setListingCompare] = useState<string[]>([]);
  const [listingNotice, setListingNotice] = useState<string | null>(null);

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

  // ── URL: /markets?region=&level=sub&sort=&q= | ?pane=listings&listing= ──
  const syncUrl = useCallback((s: { level: Level; region: string | null; sort: SortKey; q: string; listing: string | null }) => {
    try {
      const u = new URL(window.location.href);
      u.pathname = "/markets";
      for (const k of ["region", "level", "pane", "listing", "sort", "q"]) u.searchParams.delete(k);
      if (s.region) u.searchParams.set("region", s.region);
      if (s.level === "sub") u.searchParams.set("level", "sub");
      if (s.level === "deals") u.searchParams.set("pane", "listings");
      if (s.level === "deals" && s.listing) u.searchParams.set("listing", s.listing);
      if (s.sort !== "stayful") u.searchParams.set("sort", s.sort);
      if (s.q.trim()) u.searchParams.set("q", s.q.trim());
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  }, []);
  const urlState = { level, region, sort, q: filters.q, listing: activeListing };
  const changeLevel = (l: Level) => { setLevel(l); if (l !== "deals") setActiveListing(null); setMobilePane("cards"); syncUrl({ ...urlState, level: l, listing: l === "deals" ? activeListing : null }); };
  const changeRegion = (slug: string | null) => { setRegion(slug); syncUrl({ ...urlState, region: slug }); };
  const changeSort = (s: SortKey) => { setSort(s); syncUrl({ ...urlState, sort: s }); };
  const changeFilters = (f: Filters) => { setFilters(f); if (f.q !== filters.q) syncUrl({ ...urlState, q: f.q }); };

  // A specific bedroom count drives bedroom-specific card stats: the filter first, then the goal profile.
  const bedroom = /^[1-3]$/.test(filters.beds) ? Number(filters.beds) : goals?.bedrooms && goals.bedrooms <= 3 ? goals.bedrooms : null;

  const rows = useMemo<ExplorerRow[]>(
    () => cards.map((card) => ({ card, personal: goals ? personaliseScore(personalInputFor(card, goals), goals) : null, saved: saved.has(card.code), trend: areaTrend(card.series) })),
    [cards, goals, saved],
  );
  const trendSortReady = useMemo(() => rows.filter((r) => r.trend && r.trend.enquiries.direction !== "insufficient").length >= 5, [rows]);
  const effectiveSort: SortKey = sort === "trend" && !trendSortReady ? "stayful" : sort === "personal" && !goals ? "stayful" : sort;

  const q = filters.q.trim().toLowerCase();
  const visible = useMemo(() => {
    const filtered = rows.filter(({ card: c, saved: isSaved }) => {
      if (region && c.region.slug !== region) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.districts.some((d) => districtMatches(d, q)))) return false;
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

  const districts = useMemo(() => {
    const all = visible.flatMap((r) => r.card.districts.map((d) => ({ row: r, d })));
    return all.sort((a, b) => {
      if (a.d.ready !== b.d.ready) return a.d.ready ? -1 : 1;
      const va = a.d.ready ? districtSortValue(a.d, effectiveSort) : null;
      const vb = b.d.ready ? districtSortValue(b.d, effectiveSort) : null;
      if (va === null && vb === null) return b.d.headline.totalSamples - a.d.headline.totalSamples;
      if (va === null) return 1;
      if (vb === null) return -1;
      return vb - va;
    });
  }, [visible, effectiveSort]);
  const districtSortNote = level === "sub" && (effectiveSort === "stayful" || effectiveSort === "personal" || effectiveSort === "distance" || effectiveSort === "trend") ? "Districts carry no score, so they are ordered by revenue." : null;

  const sortQuery = sort !== "stayful" ? `?sort=${sort}` : "";
  const openArea = useCallback((code: string) => { const r = byCode.get(code); if (r) router.push(`/markets/${r.card.slug}${sortQuery}`); }, [byCode, router, sortQuery]);
  const openDistrict = (row: ExplorerRow, d: DistrictCardData) => router.push(`/markets/${row.card.slug}?district=${d.code}${sort !== "stayful" ? `&sort=${sort}` : ""}`);

  const toggleSaved = (code: string) => {
    const flip = (prev: Set<string>) => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; };
    setSaved(flip);
    startSave(async () => {
      const res = await toggleSavedAreaAction(code);
      if ("error" in res) setSaved(flip); // roll back the optimistic flip
    });
  };

  // ── Deal pipeline helpers (as the classic shell) ──
  const areaRowOf = useCallback((l: CheckedListingRow): ExplorerRow | null => (l.postcodeArea ? byCode.get(l.postcodeArea) ?? null : null), [byCode]);
  const areaFit = useCallback((l: CheckedListingRow): number | null => areaRowOf(l)?.personal?.score ?? null, [areaRowOf]);
  const verdicts = useMemo(() => new Map(listings.map((l) => [l.id, listingVerdict(l)])), [listings]);
  const activeListingRow = activeListing ? listings.find((l) => l.id === activeListing) ?? null : null;
  const openListing = (id: string) => { setLevel("deals"); setActiveListing(id); setMobilePane("map"); syncUrl({ ...urlState, level: "deals", listing: id }); };
  const closeListing = () => { setActiveListing(null); setMobilePane("cards"); syncUrl({ ...urlState, listing: null }); };
  const onResolved = (res: ResolvedListing) => {
    const row = rowFromResolved(res);
    if (!row) {
      // The listing was read but not saved (database hiccup): nothing to act on yet.
      setListingNotice("We read that listing but could not save it to your deals. Please try again in a moment.");
      changeLevel("deals");
      return;
    }
    setListingNotice(null);
    setListings((prev) => {
      const existing = prev.find((l) => l.canonicalUrl === row.canonicalUrl);
      const merged = existing ? { ...existing, ...row, status: existing.status, notes: existing.notes, shareToken: existing.shareToken, analysedReportId: existing.analysedReportId } : row;
      return [merged, ...prev.filter((l) => l.canonicalUrl !== row.canonicalUrl)];
    });
    openListing(row.id);
  };
  const search = useListingSearch({ q: filters.q, onQuery: (nq) => changeFilters({ ...filters, q: nq }), onResolved, initialCheckUrl });
  const updateListing = (id: string, patch: Partial<CheckedListingRow>) => setListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeListing = (id: string) => { setListings((prev) => prev.filter((l) => l.id !== id)); setListingCompare((prev) => prev.filter((c) => c !== id)); closeListing(); };
  const toggleListingCompare = (id: string) => setListingCompare((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : prev.length >= MAX_COMPARE ? prev : [...prev, id]));
  const listingCompareRows = listingCompare.map((id) => listings.find((l) => l.id === id)).filter((l): l is CheckedListingRow => !!l);
  const pins = listings
    .filter((l) => l.lat !== null && l.lng !== null && l.status !== "passed")
    .map((l) => {
      const tone = verdicts.get(l.id)?.tone ?? "unknown";
      const v = verdicts.get(l.id);
      return { id: l.id, lat: l.lat!, lng: l.lng!, colour: VERDICT_COLOURS[tone], legend: VERDICT_CHIPS[tone], label: `${l.title}${v ? ` · ${v.number} ${v.numberLabel}` : ""}`, active: l.id === activeListing };
    });

  const home = goals?.home && goals.home.lat !== null && goals.home.lng !== null ? { lat: goals.home.lat, lng: goals.home.lng, radiusMiles: goals.maxDistanceMiles } : null;
  const compareRows = compare.codes.map((c) => byCode.get(c)).filter((r): r is ExplorerRow => !!r);
  const nationalPulse = national.length > 0 ? pulse(national) : null;
  const pulseLabel = nationalPulse && nationalPulse.enquiries.direction !== "insufficient" ? trendLabel(nationalPulse.enquiries.direction) : null;
  const regionMeta = region ? regionForSlug(region) : null;
  const totalInScope = region ? rows.filter((r) => r.card.region.slug === region).length : rows.length;
  const readyDistricts = districts.filter((x) => x.d.ready).length;
  const liveDeals = listings.filter((l) => l.status !== "passed").length;
  const shown = level === "markets"
    ? `${visible.length}${visible.length !== totalInScope ? ` of ${totalInScope}` : ""} market${visible.length === 1 ? "" : "s"} shown`
    : level === "sub"
      ? `${readyDistricts} sub-market${readyDistricts === 1 ? "" : "s"} with figures${districts.length > readyDistricts ? ` · ${districts.length - readyDistricts} early` : ""}`
      : `${listings.length} checked`;
  const emptyMessage = q ? `We don't have data for “${filters.q}” yet — try another area or postcode.` : "Try widening your budget, bedrooms, region, confidence or saved filter.";

  return (
    <div className={`mx2-find pane-${mobilePane}${activeListingRow ? " has-listing" : ""}`}>
      <FindHeader regions={regions} region={region} sort={effectiveSort} onRegion={changeRegion} mobilePane={mobilePane} onMobilePane={setMobilePane} />
      <FilterBar search={search} filters={filters} onFilters={changeFilters} goals={goals} onEditGoals={() => setGoalsOpen(true)} sort={effectiveSort} onSort={changeSort} resultCount={visible.length} savedCount={saved.size} trendSortReady={trendSortReady} autoFocusSearch={Boolean(initialCheckUrl)} />

      <div className="mx2-find-body">
        <CardGrid level={level} onLevel={changeLevel} counts={{ markets: visible.length, sub: readyDistricts, deals: liveDeals }} shown={shown} sort={effectiveSort} onSort={changeSort} goals={goals} trendSortReady={trendSortReady} hideSort={level === "deals"}>
          {level === "deals" ? (
            <>
              {listingNotice && <div className="mx-note mx-note--error" role="alert">{listingNotice}</div>}
              <ListingsPane listings={listings} verdicts={verdicts} statusFilter={listingStatusFilter} onStatusFilter={setListingStatusFilter} sort={listingSort} onSort={setListingSort} areaFit={areaFit} onSelect={openListing} />
            </>
          ) : level === "sub" ? (
            districts.length === 0 ? (
              <div className="mx-empty"><h2>No sub-markets yet</h2><p>{visible.length === 0 ? emptyMessage : "Reports for these areas do not carry a full postcode yet, so they cannot be split into districts."}</p></div>
            ) : (
              <>
                {districtSortNote && <p className="mx2-note">{districtSortNote} {regionMeta ? `Showing ${regionMeta.name}.` : ""}</p>}
                <div className="mx2-card-grid">
                  {districts.map(({ row, d }) => (
                    <SubMarketCard key={`${row.card.code}-${d.code}`} area={row.card} d={d} hovered={hover === row.card.code} onHover={(on) => setHover(on ? row.card.code : null)} onOpen={() => openDistrict(row, d)} />
                  ))}
                </div>
              </>
            )
          ) : visible.length === 0 ? (
            <div className="mx-empty"><h2>No markets match</h2><p>{emptyMessage}</p></div>
          ) : (
            <div className="mx2-card-grid">
              {visible.map((row) => (
                <MarketCard
                  key={row.card.code}
                  row={row}
                  bedroom={bedroom}
                  hovered={hover === row.card.code}
                  comparing={compare.has(row.card.code)}
                  compareDisabled={compare.full}
                  hasGoals={!!goals}
                  onHover={(on) => setHover(on ? row.card.code : null)}
                  onOpen={() => openArea(row.card.code)}
                  onToggleSaved={() => toggleSaved(row.card.code)}
                  onToggleCompare={() => compare.toggle(row.card.code)}
                  onSetGoals={() => setGoalsOpen(true)}
                />
              ))}
            </div>
          )}
        </CardGrid>

        <div className="mx2-find-map">
          {activeListingRow ? (
            <div className="mx-mappane mx2-find-listing">
              <ListingDrawer
                key={activeListingRow.id}
                listing={activeListingRow}
                verdict={verdicts.get(activeListingRow.id) ?? listingVerdict(activeListingRow)}
                areaRow={areaRowOf(activeListingRow)}
                areaFit={areaFit(activeListingRow)}
                comparing={listingCompare.includes(activeListingRow.id)}
                compareDisabled={listingCompare.length >= MAX_COMPARE}
                onClose={closeListing}
                onChange={updateListing}
                onRemoved={removeListing}
                onOpenArea={openArea}
                onToggleCompare={() => toggleListingCompare(activeListingRow.id)}
              />
            </div>
          ) : (
            <MapPane
              rows={visible}
              selected={null}
              hover={hover}
              onSelect={() => {}}
              onHover={setHover}
              onOpen={openArea}
              metric={goals || metric !== "personal" ? metric : "score"}
              onMetricChange={setMetric}
              hasGoals={!!goals}
              home={home}
              pins={pins}
              onPinClick={openListing}
              pulse={pulseLabel ? <><b className={`mx-pulse-word mx-pulse-word--${nationalPulse!.enquiries.direction}`}>{pulseLabel}</b> across the UK this month</> : null}
            />
          )}
        </div>
      </div>

      {level === "deals" ? (
        <ListingCompare rows={listingCompareRows} areaOf={areaRowOf} onRemove={(id) => setListingCompare((prev) => prev.filter((c) => c !== id))} onClear={() => setListingCompare([])} />
      ) : (
        compare.hydrated && <CompareDock rows={compareRows} bedroom={bedroom} onRemove={compare.remove} onClear={compare.clear} />
      )}

      {(goalsOpen || autoOpenGoals) && <GoalsModal goals={goals} onClose={closeGoals} />}
    </div>
  );
}
