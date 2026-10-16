/**
 * The deal page's "Buy to let" section (Batch 28, Part F), as words and
 * figures: every figure a range where the brief says so, the lender's rent
 * test, the benchmark it was judged against and how many deals that rests
 * on, the costs line by line, the EPC note, the rules for the nation, and
 * the disclaimer. The page draws it; nothing here holds an address or a
 * link (the section is only drawn whole once the deal is opened).
 *
 * Pure: no network, no database, no server-only.
 */
import type { TaxCountry } from '../listing/stamp-duty.ts';
import { benchmarkWhere, type Benchmark } from './benchmark.ts';
import { judgedOf, RENT_CONFIDENCE_WORDS, type BtlCard } from './card.ts';
import type { CashBand, Range3 } from './deal.ts';
import { BTL_DISCLAIMER, epcLine, RULES_NOTE } from './nation.ts';
import { BTL_PRIORITY_LABELS, passesFor, type BtlPriority } from './rules.ts';

export const CASH_BAND_LABELS: Record<CashBand, string> = {
  under_25k: 'under £25k',
  '25k_50k': '£25k–£50k',
  '50k_100k': '£50k–£100k',
  '100k_plus': '£100k or more',
};

export interface SheetRow {
  label: string;
  value: string;
  sub?: string;
}

export interface BtlSheet {
  rows: SheetRow[];
  costs: SheetRow[];
  rentTest: { pass: boolean; text: string; tight: string | null };
  /** "Compared with 157 deals across the UK in the £50k–£100k band …"; null with nothing stored. */
  benchmark: string | null;
  /** How it does for what the member is after, against that benchmark. */
  verdict: string;
  epc: string | null;
  rules: string;
  rate: string;
  disclaimer: string;
}

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const money = (r: Pick<Range3, 'low' | 'high'>) => (Math.round(r.low) === Math.round(r.high) ? gbp(r.low) : `${gbp(r.low)}${r.low < 0 || r.high < 0 ? ' to ' : '–'}${gbp(r.high)}`);
const pcts = (r: Pick<Range3, 'low' | 'high'>, suffix = '') => `${pct1(r.low)}${r.low < 0 || r.high < 0 ? ' to ' : '–'}${pct1(r.high)}${suffix}`;

/** The lender's rent test, in words, with "tight" when the low end of the rent would fail it. */
export function rentTestWords(card: Pick<BtlCard, 'rentTest' | 'rent'>): BtlSheet['rentTest'] {
  const t = card.rentTest;
  const how = `125% of the interest at ${pct1(t.stressRatePct)}`;
  if (t.pass) {
    const tight = card.rent.low < t.requiredRent ? `Tight: at the low end of the rent range (${gbp(card.rent.low)}) it would not pass.` : null;
    return { pass: true, text: `Passes the lender’s rent test: ${gbp(t.rent)} rent against ${gbp(t.requiredRent)} needed (${how}).`, tight };
  }
  const deposit = t.depositPctToPass !== null && t.depositToPass !== null ? ` Passes with a ${t.depositPctToPass}% deposit (${gbp(t.depositToPass)}).` : '';
  return { pass: false, text: `Fails the lender’s rent test: ${gbp(t.rent)} rent, ${gbp(t.requiredRent)} needed (${how}).${deposit}`, tight: null };
}

/** "Compared with 157 deals across the UK with £50k–£100k cash in: typical ROI 0.8%, growth 1.8% a year." */
export function benchmarkWords(bm: Benchmark | null, regionName: string | null): string | null {
  if (!bm) return null;
  if (bm.none) return `Too few buy-to-let deals with ${CASH_BAND_LABELS[bm.band]} cash in to compare (${bm.count} ${benchmarkWhere(bm, regionName)}): it is judged on the lender’s test and the cashflow alone.`;
  const growth = bm.growthMedianPct !== null ? `, growth ${pct1(bm.growthMedianPct)} a year` : '';
  const thin = bm.thin ? ' That is fewer than we like to compare with, so treat it as a rough guide.' : '';
  return `Compared with ${bm.count} buy-to-let deals ${benchmarkWhere(bm, regionName)} with ${CASH_BAND_LABELS[bm.band]} cash in: typical ROI ${pct1(bm.roiMedianPct)}${growth}.${thin}`;
}

