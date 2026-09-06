'use client';

import { useMemo, useState } from 'react';
import { Calculator, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { purchaseDeal, rentToRentDeal, DEFAULT_FINANCE, type FinanceDefaults, type PurchaseDeal, type RentToRentDeal } from '@/lib/listing/deal';
import type { DealResult } from '@/lib/types';
import { gbp, gbpSigned } from './format';

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Field({ id, label, value, onChange, suffix, step, min, max }: { id: string; label: string; value: number; onChange: (n: number) => void; suffix?: string; step?: number; min?: number; max?: number }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Input id={id} type="number" inputMode="decimal" value={Number.isFinite(value) ? value : ''} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} className="h-8 text-sm" />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

/**
 * Deal economics on the listing's asking price or advertised rent, with a
 * reverse calculator: change the target and see the price or rent that
 * still works. All maths is the same pure module the server used, so the
 * live figures and the saved report agree.
 */
export function DealPanel({ deal, grossRevenue, adr, bedrooms, setupCost }: { deal: DealResult; grossRevenue: number; adr: number; bedrooms: number; setupCost?: number }) {
  // Start from the inputs the server used, so the first render matches the saved report and PDF.
  const initialFinance: FinanceDefaults =
    deal.kind === 'purchase'
      ? { depositPct: deal.depositPct, mortgageRatePct: deal.mortgageRatePct, termYears: deal.termYears, targetYieldPct: deal.targetYieldPct, targetMarginPcm: DEFAULT_FINANCE.targetMarginPcm }
      : { ...DEFAULT_FINANCE, targetMarginPcm: deal.targetMarginPcm };
  const [finance, setFinance] = useState<FinanceDefaults>(initialFinance);
  const [price, setPrice] = useState(deal.kind === 'purchase' ? deal.askingPrice : deal.advertisedRentPcm);
  const [bills, setBills] = useState(250);
  const setup = setupCost ?? deal.setupCost;

  const live = useMemo<PurchaseDeal | RentToRentDeal>(() => {
    const base = { grossRevenue, adr, bedrooms, finance, setupCost: setup, costs: { billsPcm: bills } };
    return deal.kind === 'purchase' ? purchaseDeal(Math.max(0, price), base) : rentToRentDeal(Math.max(0, price), base);
  }, [deal.kind, grossRevenue, adr, bedrooms, finance, setup, bills, price]);

  const basisLabel = deal.basis === 'asking-price' ? 'asking price' : deal.basis === 'advertised-rent' ? 'advertised rent' : 'estimated value';

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-4 flex items-start gap-2">
          <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">{live.kind === 'purchase' ? 'If you bought it' : 'If you rented it (rent-to-rent)'}</p>
            <p className="text-xs text-muted-foreground">
              Based on the {basisLabel} and this report&apos;s {gbp(grossRevenue)} gross revenue. Edit any figure to see the deal move.
            </p>
          </div>
        </div>

        {live.kind === 'purchase' ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Gross yield" value={`${live.grossYieldPct}%`} sub={`on ${gbp(live.askingPrice)}`} tone={live.grossYieldPct >= finance.targetYieldPct ? 'good' : undefined} />
              <Stat label="Net yield" value={`${live.netYieldPct}%`} sub="after running costs" />
              <Stat label="Monthly cashflow" value={gbpSigned(live.cashflowMonthly)} sub={`after ${gbp(live.mortgageMonthly)} mortgage`} tone={live.cashflowMonthly >= 0 ? 'good' : 'bad'} />
              <Stat label="Cash on cash" value={`${live.cashOnCashPct}%`} sub={`on ${gbp(live.cashRequired)} in`} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Stamp duty" value={gbp(live.stampDuty)} sub="additional-property rate" />
              <Stat label="Setup budget" value={gbp(live.setupCost)} sub="furnishing & kit" />
              <Stat label={`Max price for ${finance.targetYieldPct}% yield`} value={gbp(live.maxPriceForTargetYield)} sub={live.maxPriceForTargetYield >= live.askingPrice ? 'above asking' : `${gbp(live.askingPrice - live.maxPriceForTargetYield)} below asking`} tone={live.maxPriceForTargetYield >= live.askingPrice ? 'good' : 'bad'} />
              <Stat label="Net operating / yr" value={gbp(live.netOperating)} sub="before mortgage" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Field id="deal-price" label="Purchase price" value={price} onChange={setPrice} suffix="£" step={1000} min={0} />
              <Field id="deal-deposit" label="Deposit" value={finance.depositPct} onChange={(v) => setFinance({ ...finance, depositPct: v })} suffix="%" step={5} min={0} max={100} />
              <Field id="deal-rate" label="Mortgage rate" value={finance.mortgageRatePct} onChange={(v) => setFinance({ ...finance, mortgageRatePct: v })} suffix="%" step={0.25} min={0} max={25} />
              <Field id="deal-target" label="Target yield" value={finance.targetYieldPct} onChange={(v) => setFinance({ ...finance, targetYieldPct: v })} suffix="%" step={0.5} min={1} max={50} />
              <Field id="deal-bills" label="Bills / month" value={bills} onChange={setBills} suffix="£" step={25} min={0} />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Monthly margin" value={gbpSigned(live.monthlyMargin)} sub={`after ${gbp(live.advertisedRentPcm)} rent`} tone={live.monthlyMargin >= 0 ? 'good' : 'bad'} />
              <Stat label="Annual margin" value={gbpSigned(live.annualMargin)} tone={live.annualMargin >= 0 ? 'good' : 'bad'} />
              <Stat label="Breakeven occupancy" value={live.breakevenOccupancyPct === null ? '—' : `${live.breakevenOccupancyPct}%`} sub="covers rent and bills" />
              <Stat label="Payback of setup" value={live.paybackMonths === null ? 'Never' : `${live.paybackMonths} mo`} sub={`${gbp(live.setupCost)} setup`} tone={live.paybackMonths !== null && live.paybackMonths <= 12 ? 'good' : undefined} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Monthly gross" value={gbp(live.monthlyGross)} />
              <Stat label="Running costs" value={gbp(live.monthlyOperating)} sub="platform, management, cleaning, bills" />
              <Stat label="Net before rent" value={gbp(live.monthlyNetBeforeRent)} />
              <Stat label={`Max rent for ${gbp(finance.targetMarginPcm)} margin`} value={gbp(live.maxRentForTargetMargin)} sub={live.maxRentForTargetMargin >= live.advertisedRentPcm ? 'above advertised' : `${gbp(live.advertisedRentPcm - live.maxRentForTargetMargin)} below advertised`} tone={live.maxRentForTargetMargin >= live.advertisedRentPcm ? 'good' : 'bad'} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field id="deal-rent" label="Rent you would pay" value={price} onChange={setPrice} suffix="£ pcm" step={25} min={0} />
              <Field id="deal-margin" label="Target margin" value={finance.targetMarginPcm} onChange={(v) => setFinance({ ...finance, targetMarginPcm: v })} suffix="£ pcm" step={50} min={0} />
              <Field id="deal-bills-r2r" label="Bills / month" value={bills} onChange={setBills} suffix="£" step={25} min={0} />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              <p>
                Rent-to-rent needs the landlord&apos;s written consent to sub-let, a lease that allows it, and the mortgage lender&apos;s and insurer&apos;s agreement. Check the council&apos;s short-let licensing rules for this area before committing.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
