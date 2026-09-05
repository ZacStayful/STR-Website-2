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
}: {
  cards: AreaCardData[];
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
      })),
    [cards, goals, saved],
  );

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
    return sortRows(filtered, sort, filters.savedOnly);
  }, [rows, q, filters, bedroom, sort]);

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
  const drawerShown = !!selectedRow || (!!initialAreaName && !!selected);

  return (
    <div className={"mx-explorer" + (drawerShown ? " has-drawer" : "") + ` pane-${mobilePane}`}>
      <GoalBar
        filters={filters}
        onFilters={setFilters}
        sort={sort}
        onSort={updateSort}
        goals={goals}
        onEditGoals={() => setGoalsOpen(true)}
        resultCount={visible.length}
        savedCount={saved.size}
        mobilePane={mobilePane}
        onMobilePane={setMobilePane}
      />

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
          />
        </div>

        <div className="mx-explorer-side">
          {selectedRow ? (
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
          <CompareBar rows={compareRows} bedroom={bedroom} onRemove={(code) => setCompare((prev) => prev.filter((c) => c !== code))} onClear={() => setCompare([])} />
        </div>
      </div>

      {(goalsOpen || autoOpenGoals) && <GoalsModal goals={goals} onClose={closeGoals} />}
    </div>
  );
}
