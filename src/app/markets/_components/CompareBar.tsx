"use client";

import { useState } from "react";
import Link from "next/link";
import type { ExplorerRow } from "@/lib/market/rank";
import { gbp, pct } from "@/lib/market/format";
import { activeAreaStats } from "./areaStats";
import { LicensingBadge } from "./LicensingBadge";
import { VerdictLabel } from "./VerdictLabel";
import { ConfidenceBadge } from "./ConfidenceBadge";

export const MAX_COMPARE = 4;

// Numeric rows where a higher value is "better" (highlighted as the winner).
function bestIndex(values: (number | null)[]): number {
  let best = -1;
  let bestVal = -Infinity;
  values.forEach((v, i) => {
    if (v !== null && v > bestVal) {
      bestVal = v;
      best = i;
    }
  });
  return best;
}

export function CompareBar({
  rows,
  bedroom,
  onRemove,
  onClear,
}: {
  rows: ExplorerRow[];
  bedroom: number | null;
  onRemove: (code: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  const cards = rows.map((r) => r.card);
  const hasPersonal = rows.some((r) => r.personal);
  const stats = cards.map((c) => activeAreaStats(c, bedroom));
  const scoreBest = bestIndex(cards.map((c) => c.score?.score ?? null));
  const personalBest = bestIndex(rows.map((r) => r.personal?.score ?? null));
  const compBest = bestIndex(cards.map((c) => (c.competition ? 100 - c.competition.percentile : null)));
  const dbBest = bestIndex(cards.map((c) => c.directBooking?.score ?? null));
  const revBest = bestIndex(stats.map((s) => s.revenue));
  const adrBest = bestIndex(stats.map((s) => s.adr));
  const occBest = bestIndex(stats.map((s) => s.occupancy));
  const yieldBest = bestIndex(stats.map((s) => s.yieldPct));

  const cell = (best: boolean) => (best ? "mx-cmp-best" : undefined);

  return (
    <>
      <div className="mx-cmp-tray" role="region" aria-label="Areas to compare">
        <div className="mx-cmp-tray-chips">
          {cards.map((c) => (
            <span key={c.code} className="mx-cmp-chip">
              {c.name}
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => onRemove(c.code)}>×</button>
            </span>
          ))}
        </div>
        <div className="mx-cmp-tray-actions">
          <button type="button" className="mx-pill" onClick={onClear}>Clear</button>
          <button
            type="button"
            className="mx-cta mx-cta--sm"
            disabled={cards.length < 2}
            onClick={() => setOpen(true)}
          >
            Compare {cards.length} area{cards.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mx-cmp-overlay" role="dialog" aria-modal="true" aria-label="Area comparison" onClick={() => setOpen(false)}>
          <div className="mx-cmp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mx-cmp-modal-head">
              <h2>Compare areas{bedroom != null ? ` · ${bedroom}-bed` : ""}</h2>
              <button type="button" className="mx-cmp-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="mx-cmp-scroll">
              <table className="mx-cmp-table">
                <thead>
                  <tr>
                    <th className="mx-cmp-rowlabel" />
                    {cards.map((c) => (
                      <th key={c.code}>
                        <Link href={`/markets/${c.slug}`}>{c.name}</Link>
                        <span className="mx-cmp-code">{c.code}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="mx-cmp-rowlabel" title="Stayful transparent 0–100 investment score">Stayful score</th>
                    {cards.map((c, i) => (
                      <td key={c.code} className={cell(i === scoreBest)}>
                        {c.score ? `${c.score.score} · ${c.score.grade}` : "—"}
                      </td>
                    ))}
                  </tr>
                  {hasPersonal && (
                    <tr>
                      <th className="mx-cmp-rowlabel" title="The Stayful score re-weighted by your goals">Your fit</th>
                      {rows.map((r, i) => (
                        <td key={r.card.code} className={cell(i === personalBest)}>{r.personal ? `${r.personal.score} · ${r.personal.grade}` : "—"}</td>
                      ))}
                    </tr>
                  )}
                  <tr>
                    <th className="mx-cmp-rowlabel">Avg revenue / yr</th>
                    {stats.map((s, i) => (<td key={cards[i].code} className={cell(i === revBest)}>{gbp(s.revenue)}</td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel">ADR</th>
                    {stats.map((s, i) => (<td key={cards[i].code} className={cell(i === adrBest)}>{gbp(s.adr)}</td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel">Occupancy</th>
                    {stats.map((s, i) => (<td key={cards[i].code} className={cell(i === occBest)}>{pct(s.occupancy, 0)}</td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel" title="Gross annual revenue ÷ property value">Yield-on-cost</th>
                    {stats.map((s, i) => (<td key={cards[i].code} className={cell(i === yieldBest)}>{s.yieldPct !== null ? pct(s.yieldPct, 1) : "—"}</td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel" title="Relative to every other UK area: listing density, review depth, listing age">Competition</th>
                    {cards.map((c, i) => (
                      <td key={c.code} className={cell(i === compBest)}>{c.competition ? `${c.competition.label} · ${c.competition.percentile}th` : "—"}</td>
                    ))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel" title="Contractors, hospitals, universities, events, transport">Direct-booking potential</th>
                    {cards.map((c, i) => (
                      <td key={c.code} className={cell(i === dbBest)}>{c.directBooking ? `${c.directBooking.score} · ${c.directBooking.label}` : "—"}</td>
                    ))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel">Short vs long-let</th>
                    {cards.map((c) => (<td key={c.code}><VerdictLabel verdict={c.verdict} compact /></td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel">Licensing</th>
                    {cards.map((c) => (<td key={c.code}><LicensingBadge status={c.licensing.status} label={c.licensing.headline} /></td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel">Data confidence</th>
                    {stats.map((s, i) => (<td key={cards[i].code}><ConfidenceBadge confidence={s.confidence} samples={s.samples} /></td>))}
                  </tr>
                  <tr>
                    <th className="mx-cmp-rowlabel" />
                    {cards.map((c) => (
                      <td key={c.code}><Link href={`/markets/${c.slug}`} className="mx-cta mx-cta--sm">Full report →</Link></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mx-cmp-note">Best value in each row is highlighted. Figures are indicative averages{bedroom != null ? ` for ${bedroom}-bed properties` : ""}.</p>
          </div>
        </div>
      )}
    </>
  );
}
