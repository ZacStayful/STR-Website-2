import type { ReactNode } from "react";

export interface DataRow {
  key: string;
  cells: ReactNode[];
  onClick?: () => void;
  /** Greyed (an early district, a passed deal). */
  muted?: boolean;
  /** Emphasised (the member's own bedroom count). */
  highlight?: boolean;
}

/** The design's `.table`: uppercase headers, tabular numbers, hover rows. Wrap in `overflow-x: auto` when wide. */
export function DataTable({ cols, rows, caption, className = "", empty }: { cols: ReactNode[]; rows: DataRow[]; caption?: string; className?: string; empty?: ReactNode }) {
  if (rows.length === 0 && empty) return <div className="mx2-table-empty">{empty}</div>;
  return (
    <div className={`mx2-table-wrap ${className}`}>
      <table className="mx2-table">
        {caption && <caption className="mx2-sr-only">{caption}</caption>}
        <thead><tr>{cols.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={[r.onClick ? "is-clickable" : "", r.muted ? "is-muted" : "", r.highlight ? "is-hl" : ""].filter(Boolean).join(" ") || undefined}
              onClick={r.onClick}
              tabIndex={r.onClick ? 0 : undefined}
              onKeyDown={r.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.onClick?.(); } } : undefined}
            >
              {r.cells.map((c, i) => <td key={i}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
