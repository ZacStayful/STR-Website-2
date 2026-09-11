"use client";

import { SOURCE_LABELS } from "@/lib/listing/detect";
import { formatListingPrice } from "@/lib/listing/format";
import { PIPELINE_STATUSES, LISTING_SORT_LABELS, sortListings, type CheckedListingRow, type ListingSort, type PipelineStatus } from "@/lib/listing/pipeline";
import type { Verdict } from "@/lib/listing/verdict";
import { VerdictChip } from "./VerdictBits";

export function ListingThumb({ listing, large = false }: { listing: CheckedListingRow; large?: boolean }) {
  return (
    <span className={"mx-thumb" + (large ? " mx-thumb--lg" : "") + (listing.photo ? "" : " mx-thumb--empty")}>
      {listing.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={listing.photo} alt="" loading="lazy" referrerPolicy="no-referrer" />
      )}
      <span className="mx-thumb-src">{SOURCE_LABELS[listing.source]}</span>
    </span>
  );
}

export function listingMeta(l: CheckedListingRow): string {
  const parts: string[] = [];
  if (l.price) parts.push(formatListingPrice(l.price));
  if (l.bedrooms !== null) parts.push(`${l.bedrooms} bed`);
  if (l.quick?.tracked) parts.push(`${l.quick.tracked.guests} guests`);
  const where = l.displayAddress ?? (l.postcode ? l.postcode : l.postcodeArea);
  if (where) parts.push(where);
  if (l.quick?.tracked && l.quick.tracked.rating) parts.push(`★ ${l.quick.tracked.rating.toFixed(2)} (${l.quick.tracked.reviewCount})`);
  return parts.join(" · ");
}

/** The member's deals: verdict chip, status, and the one number that matters. */
export function ListingsPane({
  listings,
  verdicts,
  statusFilter,
  onStatusFilter,
  sort,
  onSort,
  areaFit,
  onSelect,
}: {
  listings: CheckedListingRow[];
  verdicts: Map<string, Verdict>;
  statusFilter: PipelineStatus | "all";
  onStatusFilter: (s: PipelineStatus | "all") => void;
  sort: ListingSort;
  onSort: (s: ListingSort) => void;
  areaFit: (row: CheckedListingRow) => number | null;
  onSelect: (id: string) => void;
}) {
  const filtered = listings.filter((l) => statusFilter === "all" || l.status === statusFilter);
  const rows = sortListings(filtered, sort, areaFit);
  const counts = PIPELINE_STATUSES.map((s) => ({ ...s, n: listings.filter((l) => l.status === s.key).length }));
  const live = listings.filter((l) => l.status !== "passed");
  const tally = { works: 0, tight: 0, no: 0 };
  for (const l of live) {
    const t = verdicts.get(l.id)?.tone;
    if (t === "works" || t === "tight" || t === "no") tally[t] += 1;
  }
  const summary = [listings.length ? `${listings.length} checked` : null, tally.works ? `${tally.works} work` : null, tally.tight ? `${tally.tight} tight` : null, tally.no ? `${tally.no} ${tally.no === 1 ? "doesn’t" : "don’t"}` : null].filter(Boolean).join(" · ");

  return (
    <div className="mx-listings">
      <div className="mx-pane-head">
        <div>
          <h2>My deals</h2>
          <p>{summary || "Nothing checked yet"}</p>
        </div>
        <select className="mx-select mx-select--mini" aria-label="Sort deals" value={sort} onChange={(e) => onSort(e.target.value as ListingSort)}>
          {(Object.keys(LISTING_SORT_LABELS) as ListingSort[]).map((k) => <option key={k} value={k}>{LISTING_SORT_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="mx-tabs" role="group" aria-label="Pipeline status">
        <button type="button" aria-pressed={statusFilter === "all"} onClick={() => onStatusFilter("all")}>All</button>
        {counts.map((s) => (
          <button key={s.key} type="button" aria-pressed={statusFilter === s.key} onClick={() => onStatusFilter(s.key)}>
            <span className="mx-status-dot" style={{ background: s.colour }} /> {s.label}{s.n ? ` ${s.n}` : ""}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="mx-empty mx-empty--list">
          <h2>{listings.length === 0 ? "No deals yet" : "Nothing with this status"}</h2>
          <p>{listings.length === 0 ? "Paste a Rightmove, OnTheMarket or Airbnb link in the box above and it appears here with a free verdict." : "Change the status filter to see the rest."}</p>
        </div>
      ) : (
        <div className="mx-list">
          {rows.map((l) => {
            const v = verdicts.get(l.id);
            const status = PIPELINE_STATUSES.find((s) => s.key === l.status)!;
            return (
              <div
                key={l.id}
                className="mx-vrow mx-vrow--deal"
                role="button"
                tabIndex={0}
                onClick={() => onSelect(l.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(l.id);
                  }
                }}
              >
                <ListingThumb listing={l} />
                <div className="mx-vrow-main">
                  <div className="mx-vrow-title"><strong className="mx-vrow-t">{l.title}</strong></div>
                  <div className="mx-vrow-m">{listingMeta(l)}</div>
                  <div className="mx-vrow-why">
                    {v && <VerdictChip tone={v.tone} label={v.chip} />}
                    <span>{status.label}</span>
                    {l.listingStatus && l.listingStatus !== "available" && <span className="mx-fit mx-fit--warn">{l.listingStatus.replace("_", " ")}</span>}
                  </div>
                </div>
                <div className="mx-vrow-end">
                  <span className="mx-vrow-big">{v?.number ?? "—"}</span>
                  <span className="mx-vrow-lbl">{v?.numberLabel ?? ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
