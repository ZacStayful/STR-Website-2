"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Download, Heart } from "lucide-react";
import { MIN_DISTRICT_SAMPLES } from "@/lib/market/confidence";
import type { AreaCardData } from "@/lib/market/explorer";
import type { PersonalScore } from "@/lib/market/personalise";
import { AreaMiniMap } from "../shared/AreaMiniMap";
import { ChipMenu } from "../shared/ChipMenu";
import { ShareButton } from "../shared/ShareButton";
import { Tag } from "../shared/Tag";

export function MarketHeader({
  area,
  district,
  bedroom,
  personal,
  hasGoals,
  saved,
  comparing,
  compareFull,
  backHref,
  dataCodes,
  onDistrict,
  onBedroom,
  onToggleSaved,
  onToggleCompare,
  onSetGoals,
}: {
  area: AreaCardData;
  district: string | null;
  bedroom: number | null;
  personal: PersonalScore | null;
  hasGoals: boolean;
  saved: boolean;
  comparing: boolean;
  compareFull: boolean;
  backHref: string;
  dataCodes: ReadonlySet<string>;
  onDistrict: (code: string | null) => void;
  onBedroom: (b: number | null) => void;
  onToggleSaved: () => void;
  onToggleCompare: () => void;
  onSetGoals: () => void;
}) {
  const beds = area.headline.bedroomsAvailable.filter((b) => b <= 3);
  return (
    <header className="mx2-market-head">
      <div className="mx2-market-row">
        <Link href={backHref} className="mx2-btn mx2-btn--icon mx2-btn--secondary" aria-label="Back to markets"><ArrowLeft size={16} aria-hidden /></Link>
        <div className="mx2-market-thumb"><AreaMiniMap code={area.code} dataCodes={dataCodes} /></div>
        <div className="mx2-crumbs">
          <span className="mx2-crumb-eyebrow">Market overview</span>
          <h2>{area.name}</h2>
          <ChevronRight size={16} aria-hidden />
          {area.districts.length > 0 ? (
            <ChipMenu label={district ?? "All sub-markets"} ariaLabel="Sub-market" className="mx2-crumb-menu">
              {(close) => (
                <>
                  <button type="button" className="mx2-pop-item" aria-current={district === null} onClick={() => { onDistrict(null); close(); }}>All sub-markets<small>{area.code} area</small></button>
                  {area.districts.map((d) => (
                    <button key={d.code} type="button" className="mx2-pop-item" aria-current={district === d.code} onClick={() => { onDistrict(d.code); close(); }}>
                      {d.code}
                      <small>{d.ready ? `${d.headline.totalSamples} reports` : `early · ${d.headline.totalSamples} of ${MIN_DISTRICT_SAMPLES}`}</small>
                    </button>
                  ))}
                </>
              )}
            </ChipMenu>
          ) : (
            <span className="mx2-crumb-static">All sub-markets</span>
          )}
        </div>
        <div className="mx2-market-actions">
          <ShareButton title={`${area.name} short-term rental market — Stayful`} />
          <button type="button" className={"mx2-btn mx2-btn--secondary" + (saved ? " is-saved" : "")} aria-pressed={saved} onClick={onToggleSaved}>
            <Heart size={14} aria-hidden fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
          </button>
          <button type="button" className={"mx2-btn mx2-btn--secondary" + (comparing ? " is-on" : "")} aria-pressed={comparing} disabled={!comparing && compareFull} onClick={onToggleCompare}>
            {comparing ? "✓ Comparing" : "Compare"}
          </button>
          <a className="mx2-btn mx2-btn--ghost" href={`/api/market-pdf?area=${encodeURIComponent(area.code)}`} target="_blank" rel="noopener"><Download size={14} aria-hidden /> PDF</a>
        </div>
      </div>

      <div className="mx2-market-chips">
        <ChipMenu label={bedroom ? `${bedroom} bed` : "Bedrooms"} active={bedroom !== null} ariaLabel="Bedrooms">
          {(close) => (
            <>
              <button type="button" className="mx2-pop-item" aria-current={bedroom === null} onClick={() => { onBedroom(null); close(); }}>All sizes<small>area blend</small></button>
              {beds.map((b) => (
                <button key={b} type="button" className="mx2-pop-item" aria-current={bedroom === b} onClick={() => { onBedroom(b); close(); }}>{b} bed</button>
              ))}
              {beds.length === 0 && <span className="mx2-pop-item" aria-disabled="true">No bedroom split yet</span>}
            </>
          )}
        </ChipMenu>
        {personal ? (
          <Tag tone="accent" className="mx2-fit-tag">Fit for your goals: {personal.score} / 100 · {personal.gradeLabel}</Tag>
        ) : hasGoals ? (
          <Tag tone="neutral" className="mx2-fit-tag">Fit for your goals: —</Tag>
        ) : (
          <button type="button" className="mx2-btn mx2-btn--secondary mx2-chip is-dashed mx2-fit-tag" onClick={onSetGoals}>Set goals to see your fit</button>
        )}
      </div>
    </header>
  );
}
