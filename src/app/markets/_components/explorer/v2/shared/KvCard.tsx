import type { ReactNode } from "react";

/** The design's key/value card: a heading, a two-column list, a note. */
export function KvCard({ title, rows, note, className = "" }: { title?: ReactNode; rows: { k: ReactNode; v: ReactNode }[]; note?: ReactNode; className?: string }) {
  return (
    <div className={`mx2-card mx2-kv ${className}`}>
      {title && <h4 className="mx2-h4">{title}</h4>}
      <dl className="mx2-kv-list">
        {rows.map((r, i) => (
          <div key={i} className="mx2-kv-row"><dt>{r.k}</dt><dd>{r.v}</dd></div>
        ))}
      </dl>
      {note && <p className="mx2-note">{note}</p>}
    </div>
  );
}
