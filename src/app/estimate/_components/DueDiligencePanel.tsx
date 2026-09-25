'use client';

import { Droplets, FileCheck, Landmark, Receipt, ShieldCheck, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { AnalysisResult, DueDiligence } from '@/lib/types';
import { diligenceNotes } from '@/lib/analysis/due-diligence';
import { gbp } from './format';

/**
 * What the public registers say about the property (EPC, flood risk,
 * planning designations, listed buildings), what it costs to hold (council
 * tax, stamp duty) and how easily it would sell or let on if short-letting
 * stopped. Every block is optional: a report saved before PropertyData
 * supplied these simply shows fewer of them.
 */

type Tone = 'good' | 'warn' | 'bad' | 'muted';

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

const TONE: Record<Tone, string> = {
  good: 'bg-success/10 text-success',
  warn: 'bg-warning/10 text-warning',
  bad: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
};

function Fact({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub: string; tone?: Tone }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone ? TONE[tone] : 'bg-primary/10 text-primary'}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-lg font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function floodTone(level: string | undefined): Tone {
  const l = (level ?? '').toLowerCase();
  if (l === 'high') return 'bad';
  if (l === 'medium') return 'warn';
  return 'good';
}

function epcTone(rating: string): Tone {
  return rating <= 'C' ? 'good' : rating <= 'E' ? 'warn' : 'bad';
}

function Designation({ label, flag }: { label: string; flag: { inside: boolean; name: string | null } | null }) {
  const status = flag ? (flag.inside ? 'Yes' : 'No') : 'No data';
  const tone: Tone = flag ? (flag.inside ? 'warn' : 'good') : 'muted';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {flag?.name && <p className="text-xs text-muted-foreground">{flag.name}</p>}
      </div>
      <Badge className={TONE[tone]}>{status}</Badge>
    </div>
  );
}

function Liquidity({ title, verb, data }: { title: string; verb: string; data: DueDiligence['exitLiquidity']['sale'] }) {
  const rows: Array<[string, string]> = data
    ? [
        ['Days on market', data.daysOnMarket !== null ? `${Math.round(data.daysOnMarket)} days` : '—'],
        ['On the market now', data.total !== null ? data.total.toLocaleString('en-GB') : '—'],
        [`${verb} a month`, data.perMonth !== null ? data.perMonth.toLocaleString('en-GB') : '—'],
        ['Months of stock', data.monthsOfInventory !== null ? String(data.monthsOfInventory) : '—'],
      ]
    : [];
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
        <p className="mt-0.5 text-lg font-bold text-foreground">{data?.rating ?? 'No data'}</p>
        <dl className="mt-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

export function DueDiligencePanel({ result }: { result: AnalysisResult }) {
  const dd = result.dueDiligence ?? null;
  const epc = result.epc ?? null;
  const ct = result.councilTax ?? null;
  const deal = result.deal?.kind === 'purchase' ? result.deal : null;
  const growth = result.growth ?? null;
  const fv = result.futureValue ?? null;
  const notes = diligenceNotes(result);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          icon={FileCheck}
          label="EPC rating"
          value={epc ? epc.rating : '—'}
          sub={epc ? `${epc.score !== null ? `Score ${epc.score}` : 'Score unknown'}${epc.inspectionDate ? ` · inspected ${epc.inspectionDate}` : ''}` : 'No certificate matched this address'}
          tone={epc ? epcTone(epc.rating) : 'muted'}
        />
        <Fact
          icon={Droplets}
          label="Flood risk"
          value={dd?.floodRisk ? dd.floodRisk.level : '—'}
          sub={dd?.floodRisk ? (dd.floodRisk.high ? 'Get flood cover quoted before exchange' : 'Environment Agency band for the postcode') : 'No data for this postcode'}
          tone={dd?.floodRisk ? floodTone(dd.floodRisk.level) : 'muted'}
        />
        <Fact
          icon={Receipt}
          label="Council tax"
          value={ct ? `Band ${ct.band}` : '—'}
          sub={ct ? `${gbp(ct.annual)} a year${ct.council ? ` · ${ct.council}` : ''}${ct.matched === 'address' ? '' : ct.matched === 'postcode-mode' ? ' · commonest band in the postcode' : ' · band D assumed'}` : 'Band not on record'}
        />
        <Fact
          icon={Landmark}
          label="Stamp duty"
          value={deal ? gbp(deal.stampDuty) : '—'}
          sub={deal ? `${deal.stampDutyName ?? 'SDLT'}${deal.stampDutyEffectiveRatePct !== undefined ? ` · ${deal.stampDutyEffectiveRatePct}% effective` : ''}${deal.stampDutySource === 'propertydata' ? ' · live rate' : ''}` : 'No purchase price on this report'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Planning designations</p>
            <div className="mt-2">
              <Designation label="Conservation area" flag={dd?.conservationArea ?? null} />
              <Designation label="Green belt" flag={dd?.greenBelt ?? null} />
              <Designation label="Area of Outstanding Natural Beauty" flag={dd?.aonb ?? null} />
              <Designation label="National park" flag={dd?.nationalPark ?? null} />
            </div>
            <p className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground">Listed buildings nearby</p>
            {dd?.listedBuildings && dd.listedBuildings.nearest.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-sm">
                {dd.listedBuildings.nearest.map((b) => (
                  <li key={`${b.name}-${b.distanceMiles}`} className="flex items-center justify-between gap-3">
                    <span className="truncate text-foreground">{b.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {b.grade ? `Grade ${b.grade} · ` : ''}
                      {b.distanceMiles !== null ? `${b.distanceMiles.toFixed(2)} mi` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{dd?.listedBuildings ? 'None on record nearby' : 'No data for this postcode'}</p>
            )}
            {dd?.listedBuildings?.possiblyListed && (
              <p className="mt-2 flex items-start gap-2 text-xs text-warning">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                One sits within about 80 metres: the property itself may be listed. Check the title before any works.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Liquidity title="If you had to sell" verb="Sales" data={dd?.exitLiquidity.sale ?? null} />
            <Liquidity title="If you had to let long-term" verb="Lets" data={dd?.exitLiquidity.rent ?? null} />
          </div>
          {growth && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Capital growth · {growth.outcode}</p>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {([['1 yr', growth.growth1y], ['3 yrs', growth.growth3y], ['5 yrs', growth.growth5y], ['7 yrs', growth.growth7y]] as Array<[string, number | null]>).map(([label, v]) => (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                      <p className="text-base font-bold text-foreground">{pct(v)}</p>
                    </div>
                  ))}
                </div>
                {fv && (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Value in {fv.horizonYears} years: <span className="font-semibold text-foreground">{gbp(fv.low)} to {gbp(fv.high)}</span> from{' '}
                    {fv.basis === 'asking-price' ? 'the asking price' : 'the estimated value'} of {gbp(fv.baseValue)}. The top end repeats the outcode&apos;s 5-year rate ({fv.annualisedPct}% a year); the low end takes {fv.haircutAnnualPct}% a year. An assumption from historic growth, not a forecast.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {notes.map((n) => (
          <p key={n} className="text-xs leading-relaxed text-muted-foreground">{n}</p>
        ))}
      </div>
    </div>
  );
}