/** How the deal does for what the member is after, against the benchmark, in one sentence. */
export function verdictWords(priority: BtlPriority, card: BtlCard, bm: Benchmark | null): string {
  const v = passesFor(priority, judgedOf(card), bm);
  const what = BTL_PRIORITY_LABELS[priority].toLowerCase();
  if (!v.floorsOk) return 'It does not pass the hard rules (the lender’s rent test, and cashflow at the low end of the rent).';
  if (!v.compared || !bm) return 'It passes the lender’s rent test and stays above £0 a month at the low end of the rent.';
  const growth = card.growth ? card.growth.annualPct.mid : null;
  const figures =
    priority === 'income'
      ? `ROI ${pct1(card.roiPct.mid)} against a typical ${pct1(bm.roiMedianPct)}`
      : priority === 'growth'
        ? growth !== null && bm.growthMedianPct !== null
          ? `growth ${pct1(growth)} a year against a typical ${pct1(bm.growthMedianPct)}`
          : 'no growth figure to compare'
        : `ROI ${pct1(card.roiPct.mid)} and growth ${growth === null ? 'unknown' : `${pct1(growth)} a year`}, against ${pct1(bm.roiP40Pct)} and ${bm.growthP40Pct === null ? 'unknown' : `${pct1(bm.growthP40Pct)} a year`}`;
  return v.pass ? `Beats the typical deal for “${what}”: ${figures}.` : `Below the typical deal for “${what}”: ${figures}.`;
}

export function btlSheet(card: BtlCard, opts: { priority: BtlPriority; benchmark: Benchmark | null; regionName?: string | null; rateLabel?: string | null }): BtlSheet {
  const rows: SheetRow[] = [
    { label: 'Rent a month', value: money(card.rent), sub: `${RENT_CONFIDENCE_WORDS[card.rent.confidence]}${card.rent.compCount > 0 ? ` · ${card.rent.compCount} rentals nearby` : ''}${card.rent.valuation ? ' · checked against a rent valuation' : ''}` },
    { label: 'Gross yield', value: pcts(card.grossYieldPct) },
    { label: 'Net yield', value: pcts(card.netYieldPct), sub: 'after running costs' },
    { label: 'Running costs a month', value: money(card.monthlyCosts) },
    { label: 'Mortgage interest a month', value: gbp(card.mortgageMonthly), sub: `75% interest-only loan of ${gbp(card.loan)}` },
    { label: 'Cashflow a month', value: money(card.cashflowMonthly), sub: 'before tax' },
    { label: 'Cash in', value: money(card.cashIn), sub: `${gbp(card.deposit)} deposit, ${gbp(card.tax)} ${card.taxName}, ${gbp(card.buyingCosts)} buying costs${card.epcAllowance > 0 ? `; the top end adds ${gbp(card.epcAllowance)} for an energy upgrade` : ''}` },
    { label: 'ROI', value: pcts(card.roiPct), sub: 'a year’s cashflow on the cash in, before tax' },
  ];
  if (card.growth) {
    rows.push({ label: 'Value in 5 years', value: money(card.growth.value5y), sub: 'if the area repeats its last five years, or half that pace' });
    rows.push({ label: 'Growth a year', value: pcts(card.growth.annualPct), sub: card.growth.growth1yPct !== null ? `${card.growth.growth1yPct >= 0 ? '+' : '−'}${pct1(Math.abs(card.growth.growth1yPct))} in the last year${card.growth.turning ? ': prices here have turned' : ''}` : 'history, not a forecast' });
  }
  const c = card.costLines;
  const costs: SheetRow[] = [
    { label: 'Empty month (1 a year)', value: gbp(c.emptyMonths) },
    { label: 'Letting agent (12% incl. VAT)', value: gbp(c.agent) },
    { label: 'Repairs (8%)', value: gbp(c.repairs) },
    { label: 'Insurance', value: gbp(c.insurance) },
    { label: 'Safety certificates', value: gbp(c.safety) },
    ...(c.serviceCharge > 0 ? [{ label: card.flags.serviceChargeConfirmed ? 'Service charge' : 'Service charge (not confirmed: an estimate)', value: gbp(c.serviceCharge) }] : []),
    ...(c.groundRent > 0 ? [{ label: 'Ground rent', value: gbp(c.groundRent) }] : []),
    { label: 'Total a month, at the middle rent', value: gbp(c.total) },
  ];
  const country: TaxCountry = card.country;
  return {
    rows,
    costs,
    rentTest: rentTestWords(card),
    benchmark: benchmarkWords(opts.benchmark, opts.regionName ?? null),
    verdict: verdictWords(opts.priority, card, opts.benchmark),
    epc: epcLine(country, card.flags.epc),
    rules: RULES_NOTE[country],
    rate: `${card.rateFallback ? 'A typical' : 'The typical'} 2-year fixed rate${card.rateDate ? ` (${card.rateDate})` : ''}: ${pct1(card.ratePct)}${card.rateFallback ? ', as the live rate was not available' : ''}. ${opts.rateLabel ?? 'Your broker’s rate may differ.'}`,
    disclaimer: BTL_DISCLAIMER,
  };
}
