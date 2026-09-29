'use client';

import { Card, CardContent } from '@/components/ui/card';
import { LEVEL_LABELS, GARDEN_NOTE } from '@/lib/project/costing';
import { VALUE_DISCLAIMER, WORKS_DISCLAIMER } from '@/lib/project/headline';
import { mineVersusOurs, quantityLabel, spanLabel, valueBasis, type ReportProject, type ReportProjectMine } from '@/lib/project/report';

/**
 * The project in a Full analysis of a Project deal (Batch 17, Part F): our
 * estimate as it stood when the analysis ran (the works line by line, with
 * why; the value after works and the value added; the finance) and, when the
 * reader locked their own figures on the deal sheet, theirs beside it. The
 * photos the estimate rests on stay on the deal sheet.
 */

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;

function Fig({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const STATUS: Record<ReportProject['lines'][number]['status'], { text: string; tone: string }> = {
  needed: { text: 'Needed', tone: 'bg-primary/10 text-primary' },
  cant_tell: { text: 'Can’t tell', tone: 'bg-warning/15 text-foreground' },
};

export function ProjectReportPanel({ project: p, mine }: { project: ReportProject; mine: ReportProjectMine | null }) {
  const f = p.finance;
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{LEVEL_LABELS[p.level]}</p>
            <p className="text-xs text-muted-foreground">Estimated {new Date(p.estimatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. {WORKS_DISCLAIMER}</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fig label="Works" value={spanLabel(p.works)} sub={`with ${p.works.contingencyPct}% contingency`} />
            <Fig label="Value after works" value={gbp(p.value)} sub={valueBasis(p)} />
            <Fig label="Value added" value={gbp(p.valueAdded)} sub={`${p.valueAddedPct.toFixed(1)}% of the value, after the works at the high end`} />
            <Fig label="Cash needed" value={spanLabel(f.cash)} sub={f.bridge ? `on a bridge, ${f.months} months of works` : `${f.months} months of works`} />
            {f.refinance && <Fig label="Money left in" value={spanLabel(f.refinance.moneyLeftIn)} sub={`after refinancing at ${f.refinance.pct}% of the value`} />}
            {p.profitAfterWorksPcm !== null && <Fig label="Profit after works" value={`${gbp(p.profitAfterWorksPcm)}/mo`} sub={f.refinance ? 'on this report’s income and finance, after the refinance' : 'on this report’s income and finance'} />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-semibold text-foreground">The works, line by line</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Works</th>
                  <th className="pr-2 font-medium">Quantity</th>
                  <th className="pr-2 text-right font-medium">Cost</th>
                  <th className="pr-2 font-medium">From the photos</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.label} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2 font-medium text-foreground">{l.label}</td>
                    <td className="pr-2 text-muted-foreground">{quantityLabel(l)}</td>
                    <td className="pr-2 text-right text-foreground">{gbp(l.cost)}</td>
                    <td className="pr-2 text-muted-foreground">
                      <span className={'mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ' + STATUS[l.status].tone}>{STATUS[l.status].text}</span>
                      {l.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Clearly needed {gbp(p.works.neededLines)} and can’t tell {gbp(p.works.cantTellLines)}, before contingency; the can’t-tell lines are counted at the high end.
            {p.notNeeded.length > 0 ? ` Not needed from the photos: ${p.notNeeded.map((l) => l.toLowerCase()).join(', ')}.` : ''} {GARDEN_NOTE}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-semibold text-foreground">The money</p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fig label="Asking price" value={gbp(f.price)} />
            <Fig label={f.taxName === 'SDLT' ? 'Stamp duty' : f.taxName} value={gbp(f.stampDuty)} />
            <Fig label="Buying costs" value={gbp(f.buyingCosts)} sub={f.bridge ? 'legal, survey and the bridge’s valuation' : 'legal and survey'} />
            <Fig label="Holding" value={spanLabel(f.holding)} sub={`${f.months} months: bills${f.bridge ? ' and the bridge’s interest' : ''}`} />
            <Fig label="Furnishing and setup" value={gbp(f.furnishing)} />
            <Fig label="Total in" value={spanLabel(f.totalIn)} />
            {f.bridge && <Fig label="Bridging loan" value={gbp(f.bridge.loan)} sub={`${f.bridge.ltvPct}% of the price at ${f.bridge.monthlyPct}% a month, ${gbp(f.bridge.arrangementFee)} arrangement fee; the works paid in cash`} />}
            {f.refinance && <Fig label="Refinance" value={gbp(f.refinance.loan)} sub={`${f.refinance.pct}% of the value after works`} />}
          </div>
        </CardContent>
      </Card>

      {mine && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm font-semibold text-foreground">Your figures</p>
            <p className="mt-1 text-xs text-muted-foreground">{mineVersusOurs(p, mine)} Private to you: change them on the deal page.</p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fig label="Your works" value={spanLabel(mine.works)} sub={`ours ${spanLabel(p.works)}`} />
              <Fig label="Your value added" value={gbp(mine.valueAdded)} sub={`${mine.valueAddedPct.toFixed(1)}% of ${gbp(mine.value)}; ours ${gbp(p.valueAdded)}`} />
              <Fig label="Your cash needed" value={spanLabel(mine.cash)} sub={`ours ${spanLabel(f.cash)}`} />
              {mine.moneyLeftIn && <Fig label="Your money left in" value={spanLabel(mine.moneyLeftIn)} sub={f.refinance ? `ours ${spanLabel(f.refinance.moneyLeftIn)}` : null} />}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{VALUE_DISCLAIMER} The finished-house figures in the rest of this report are the property after the works.</p>
    </div>
  );
}
