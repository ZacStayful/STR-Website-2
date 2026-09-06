"use client";

import { ExternalLink } from "lucide-react";
import { gbpCompact } from "@/lib/market/format";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { PIPELINE_STATUSES, LISTING_SORT_LABELS, dealReturn, listingFit, sortListings, type CheckedListingRow, type ListingSort, type PipelineStatus } from "@/lib/listing/pipeline";
import { MAX_COMPARE } from "../CompareBar";

function priceLabel(p: CheckedListingRow["price"]): string {
  if (!p) return "—";
  return `${gbpCompact(p.amount)}${p.period === "pcm" ? " pcm" : p.period === "pw" ? " pw" : p.period === "night" ? "/night" : ""}`;
}

export function ListingsPane({
  listings,
  statusFilter,
  onStatusFilter,
  sort,
  onSort,
  areaFit,
  compare,
  onToggleCompare,
  onSelect,
  onBack,
}: {
  listings: CheckedListingRow[];
  statusFilter: PipelineStatus | "all";
  onStatusFilter: (s: PipelineStatus | "all") => void;
  sort: ListingSort;
  onSort: (s: ListingSort) => void;
  areaFit: (row: CheckedListingRow) => number | null;
  compare: string[];
  onToggleCompare: (id: string) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const filtered = listings.filter((l) => statusFilter === "all" || l.status === statusFilter);
  const rows = sortListings(filtered, sort, areaFit);
  const counts = PIPELINE_STATUSES.map((s) => ({ ...s, n: listings.filter((l) => l.status === s.key).length }));

  return (
    <div className="mx-listings">
      <div className="mx-listings-head">
        <div>
          <h2>My listings</h2>
          <p>{listings.length} checked · {counts.filter((c) => c.key !== "passed").reduce((s, c) => s + c.n, 0)} live</p>
        </div>
        <button type="button" className="mx-pill mx-pill--sm" onClick={onBack}>← Areas</button>
      </div>
      <div className="mx-listings-filters">
        <button type="button" className="mx-pill mx-pill--sm" aria-pressed={statusFilter === "all"} onClick={() => onStatusFilter("all")}>All</button>
        {counts.map((s) => (
          <button key={s.key} type="button" className="mx-pill mx-pill--sm" aria-pressed={statusFilter === s.key} onClick={() => onStatusFilter(s.key)}>
            <span className="mx-status-dot" style={{ background: s.colour }} /> {s.label}{s.n ? ` (${s.n})` : ""}
          </button>
        ))}
        <select className="mx-select" aria-label="Sort listings" value={sort} onChange={(e) => onSort(e.target.value as ListingSort)}>
          {(Object.keys(LISTING_SORT_LABELS) as ListingSort[]).map((k) => <option key={k} value={k}>{LISTING_SORT_LABELS[k]}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="mx-empty mx-empty--list">
          <h2>No listings here yet</h2>
          <p>Paste a Rightmove, OnTheMarket or Airbnb link above and it will appear in your pipeline with a free quick view.</p>
        </div>
      ) : (
        <div className="mx-list">
          {rows.map((l) => {
            const fit = listingFit(l, areaFit(l));
            const ret = dealReturn(l.deal);
            const est = l.quick?.estimate?.grossRevenue ?? null;
            const status = PIPELINE_STATUSES.find((s) => s.key === l.status)!;
            const comparing = compare.includes(l.id);
            return (
              <div key={l.id} className="mx-row mx-listing-row" role="button" tabIndex={0} onClick={() => onSelect(l.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(l.id))}>
                {l.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.photo} alt="" className="mx-listing-thumb" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="mx-listing-thumb mx-listing-thumb--empty" />
                )}
                <div className="mx-row-main">
                  <div className="mx-row-title">
                    <strong>{l.title}</strong>
                    <span className="mx-status" style={{ background: status.colour }}>{status.label}</span>
                    {l.listingStatus && l.listingStatus !== "available" && <span className="mx-fit mx-fit--warn">{l.listingStatus.replace("_", " ")}</span>}
                  </div>
                  <div className="mx-row-stats">
                    <span><b>{priceLabel(l.price)}</b></span>
                    {l.bedrooms !== null && <span><b>{l.bedrooms}</b> bed</span>}
                    <span><b>{est ? gbpCompact(est) : "—"}</b> est rev</span>
                    {ret !== null && <span><b>{l.deal?.kind === "purchase" ? `${ret}%` : `${ret < 0 ? "−" : ""}${gbpCompact(Math.abs(ret))}/mo`}</b> {l.deal?.kind === "purchase" ? "yield" : "margin"}</span>}
                    {l.postcodeArea && <span>{l.postcodeArea}{l.quick?.area?.score !== null && l.quick?.area?.score !== undefined ? ` · ${l.quick.area.score}` : ""}</span>}
                    <a href={l.canonicalUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="mx-listing-src">{SOURCE_LABELS[l.source]} <ExternalLink size={11} aria-hidden /></a>
                  </div>
                </div>
                <div className="mx-row-scores">
                  {fit !== null && <div className="mx-personal-ring mx-personal-ring--sm" title="Your fit"><b>{fit}</b></div>}
                </div>
                <div className="mx-row-actions">
                  <label className="mx-compare-toggle" onClick={(e) => e.stopPropagation()} title="Compare">
                    <input type="checkbox" checked={comparing} disabled={!comparing && compare.length >= MAX_COMPARE} onChange={() => onToggleCompare(l.id)} aria-label={`Compare ${l.title}`} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
