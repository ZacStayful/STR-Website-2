"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AreaDealsSummary } from "@/lib/marketplace/grid";
import { gbpCompact } from "@/lib/market/format";
import { KpiCard } from "../shared/KpiCard";

/**
 * The marketplace's live deals in this area: what is on the market right now
 * that clears the income bar, with the best few as cards. Everything shown is
 * free to see; the card opens the deal on /deals, where the sheet is unlocked.
 */
export function MarketDealsHere({ summary, areaCode, areaName, max = 3 }: { summary: AreaDealsSummary | null; areaCode: string; areaName: string; max?: number }) {
  const allHref = `/deals?areas=${encodeURIComponent(areaCode)}`;
  const total = summary?.total ?? 0;
  return (
    <section className="mx2-section" aria-labelledby="mx2-market-deals-h">
      <div className="mx2-section-head">
        <div>
          <h3 id="mx2-market-deals-h">Deals on the market in {areaName}</h3>
          <p>Listings for sale and to rent right now that earn clearly more as a short let than a long let, screened by Stayful. Open one for the address, photos and listing.</p>
        </div>
        {total > 0 && (
          <Link href={allHref} className="mx2-btn mx2-btn--ghost">See all {total} <ChevronRight size={14} aria-hidden /></Link>
        )}
      </div>

      {summary === null || total === 0 ? (
        <p className="mx2-note">
          {summary === null
            ? "The deals marketplace is not switched on yet."
            : `Nothing on the market in ${areaName} has cleared the income bar yet. The marketplace sweeps every morning, so check back tomorrow.`}{" "}
          <Link href="/deals" className="mx2-link">Browse every area</Link>
        </p>
      ) : (
        <>
          <div className="mx2-kpi-grid">
            <KpiCard size="md" label="To buy" value={String(summary.sale)} sub="qualifying, on the market now" />
            <KpiCard size="md" label="Rent-to-rent" value={String(summary.rent)} sub="qualifying, on the market now" />
            <KpiCard size="md" label="Median annual profit" value={summary.medianProfit === null ? "—" : gbpCompact(summary.medianProfit)} sub="across the deals here" colour="var(--mx-sage-deep-2)" />
          </div>
          <div className="mx2-deal-grid">
            {summary.top.slice(0, max).map((d) => (
              <Link key={d.id} href={`/deals/${d.id}`} className="mx2-card mx2-deal-card mx2-mdeal is-clickable">
                <span className={"mx2-mdeal-thumb" + (d.photoUrl ? "" : " is-empty")}>
                  {d.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.photoUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="mx2-mdeal-thumb-note">{d.source === "zoopla" ? "Photo on the listing" : "Photo coming"}</span>
                  )}
                  <span className="mx2-mdeal-kind">{d.kind === "rent" ? "Rent-to-rent" : "To buy"}</span>
                </span>
                <div className="mx2-deal-top">
                  <span className="mx2-deal-title">{d.figureBig}</span>
                  {d.price && <b className="mx2-mdeal-price">{d.price}</b>}
                </div>
                <div className="mx2-deal-meta">{d.figureSmall}</div>
                <div className="mx2-deal-meta"><b>{d.where || areaName}</b>{d.type ? ` · ${d.type}` : ""}</div>
                <div className="mx2-deal-foot">
                  <span className={d.freshnessKind === "live" ? "mx2-mdeal-live" : undefined}>{d.freshness}</span>
                  {d.tags.map((t) => <span key={t} className="mx2-tag mx2-tag--accent">{t}</span>)}
                  <span className="mx2-deal-status">Open the sheet →</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
