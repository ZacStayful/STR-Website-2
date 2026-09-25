"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { toggleSavedAreaAction } from "../../../../actions";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { areaTrend } from "@/lib/market/trend";
import { MIN_DISTRICT_SAMPLES } from "@/lib/market/confidence";
import { buildTabModel, type TabKey } from "@/lib/market/tab-model";
import { districtLabel, marketTitle, subMarketTitle } from "@/lib/market/labels";
import type { AreaCardData } from "@/lib/market/explorer";
import type { CheckedListingRow } from "@/lib/listing/pipeline";
import type { AreaDealsSummary } from "@/lib/marketplace/grid";
import type { ExplorerRow, MarketGoals, SortKey } from "../../types";
import { GoalsModal } from "../../GoalsModal";
import { ManagedEnquiry } from "../../ManagedEnquiry";
import { useCompareStore } from "../shared/useCompareStore";
import { CompareDock } from "../shared/CompareDock";
import { MarketHeader } from "./MarketHeader";
import { MarketTabs } from "./MarketTabs";
import { OverviewTab } from "./OverviewTab";
import { GenericTab } from "./GenericTab";
import { DealsTab } from "./DealsTab";

const DISMISS_KEY = "mx_goals_dismissed";

/**
 * The full-width market page (design screen 2): header, tabs, and the
 * tab body for the area or one of its districts. Replaces the drawer.
 */
