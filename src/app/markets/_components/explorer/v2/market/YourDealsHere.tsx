"use client";

import { ChevronRight } from "lucide-react";
import { PIPELINE_STATUSES, type CheckedListingRow } from "@/lib/listing/pipeline";
import { listingVerdict } from "../../verdicts";
import { ListingThumb, listingMeta } from "../../ListingsPane";
import { VerdictChip } from "../../VerdictBits";

/** The member's own checked listings in this area, in place of the design's "top-performing listings" (which the data does not have). */
export function YourDealsHere({ listings, areaName, onOpen, onViewAll, max = 4 }: { listings: CheckedListingRow[]; areaName: string; onOpen: (id: string) => void; onViewAll: () => void; max?: number }) {
  const live = listings.filter((l) => l.status !== "passed");
  return (
    <section className="mx2-section">
      <div className="mx2-section-head">
        <div>
          <h3>Your deals in {areaName}</h3>
          <p>Listings you have checked here, with the verdict against your goals. Paste a Rightmove, OnTheMarket or Airbnb link on the Your deals tab to add one.</p>
        </div>
        {listings.length > 0 && <button type="button" className="mx2-btn mx2-btn--ghost" onClick={onViewAll}>View all <ChevronRight size={14} aria-hidden /></button>}
      </div>
      {live.length === 0 ? (
        <p className="mx2-note">Nothing checked in {areaName} yet.</p>
      ) : (
        <div className="mx2-deal-grid">
          {live.slice(0, max).map((l) => {
            const v = listingVerdict(l);
            const status = PIPELINE_STATUSES.find((s) => s.key === l.status)!;
            return (
              <button type="button" key={l.id} className="mx2-card mx2-deal-card is-clickable" onClick={() => onOpen(l.id)}>
                <div className="mx2-deal-top"><ListingThumb listing={l} /><VerdictChip tone={v.tone} label={v.chip} /></div>
                <div className="mx2-deal-title">{l.title}</div>
                <div className="mx2-deal-meta">{listingMeta(l)}</div>
                <div className="mx2-deal-foot"><b>{v.number}</b><span>{v.numberLabel}</span><span className="mx2-deal-status">{status.label}</span></div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
