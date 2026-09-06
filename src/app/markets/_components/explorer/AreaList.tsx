"use client";

import { Star } from "lucide-react";
import { gbpCompact, pct } from "@/lib/market/format";
import { ScoreBadge } from "../ScoreBadge";
import { MAX_COMPARE } from "../CompareBar";
import type { ExplorerRow } from "./types";

function FitPill({ ok, yes, no }: { ok: boolean | null; yes?: string; no: string }) {
  if (ok === null) return null;
  return ok ? (yes ? <span className="mx-fit mx-fit--ok">{yes}</span> : null) : <span className="mx-fit mx-fit--warn">{no}</span>;
}

export function AreaListRow({
  row,
  rank,
  selected,
  hovered,
  comparing,
  compareDisabled,
  bedroom,
  onSelect,
  onHover,
  onToggleCompare,
  onToggleSaved,
}: {
  row: ExplorerRow;
  rank: number;
  selected: boolean;
  hovered: boolean;
  comparing: boolean;
  compareDisabled: boolean;
  bedroom: number | null;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  onToggleCompare: () => void;
  onToggleSaved: () => void;
}) {
  const c = row.card;
  const bed = bedroom != null ? c.byBedrooms.find((b) => b.bedrooms === bedroom) ?? null : null;
  const revenue = bed ? bed.grossRevenue : c.headline.grossRevenue;
  const occ = bed ? bed.occupancy : c.headline.occupancy;
  const yieldPct = bed ? bed.grossYieldPct : c.yieldOnCost?.grossYieldPct ?? null;
  const p = row.personal;

  return (
    <div
      className={"mx-row" + (selected ? " is-selected" : "") + (hovered ? " is-hover" : "")}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className="mx-row-rank">{rank}</span>
      <div className="mx-row-main">
        <div className="mx-row-title">
          <strong>{c.name}</strong>
          <em>{c.code}</em>
          <span className={`mx-conf-dot mx-conf-dot--${c.confidence.tier}`} title={`${c.confidence.label} · ${c.headline.totalSamples} samples`} />
          {c.managedByStayful && <span className="mx-managed" title="Stayful already manages properties here">Stayful manages here</span>}
        </div>
        <div className="mx-row-stats">
          <span><b>{gbpCompact(revenue)}</b> rev</span>
          <span><b>{pct(occ, 0)}</b> occ</span>
          <span><b>{yieldPct !== null ? pct(yieldPct, 1) : "—"}</b> yield</span>
          {c.competition && <span className={`mx-comp mx-comp--${c.competition.label.toLowerCase()}`}>{c.competition.label}</span>}
          {c.directBooking && <span className={`mx-db mx-db--${c.directBooking.label.toLowerCase()}`}>Direct {c.directBooking.label.toLowerCase()}</span>}
        </div>
        {p && (
          <div className="mx-row-fit">
            <FitPill ok={p.fit.inBudget} no="Over budget" />
            <FitPill ok={p.fit.hasBedrooms} no="No data for your bedrooms" />
            <FitPill ok={p.fit.inRange} no={`${p.fit.distanceMiles} mi · beyond range`} yes={p.fit.distanceMiles !== null ? `${p.fit.distanceMiles} mi` : undefined} />
          </div>
        )}
      </div>
      <div className="mx-row-scores">
        {c.score && <ScoreBadge score={c.score} size={44} />}
        {p && (
          <div className="mx-row-personal" title={`Your fit ${p.score}/100 (${p.gradeLabel})`}>
            <b>{p.score}</b>
            <span>fit</span>
          </div>
        )}
      </div>
      <div className="mx-row-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={"mx-iconbtn" + (row.saved ? " on" : "")} aria-pressed={row.saved} aria-label={row.saved ? "Remove from saved" : "Save area"} onClick={onToggleSaved}>
          <Star size={15} fill={row.saved ? "currentColor" : "none"} />
        </button>
        <label className={"mx-iconbtn mx-iconbtn--cmp" + (comparing ? " on" : "")} title={compareDisabled && !comparing ? "Compare up to 4 areas" : "Compare"}>
          <input type="checkbox" checked={comparing} disabled={!comparing && compareDisabled} onChange={onToggleCompare} aria-label={`Compare ${c.name}`} />
          <span>vs</span>
        </label>
      </div>
    </div>
  );
}

export function AreaList(props: {
  rows: ExplorerRow[];
  selected: string | null;
  hover: string | null;
  compare: string[];
  bedroom: number | null;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  onToggleCompare: (code: string) => void;
  onToggleSaved: (code: string) => void;
  emptyMessage: string;
}) {
  const { rows } = props;
  if (rows.length === 0) {
    return <div className="mx-empty mx-empty--list"><h2>No areas match</h2><p>{props.emptyMessage}</p></div>;
  }
  return (
    <div className="mx-list" role="list">
      {rows.map((row, i) => (
        <AreaListRow
          key={row.card.code}
          row={row}
          rank={i + 1}
          selected={props.selected === row.card.code}
          hovered={props.hover === row.card.code}
          comparing={props.compare.includes(row.card.code)}
          compareDisabled={props.compare.length >= MAX_COMPARE}
          bedroom={props.bedroom}
          onSelect={() => props.onSelect(props.selected === row.card.code ? null : row.card.code)}
          onHover={(on) => props.onHover(on ? row.card.code : null)}
          onToggleCompare={() => props.onToggleCompare(row.card.code)}
          onToggleSaved={() => props.onToggleSaved(row.card.code)}
        />
      ))}
    </div>
  );
}
