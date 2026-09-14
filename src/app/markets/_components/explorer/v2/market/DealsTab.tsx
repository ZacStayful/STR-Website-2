"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { BUDGET_LABELS } from "@/lib/market/filters";
import { formatListingPrice } from "@/lib/listing/format";
import { PIPELINE_STATUSES, rowFromResolved, type CheckedListingRow } from "@/lib/listing/pipeline";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";
import type { ExplorerRow, MarketGoals } from "../../types";
import { listingVerdict } from "../../verdicts";
import { VerdictChip } from "../../VerdictBits";
import { ListingDrawer } from "../../ListingDrawer";
import { DataTable } from "../shared/DataTable";
import { KpiCard } from "../shared/KpiCard";
import { SearchOrPaste, SearchHint } from "../shared/SearchOrPaste";
import { useListingSearch } from "../shared/useListingSearch";

const KIND_LABEL = { sale: "Purchase", rent: "Rent-to-rent", str: "Short-let listing" } as const;

/** The member's deal pipeline, scoped to this market by default; a row opens the full deal sheet at the side. */
export function DealsTab({
  areaRow,
  goals,
  listings,
  onListings,
  activeListing,
  onActiveListing,
  onOpenArea,
}: {
  areaRow: ExplorerRow;
  goals: MarketGoals | null;
  listings: CheckedListingRow[];
  onListings: (next: CheckedListingRow[] | ((prev: CheckedListingRow[]) => CheckedListingRow[])) => void;
  activeListing: string | null;
  onActiveListing: (id: string | null) => void;
  onOpenArea: (code: string) => void;
}) {
  const [scope, setScope] = useState<"area" | "all">("area");
  const [notice, setNotice] = useState<string | null>(null);
  const code = areaRow.card.code;
  const here = listings.filter((l) => l.postcodeArea === code);
  const shown = scope === "area" ? here : listings;
  const live = shown.filter((l) => l.status !== "passed");
  const works = shown.filter((l) => listingVerdict(l).tone === "works");

  const onResolved = (res: ResolvedListing) => {
    const row = rowFromResolved(res);
    if (!row) {
      setNotice("We read that listing but could not save it to your deals. Please try again in a moment.");
      return;
    }
    setNotice(null);
    onListings((prev) => {
      const existing = prev.find((l) => l.canonicalUrl === row.canonicalUrl);
      const merged = existing ? { ...existing, ...row, status: existing.status, notes: existing.notes, shareToken: existing.shareToken, analysedReportId: existing.analysedReportId } : row;
      return [merged, ...prev.filter((l) => l.canonicalUrl !== row.canonicalUrl)];
    });
    if (row.postcodeArea !== code) setScope("all");
    onActiveListing(row.id);
  };
  const search = useListingSearch({ q: "", onQuery: () => {}, onResolved });
  const active = activeListing ? listings.find((l) => l.id === activeListing) ?? null : null;

  return (
    <div className="mx2-tabbody">
      <div className="mx2-section-head">
        <div>
          <h3>Your deals</h3>
          <p>Listings you have checked in {areaRow.card.name}{scope === "all" ? " and everywhere else" : ""}, with the verdict against your goals. Paste a Rightmove, OnTheMarket or Airbnb link to add one.</p>
        </div>
        <div className="mx2-seg" role="group" aria-label="Which deals">
          <button type="button" aria-pressed={scope === "area"} onClick={() => setScope("area")}>This market{here.length ? ` (${here.length})` : ""}</button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All deals{listings.length ? ` (${listings.length})` : ""}</button>
        </div>
      </div>

      <div className="mx2-deals-search">
        <SearchOrPaste search={search} placeholder="Paste a Rightmove, OnTheMarket or Airbnb link to check a listing" />
        {(search.detected || search.error || search.badLink) && <div className="mx-topbar-hint"><SearchHint search={search} /></div>}
        {notice && <div className="mx-note mx-note--error" role="alert">{notice}</div>}
      </div>

      <div className="mx2-kpi-grid">
        <KpiCard size="md" label="In pipeline" value={String(live.length)} sub="active deals" />
        <KpiCard size="md" label="Works" value={String(works.length)} sub="hit your target" colour="var(--mx-sage-deep-2)" />
        <KpiCard size="md" label="Your target" value={goals ? `${goals.finance.targetYieldPct}%` : "—"} sub={goals ? `gross yield${goals.budget ? ` · ${BUDGET_LABELS[goals.budget]}` : ""}` : "set your goals to see a target"} />
      </div>

      <div className="mx2-card mx2-card--table">
        <div className="mx2-card-head"><h4 className="mx2-h4">Checked listings</h4></div>
        <DataTable
          cols={["Listing", "Kind", "Price", "Verdict", "Number", "Status"]}
          rows={shown.map((l) => {
            const v = listingVerdict(l);
            const status = PIPELINE_STATUSES.find((s) => s.key === l.status)!;
            return {
              key: l.id,
              muted: l.status === "passed",
              onClick: () => onActiveListing(l.id),
              cells: [
                <span key="t"><b>{l.title}</b><br /><small className="mx2-muted">{l.displayAddress ?? l.postcode ?? l.postcodeArea ?? ""}</small></span>,
                KIND_LABEL[l.kind],
                formatListingPrice(l.price),
                <VerdictChip key="v" tone={v.tone} label={v.chip} />,
                `${v.number} ${v.numberLabel}`.trim(),
                status.label,
              ],
            };
          })}
          empty={<>{scope === "area" ? `Nothing checked in ${areaRow.card.name} yet.` : "No deals yet."} Paste a listing link above and it appears here with a free verdict.</>}
        />
      </div>

      {active && (
        <div className="mx2-sheet-overlay" onClick={() => onActiveListing(null)}>
          <div className="mx2-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${active.title} deal sheet`}>
            <button type="button" className="mx2-btn mx2-btn--icon mx2-sheet-close" aria-label="Close" onClick={() => onActiveListing(null)}><X size={16} aria-hidden /></button>
            <ListingDrawer
              key={active.id}
              listing={active}
              verdict={listingVerdict(active)}
              areaRow={active.postcodeArea === code ? areaRow : null}
              areaFit={active.postcodeArea === code ? areaRow.personal?.score ?? null : null}
              comparing={false}
              compareDisabled
              onClose={() => onActiveListing(null)}
              onChange={(id, patch) => onListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))}
              onRemoved={(id) => { onListings((prev) => prev.filter((l) => l.id !== id)); onActiveListing(null); }}
              onOpenArea={onOpenArea}
              onToggleCompare={() => {}}
            />
          </div>
        </div>
      )}
    </div>
  );
}
