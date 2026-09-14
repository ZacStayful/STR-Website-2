"use client";

import { Heart } from "lucide-react";
import { gbp, gbpCompact, pct } from "@/lib/market/format";
import { marketSubtitle, marketTitle } from "@/lib/market/labels";
import { activeAreaStats } from "../../../areaStats";
import type { ExplorerRow } from "../../types";
import { ScoreRing } from "../shared/ScoreRing";
import { Tag, type TagTone } from "../shared/Tag";

const TIER_TONE: Record<string, TagTone> = { confirmed: "accent", building: "amber", early: "neutral" };
const LIC_TONE: Record<string, TagTone> = { "confirmed-unrestricted": "accent", "confirmed-licensed": "amber", unconfirmed: "neutral" };

/** One market from the design's card grid: ring, name, three KPIs, tags, fit and a compare tick. */
export function MarketCard({
  row,
  bedroom,
  hovered,
  comparing,
  compareDisabled,
  hasGoals,
  onHover,
  onOpen,
  onToggleSaved,
  onToggleCompare,
  onSetGoals,
}: {
  row: ExplorerRow;
  bedroom: number | null;
  hovered: boolean;
  comparing: boolean;
  compareDisabled: boolean;
  hasGoals: boolean;
  onHover: (on: boolean) => void;
  onOpen: () => void;
  onToggleSaved: () => void;
  onToggleCompare: () => void;
  onSetGoals: () => void;
}) {
  const c = row.card;
  const s = activeAreaStats(c, bedroom);
  return (
    <article
      className={"mx2-card mx2-mcard" + (hovered ? " is-hover" : "") + (comparing ? " is-comparing" : "")}
      role="button"
      tabIndex={0}
      aria-label={`${c.name}: open market overview`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="mx2-mcard-head">
        <ScoreRing value={c.score?.score ?? null} size={48} label={c.score ? `Market score ${c.score.score} out of 100` : "Market score not yet available"} />
        <div className="mx2-mcard-title">
          <div className="mx2-mcard-name">{marketTitle(c)}</div>
          <div className="mx2-mcard-sub">{marketSubtitle(c)}{c.managedByStayful && <> · <span className="mx-managed">Stayful manages here</span></>}</div>
        </div>
        <button
          type="button"
          className={"mx2-mcard-heart" + (row.saved ? " is-on" : "")}
          aria-pressed={row.saved}
          aria-label={row.saved ? `Remove ${c.name} from saved` : `Save ${c.name}`}
          onClick={(e) => { e.stopPropagation(); onToggleSaved(); }}
        >
          <Heart size={18} aria-hidden fill={row.saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="mx2-mcard-kpis">
        <div><b>{gbpCompact(s.revenue)}</b><span>Revenue potential</span></div>
        <div><b>{pct(s.occupancy, 0)}</b><span>Occupancy</span></div>
        <div><b>{gbp(s.adr)}</b><span>Daily rate</span></div>
      </div>
      <div className="mx2-mcard-foot">
        <Tag tone={TIER_TONE[s.confidence.tier]} title={`${s.samples} analyser report${s.samples === 1 ? "" : "s"}${s.bedroom ? ` for ${s.bedroom}-bed` : ""}`}>{s.confidence.label}</Tag>
        <Tag tone={LIC_TONE[c.licensing.status]} title={c.licensing.regionLabel}>{c.licensing.headline}</Tag>
        <span className="mx2-mcard-fit">
          {row.personal ? <>Fit <b>{row.personal.score}</b></> : hasGoals ? <>Fit <b>—</b></> : <button type="button" className="mx2-link" onClick={(e) => { e.stopPropagation(); onSetGoals(); }}>Set goals</button>}
        </span>
        <label className="mx2-mcard-compare" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={comparing} disabled={!comparing && compareDisabled} onChange={onToggleCompare} onClick={(e) => e.stopPropagation()} />
          Compare
        </label>
      </div>
    </article>
  );
}