export function MarketPage({
  card,
  areaName,
  cards,
  goals,
  savedAreas,
  userEmail,
  listings: initialListings,
  marketDeals,
  initialTab,
  initialDistrict,
  initialSort,
}: {
  /** Null when the area has no data yet. */
  card: AreaCardData | null;
  areaName: string;
  /** Every area card, for the compare modal. */
  cards: AreaCardData[];
  goals: MarketGoals | null;
  savedAreas: string[];
  userEmail: string | null;
  listings: CheckedListingRow[];
  /** Live marketplace deals in this area; null when the marketplace is not configured. */
  marketDeals: AreaDealsSummary | null;
  initialTab: TabKey;
  initialDistrict: string | null;
  initialSort: SortKey;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [district, setDistrict] = useState<string | null>(() => (card && initialDistrict && card.districts.some((d) => d.code === initialDistrict) ? initialDistrict : null));
  const [bedroom, setBedroom] = useState<number | null>(goals?.bedrooms && goals.bedrooms <= 3 ? goals.bedrooms : null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(savedAreas));
  const [, startSave] = useTransition();
  const [listings, setListings] = useState<CheckedListingRow[]>(initialListings);
  const [activeListing, setActiveListing] = useState<string | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const compare = useCompareStore();

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

  const rowFor = useCallback((c: AreaCardData): ExplorerRow => ({ card: c, personal: goals ? personaliseScore(personalInputFor(c, goals), goals) : null, saved: saved.has(c.code), trend: areaTrend(c.series) }), [goals, saved]);
  const row = useMemo(() => (card ? rowFor(card) : null), [card, rowFor]);
  const dataCodes = useMemo(() => new Set(cards.map((c) => c.code)), [cards]);
  const compareRows = useMemo(() => compare.codes.map((code) => cards.find((c) => c.code === code)).filter((c): c is AreaCardData => !!c).map(rowFor), [compare.codes, cards, rowFor]);

  const syncUrl = useCallback((t: TabKey, d: string | null) => {
    try {
      const u = new URL(window.location.href);
      if (t === "overview") u.searchParams.delete("tab"); else u.searchParams.set("tab", t);
      if (d) u.searchParams.set("district", d); else u.searchParams.delete("district");
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  }, []);
  const changeTab = useCallback((t: TabKey) => { setTab(t); syncUrl(t, district); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* ignore */ } }, [district, syncUrl]);
  const changeDistrict = useCallback((d: string | null) => { setDistrict(d); syncUrl(tab, d); }, [tab, syncUrl]);

  const toggleSaved = (code: string) => {
    const flip = (prev: Set<string>) => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; };
    setSaved(flip);
    startSave(async () => {
      const res = await toggleSavedAreaAction(code);
      if ("error" in res) setSaved(flip); // roll back the optimistic flip
    });
  };

  const backParams = new URLSearchParams();
  if (card) backParams.set("region", card.region.slug);
  if (initialSort !== "stayful") backParams.set("sort", initialSort);
  const backHref = backParams.size ? `/markets?${backParams}` : "/markets";
  const goalsModal = (goalsOpen || autoOpenGoals) && <GoalsModal goals={goals} onClose={closeGoals} />;

  if (!card || !row) {
    return (
      <div className="mx2-market">
        <header className="mx2-market-head"><div className="mx2-market-row">
          <Link href="/markets" className="mx2-btn mx2-btn--icon mx2-btn--secondary" aria-label="Back to markets">←</Link>
          <div className="mx2-crumbs"><span className="mx2-crumb-eyebrow">Market overview</span><h2>{areaName}</h2></div>
        </div></header>
        <div className="mx2-tabbody">
          <div className="mx-empty"><h2>Not enough data yet for {areaName}</h2><p>As more Stayful analyser reports come in for this area, it will appear in the explorer automatically.</p></div>
        </div>
        <CtaBand />
        {goalsModal}
      </div>
    );
  }

  const districtRow = district ? card.districts.find((d) => d.code === district) ?? null : null;
  const scope = districtRow ?? card;
  const scopeName = districtRow ? subMarketTitle(card, districtRow) : marketTitle(card);
  const trend = areaTrend(scope.series);
  const ctx = { area: card, scope, scopeName, isDistrict: !!districtRow, bedroom, trend, goals };
  const dealsHere = listings.filter((l) => l.postcodeArea === card.code && l.status !== "passed").length;
  const openArea = (code: string) => { const c = cards.find((x) => x.code === code); router.push(c ? `/markets/${c.slug}` : "/markets"); };

  return (
    <div className="mx2-market">
      <MarketHeader
        area={card}
        district={district}
        bedroom={bedroom}
        personal={row.personal}
        hasGoals={!!goals}
        saved={saved.has(card.code)}
        comparing={compare.has(card.code)}
        compareFull={compare.full}
        backHref={backHref}
        dataCodes={dataCodes}
        onDistrict={changeDistrict}
        onBedroom={setBedroom}
        onToggleSaved={() => toggleSaved(card.code)}
        onToggleCompare={() => compare.toggle(card.code)}
        onSetGoals={() => setGoalsOpen(true)}
      />
      <MarketTabs tab={tab} onTab={changeTab} dealsCount={dealsHere} />

      <div id="mx2-tabpanel" role="tabpanel" aria-labelledby={`mx2-tab-${tab}`} key={`${tab}-${district ?? "area"}`}>
        {districtRow && !districtRow.ready && tab !== "deals" ? (
          <div className="mx2-tabbody">
            <div className="mx2-section-head"><div><h3>{scopeName}</h3></div></div>
            <div className="mx-empty">
              <h2>Early — {districtRow.headline.totalSamples} of {MIN_DISTRICT_SAMPLES} reports</h2>
              <p>{districtLabel(districtRow)} needs {MIN_DISTRICT_SAMPLES - districtRow.headline.totalSamples} more Stayful analyser report{MIN_DISTRICT_SAMPLES - districtRow.headline.totalSamples === 1 ? "" : "s"} before its own figures are shown. Until then, {card.name} as a whole is the guide.</p>
              <button type="button" className="mx2-btn mx2-btn--secondary" onClick={() => changeDistrict(null)}>Show {card.name} as a whole</button>
            </div>
          </div>
        ) : tab === "overview" ? (
          <OverviewTab area={card} scope={scope} scopeName={scopeName} personal={row.personal} trend={trend} goals={goals} listings={listings} marketDeals={marketDeals} dataCodes={dataCodes} onTab={changeTab} onOpenDistrict={changeDistrict} onOpenListing={(id) => { setActiveListing(id); changeTab("deals"); }} onSetGoals={() => setGoalsOpen(true)} />
        ) : tab === "deals" ? (
          <DealsTab areaRow={row} goals={goals} listings={listings} marketDeals={marketDeals} onListings={setListings} activeListing={activeListing} onActiveListing={setActiveListing} onOpenArea={openArea} />
        ) : (
          <GenericTab model={buildTabModel(tab, ctx)} ctx={ctx} onOpenDistrict={changeDistrict} />
        )}
      </div>

      {card.managedByStayful && tab === "overview" && (
        <div className="mx2-tabbody mx2-managed">
          <div className="mx2-card">
            <h4 className="mx2-h4">Stayful already manages here</h4>
            <p className="mx2-note">We run short-lets in {card.name} today, so we know the guests, the cleaners and the rules. Want a hands-off setup?</p>
            <ManagedEnquiry areaCode={card.code} areaName={card.name} email={userEmail} />
          </div>
        </div>
      )}

      <p className="mx2-src">
        {scopeName} figures are averages from {scope.headline.totalSamples} Stayful analyser reports {districtRow ? `in the ${districtRow.code} postcode district${districtRow.locality ? ` (${districtRow.localities.join(", ")})` : ""}` : `across the ${card.code} postcode area`}; indicative, not a guarantee of returns. Licensing is a general guide; confirm with the local authority before buying.
      </p>
      <CtaBand />
      {compare.hydrated && <CompareDock rows={compareRows} bedroom={bedroom} onRemove={compare.remove} onClear={compare.clear} />}
      {goalsModal}
    </div>
  );
}

function CtaBand() {
  return (
    <div className="mx2-cta-band">
      <div>These are area averages. To model a specific address, run it through the analyser.</div>
      <Link href="/estimate" className="mx2-btn mx2-btn--primary">Analyse an address <ArrowRight size={14} aria-hidden /></Link>
    </div>
  );
}
