"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { CompareModal, MAX_COMPARE } from "../../../CompareBar";
import type { ExplorerRow } from "../../types";

/** The sticky bottom bar from the design: "Comparing N of 4", chips, Clear, Compare side by side. */
export function CompareDock({ rows, bedroom, onRemove, onClear }: { rows: ExplorerRow[]; bedroom: number | null; onRemove: (code: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <>
      <div className="mx2-dock" role="region" aria-label="Areas to compare">
        <span className="mx2-dock-title">Comparing {rows.length} of {MAX_COMPARE}</span>
        <div className="mx2-dock-chips">
          {rows.map((r) => (
            <span key={r.card.code} className="mx2-dock-chip">
              {r.card.name} <b>{r.card.score ? r.card.score.score : "—"}</b>
              <button type="button" aria-label={`Remove ${r.card.name}`} onClick={() => onRemove(r.card.code)}><X size={14} aria-hidden /></button>
            </span>
          ))}
        </div>
        <div className="mx2-dock-actions">
          <button type="button" className="mx2-btn mx2-btn--dark" onClick={onClear}>Clear</button>
          <button type="button" className="mx2-btn mx2-btn--primary" disabled={rows.length < 2} onClick={() => setOpen(true)}>Compare side by side</button>
        </div>
      </div>
      {open && <CompareModal rows={rows} bedroom={bedroom} onClose={() => setOpen(false)} />}
    </>
  );
}
