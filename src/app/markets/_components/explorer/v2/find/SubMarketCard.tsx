"use client";

import { MIN_DISTRICT_SAMPLES } from "@/lib/market/confidence";
import type { AreaCardData, DistrictCardData } from "@/lib/market/explorer";
import { gbp, gbpCompact, pct } from "@/lib/market/format";
import { Tag, type TagTone } from "../shared/Tag";

const TIER_TONE: Record<string, TagTone> = { confirmed: "accent", building: "amber", early: "neutral" };

/** One postcode district at the sub-market level. Districts carry no score, so the ring slot shows the code. */
export function SubMarketCard({ area, d, hovered, onHover, onOpen }: { area: AreaCardData; d: DistrictCardData; hovered: boolean; onHover: (on: boolean) => void; onOpen: () => void }) {
  const missing = MIN_DISTRICT_SAMPLES - d.headline.totalSamples;
  return (
    <article
      className={"mx2-card mx2-mcard mx2-mcard--district" + (hovered ? " is-hover" : "") + (d.ready ? "" : " is-early")}
      role="button"
      tabIndex={0}
      aria-label={`${area.name} ${d.code}: open sub-market`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="mx2-mcard-head">
        <div className="mx2-mcard-code" aria-hidden="true">{d.code}</div>
        <div className="mx2-mcard-title">
          <div className="mx2-mcard-name">{area.name} {d.code}</div>
          <div className="mx2-mcard-sub">{d.code} postcode district · {area.region.name}</div>
        </div>
      </div>
      {d.ready ? (
        <>
          <div className="mx2-mcard-kpis">
            <div><b>{gbpCompact(d.headline.grossRevenue)}</b><span>Revenue potential</span></div>
            <div><b>{pct(d.headline.occupancy, 0)}</b><span>Occupancy</span></div>
            <div><b>{gbp(d.headline.adr)}</b><span>Daily rate</span></div>
          </div>
          <div className="mx2-mcard-foot">
            <Tag tone={TIER_TONE[d.confidence.tier]} title={`${d.headline.totalSamples} analyser reports`}>{d.confidence.label}</Tag>
            {d.competition && <Tag tone="neutral">{d.competition.label}</Tag>}
            {d.seasonality && <Tag tone="neutral">{d.seasonality.label}</Tag>}
          </div>
        </>
      ) : (
        <div className="mx2-mcard-early">
          <b>Early — {d.headline.totalSamples} of {MIN_DISTRICT_SAMPLES} reports</b>
          <span>{missing} more analyser report{missing === 1 ? "" : "s"} before its own figures show. Until then, {area.name} as a whole is the guide.</span>
        </div>
      )}
    </article>
  );
}
