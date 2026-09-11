"use client";

import { Star } from "lucide-react";
import { FitRing } from "./VerdictBits";
import { areaVerdictFor } from "./verdicts";
import type { ExplorerRow, MarketGoals } from "./types";

/**
 * One area, one line of reasons, one number. Everything else waits for the
 * click: the card carries the verdict, the tiles and the working.
 */
export function AreaListRow({
  row,
  rank,
  selected,
  hovered,
  bedroom,
  goals,
  onSelect,
  onHover,
  onToggleSaved,
}: {
  row: ExplorerRow;
  rank: number;
  selected: boolean;
  hovered: boolean;
  bedroom: number | null;
  goals: MarketGoals | null;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  onToggleSaved: () => void;
}) {
  const c = row.card;
  const v = areaVerdictFor(row, bedroom, goals);
  return (
    <div
      className={"mx-vrow" + (selected ? " is-open" : "") + (hovered ? " is-hover" : "")}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className="mx-vrow-rank">{rank}</span>
      <div className="mx-vrow-main">
        <div className="mx-vrow-title">
          <strong>{c.name}</strong>
          <em>{c.code}</em>
          <span className={`mx-conf-dot mx-conf-dot--${c.confidence.tier}`} title={`${c.confidence.label} · ${c.headline.totalSamples} samples`} />
          {c.managedByStayful && <span className="mx-managed" title="Stayful already manages properties here">Stayful manages here</span>}
        </div>
        <div className="mx-vrow-why">
          {v.reasons.length > 0 ? v.reasons.map((r) => <span key={r}>{r}</span>) : <span>{c.confidence.label} data · {c.headline.totalSamples} reports</span>}
        </div>
      </div>
      <div className="mx-vrow-end">
        <span className="mx-vrow-big">{v.number}</span>
        <span className="mx-vrow-lbl">{v.numberLabel}</span>
      </div>
      {v.fit !== null && <FitRing value={v.fit} />}
      <button
        type="button"
        className={"mx-iconbtn mx-vrow-save" + (row.saved ? " on" : "")}
        aria-pressed={row.saved}
        aria-label={row.saved ? `Remove ${c.name} from saved` : `Save ${c.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSaved();
        }}
      >
        <Star size={14} fill={row.saved ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

export function AreaList(props: {
  rows: ExplorerRow[];
  total: number;
  selected: string | null;
  hover: string | null;
  bedroom: number | null;
  goals: MarketGoals | null;
  sortLabel: string;
  onSelect: (code: string | null) => void;
  onHover: (code: string | null) => void;
  onToggleSaved: (code: string) => void;
  emptyMessage: string;
}) {
  const { rows } = props;
  return (
    <div className="mx-listings">
      <div className="mx-pane-head">
        <div>
          <h2>{props.goals ? "Areas ranked for you" : "Areas ranked"}</h2>
          <p>{rows.length} of {props.total} areas{rows.length !== props.total ? " match your filters" : ""} · by {props.sortLabel.toLowerCase()}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="mx-empty mx-empty--list"><h2>No areas match</h2><p>{props.emptyMessage}</p></div>
      ) : (
        <div className="mx-list" role="list">
          {rows.map((row, i) => (
            <AreaListRow
              key={row.card.code}
              row={row}
              rank={i + 1}
              selected={props.selected === row.card.code}
              hovered={props.hover === row.card.code}
              bedroom={props.bedroom}
              goals={props.goals}
              onSelect={() => props.onSelect(props.selected === row.card.code ? null : row.card.code)}
              onHover={(on) => props.onHover(on ? row.card.code : null)}
              onToggleSaved={() => props.onToggleSaved(row.card.code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
