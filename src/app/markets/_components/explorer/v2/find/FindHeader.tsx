"use client";

import type { SortKey } from "@/lib/market/rank";
import type { RegionCardData } from "../../types";
import { ChipMenu } from "../shared/ChipMenu";
import { ShareButton } from "../shared/ShareButton";
import { sortRegions } from "./regionSort";

/** "United Kingdom ▾" (the surviving Regions level), Share, and the phone-width Map | Cards toggle. */
export function FindHeader({ regions, region, sort, onRegion, mobilePane, onMobilePane }: {
  regions: RegionCardData[];
  region: string | null;
  sort: SortKey;
  onRegion: (slug: string | null) => void;
  mobilePane: "cards" | "map";
  onMobilePane: (p: "cards" | "map") => void;
}) {
  const current = region ? regions.find((r) => r.slug === region) : null;
  const ordered = sortRegions(regions, sort);
  return (
    <div className="mx2-find-head">
      <ChipMenu label={<h2 className="mx2-find-title">{current ? current.name : "United Kingdom"}</h2>} ariaLabel="Region" className="mx2-find-region">
        {(close) => (
          <>
            <button type="button" className="mx2-pop-item" aria-current={region === null} onClick={() => { onRegion(null); close(); }}>All of the UK<small>{regions.reduce((n, r) => n + r.areaCodes.length, 0)} areas</small></button>
            {ordered.map((r) => (
              <button key={r.slug} type="button" className="mx2-pop-item" aria-current={region === r.slug} onClick={() => { onRegion(r.slug); close(); }}>
                {r.name}<small>{r.areaCodes.length} area{r.areaCodes.length === 1 ? "" : "s"} · {r.headline.totalSamples} reports</small>
              </button>
            ))}
          </>
        )}
      </ChipMenu>
      <div className="mx2-find-head-actions">
        <div className="mx2-seg mx2-pane-toggle" role="group" aria-label="Map or cards">
          <button type="button" aria-pressed={mobilePane === "cards"} onClick={() => onMobilePane("cards")}>Cards</button>
          <button type="button" aria-pressed={mobilePane === "map"} onClick={() => onMobilePane("map")}>Map</button>
        </div>
        <ShareButton title="Stayful Market Explorer" />
      </div>
    </div>
  );
}
