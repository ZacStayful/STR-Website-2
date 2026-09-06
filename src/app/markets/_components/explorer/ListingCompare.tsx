"use client";

import { useState } from "react";
import { gbp } from "@/lib/market/format";
import { dealReturn, listingFit, type CheckedListingRow } from "@/lib/listing/pipeline";
import type { ExplorerRow } from "./types";
import { bestIndex } from "../CompareBar";
import { formatListingPrice } from "@/lib/listing/format";

/** Side-by-side table for 2–4 checked listings, docked like the area compare tray. */
export function ListingCompare({ rows, areaOf, onRemove, onClear }: { rows: CheckedListingRow[]; areaOf: (row: CheckedListingRow) => ExplorerRow | null; onRemove: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const areas = rows.map(areaOf);
  const fitBest = bestIndex(rows.map((r, i) => listingFit(r, areas[i]?.personal?.score ?? null)));
  const retBest = bestIndex(rows.map((r) => dealReturn(r.deal)));
  const estBest = bestIndex(rows.map((r) => r.quick?.estimate?.grossRevenue ?? null));
  const scoreBest = bestIndex(areas.map((a) => a?.card.score?.score ?? null));
  const priceBest = bestIndex(rows.map((r) => (r.price ? -r.price.amount : null)));
  const cell = (best: boolean) => (best ? "mx-cmp-best" : undefined);
  const priceText = (r: CheckedListingRow) => formatListingPrice(r.price);

  return (
    <>
      <div className="mx-cmp-tray" role="region" aria-label="Listings to compare">
        <div className="mx-cmp-tray-chips">
          {rows.map((r) => (
            <span key={r.id} className="mx-cmp-chip">
              <span className="mx-cmp-code">{r.postcodeArea ?? "?"}</span> {r.title.slice(0, 28)}
              <button type="button" className="mx-cmp-close" aria-label={`Remove ${r.title}`} onClick={() => onRemove(r.id)}>×</button>
            </span>
          ))}
        </div>
        <div className="mx-cmp-tray-actions">
          <button type="button" className="mx-pill mx-pill--sm" onClick={onClear}>Clear</button>
          <button type="button" className="mx-cta mx-cta--sm" disabled={rows.length < 2} onClick={() => setOpen(true)}>Compare listings ({rows.length})</button>
        </div>
      </div>
      {open && (
        <div className="mx-cmp-overlay" role="dialog" aria-modal="true" aria-label="Compare listings" onClick={() => setOpen(false)}>
          <div className="mx-cmp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mx-cmp-modal-head">
              <h2>Compare listings</h2>
              <button type="button" className="mx-cmp-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="mx-cmp-scroll">
              <table className="mx-cmp-table">
                <thead>
                  <tr>
                    <th />
                    {rows.map((r) => <th key={r.id}><a href={r.canonicalUrl} target="_blank" rel="noopener noreferrer">{r.title.slice(0, 40)}</a><br /><small>{r.displayAddress ?? r.postcode ?? ""}</small></th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="mx-cmp-rowlabel">Price</td>{rows.map((r, i) => <td key={r.id} className={cell(i === priceBest)}>{priceText(r)}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Bedrooms</td>{rows.map((r) => <td key={r.id}>{r.bedrooms ?? "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Est. revenue / yr</td>{rows.map((r, i) => <td key={r.id} className={cell(i === estBest)}>{r.quick?.estimate ? gbp(r.quick.estimate.grossRevenue) : "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Yield or margin</td>{rows.map((r, i) => { const v = dealReturn(r.deal); return <td key={r.id} className={cell(i === retBest)}>{v === null ? "—" : r.deal?.kind === "purchase" ? `${v}% yield` : `${v < 0 ? "−" : ""}${gbp(Math.abs(v))} / mo`}</td>; })}</tr>
                  <tr><td className="mx-cmp-rowlabel">Your fit</td>{rows.map((r, i) => { const f = listingFit(r, areas[i]?.personal?.score ?? null); return <td key={r.id} className={cell(i === fitBest)}>{f ?? "—"}</td>; })}</tr>
                  <tr><td className="mx-cmp-rowlabel">Area score</td>{areas.map((a, i) => <td key={rows[i].id} className={cell(i === scoreBest)}>{a?.card.score ? `${a.card.score.score} · ${a.card.score.grade}` : "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Competition</td>{areas.map((a, i) => <td key={rows[i].id}>{a?.card.competition?.label ?? "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Direct booking</td>{areas.map((a, i) => <td key={rows[i].id}>{a?.card.directBooking?.label ?? "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">From home</td>{areas.map((a, i) => <td key={rows[i].id}>{a?.personal?.fit.distanceMiles != null ? `${a.personal.fit.distanceMiles} mi` : "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Licensing</td>{areas.map((a, i) => <td key={rows[i].id}>{a?.card.licensing.headline ?? "—"}</td>)}</tr>
                  <tr><td className="mx-cmp-rowlabel">Status</td>{rows.map((r) => <td key={r.id}>{r.status}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="mx-cmp-note">Best value per row highlighted. Estimates come from the free quick view; run the full analysis for live comparables.</p>
          </div>
        </div>
      )}
    </>
  );
}
