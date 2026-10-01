'use client';

import { Scale } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';
import { gbp, pct0 } from './format';
import { comparableRows, monthRows } from '@/lib/analysis/second-opinion';

/**
 * Property Market Intel's projection beside ours, with the gap in plain terms.
 * Batch 21 (C10): `oursLabel` names whose estimate the first figure is; on a
 * white-label funnel that is the customer, never Stayful.
 */
export function SecondOpinionCard({ ours, opinion, oursLabel = 'Stayful estimate', oursMonthly = null }: { ours: number; opinion: NonNullable<AnalysisResult['secondOpinion']>; oursLabel?: string; /** Batch 22: our month-by-month revenue, beside PMI's. */ oursMonthly?: readonly number[] | null }) {
  const gap = ours > 0 ? Math.round(((opinion.annualRevenue - ours) / ours) * 100) : null;
  const agree = gap !== null && Math.abs(gap) <= 15;
  const months = monthRows(oursMonthly, opinion.monthly);
  const comps = comparableRows(opinion.comparables);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Second opinion: Property Market Intel</p>
          <p className="text-xs text-muted-foreground">An independent projection from a separate UK dataset, run for this property.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{oursLabel}</p><p className="text-lg font-bold">{gbp(ours)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">PMI projection</p><p className="text-lg font-bold">{gbp(opinion.annualRevenue)}</p>{opinion.rangeLow !== null && opinion.rangeHigh !== null && <p className="text-[10px] text-muted-foreground">{gbp(opinion.rangeLow)} – {gbp(opinion.rangeHigh)}</p>}</div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Nightly · occupancy</p><p className="text-lg font-bold">{opinion.adr !== null ? gbp(opinion.adr) : '—'} · {pct0(opinion.occupancy)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Agreement</p><p className={`text-lg font-bold ${agree ? 'text-success' : 'text-warning-foreground'}`}>{gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap}%`}</p><p className="text-[10px] text-muted-foreground">PMI confidence: {opinion.confidence}</p></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {agree ? 'The two datasets agree within 15%, which is a good sign the estimate is robust.' : 'The datasets differ by more than 15%. Treat the estimate as a range and look at the comparables before deciding.'}
          </p>
          {/* Batch 22, Part H: month by month, ours beside PMI's. */}
          {months.some((m) => m.pmi !== null) && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[320px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Month</th>
                    <th className="py-1 pr-2 text-right font-medium">{oursLabel.replace(/ estimate$/, '')}</th>
                    <th className="py-1 text-right font-medium">PMI</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month} className="border-t border-border">
                      <td className="py-1 pr-2">{m.month}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{m.ours === null ? '—' : gbp(m.ours)}</td>
                      <td className="py-1 text-right tabular-nums">{m.pmi === null ? '—' : gbp(m.pmi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* PMI's comparables, laid out like ours. */}
          {comps.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PMI’s comparables</p>
              <ul className="mt-1 divide-y divide-border text-xs">
                {comps.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{c.title}</a> : c.title}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {[c.annual !== null ? `${gbp(c.annual)}/yr` : null, c.nightly !== null ? `${gbp(c.nightly)}/night` : null, c.occupancyPct !== null ? `${c.occupancyPct}%` : null, c.rating !== null ? `★ ${c.rating}` : null, c.distance].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
