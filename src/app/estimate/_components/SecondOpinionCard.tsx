'use client';

import { Scale } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';
import { gbp, pct0 } from './format';

/** Property Market Intel's projection beside ours, with the gap in plain terms. */
export function SecondOpinionCard({ ours, opinion }: { ours: number; opinion: NonNullable<AnalysisResult['secondOpinion']> }) {
  const gap = ours > 0 ? Math.round(((opinion.annualRevenue - ours) / ours) * 100) : null;
  const agree = gap !== null && Math.abs(gap) <= 15;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Second opinion: Property Market Intel</p>
          <p className="text-xs text-muted-foreground">An independent projection from a separate UK dataset, run for this property.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stayful estimate</p><p className="text-lg font-bold">{gbp(ours)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">PMI projection</p><p className="text-lg font-bold">{gbp(opinion.annualRevenue)}</p>{opinion.rangeLow !== null && opinion.rangeHigh !== null && <p className="text-[10px] text-muted-foreground">{gbp(opinion.rangeLow)} – {gbp(opinion.rangeHigh)}</p>}</div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Nightly · occupancy</p><p className="text-lg font-bold">{opinion.adr !== null ? gbp(opinion.adr) : '—'} · {pct0(opinion.occupancy)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Agreement</p><p className={`text-lg font-bold ${agree ? 'text-success' : 'text-warning-foreground'}`}>{gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap}%`}</p><p className="text-[10px] text-muted-foreground">PMI confidence: {opinion.confidence}</p></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {agree ? 'The two datasets agree within 15%, which is a good sign the estimate is robust.' : 'The datasets differ by more than 15%. Treat the estimate as a range and look at the comparables before deciding.'}
          </p>
        </div>
      </div>
    </div>
  );
}
