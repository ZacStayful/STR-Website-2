/**
 * The £2 buy-to-let report (Batch 28, Part G), assembled: the listing's
 * buy-to-let figures with a paid rent valuation and its EPC folded in, the
 * sale valuation, sold prices nearby, the flood and planning checks, the
 * benchmark it is judged against, and a short written summary from
 * templates (no AI: no token cost, nothing to approve). No short-let data.
 *
 * Stored as btl_reports.result; the page draws it with btl/sheet.ts. Never
 * an address, a full postcode or a link: the outcode and the area only.
 *
 * Pure: no network, no database, no server-only.
 */
import type { PdSoldSale } from '../apis/propertydata-parse.ts';
import type { DueDiligence } from '../types.ts';
import type { Benchmark } from './benchmark.ts';
import { parseBtlCard, RENT_CONFIDENCE_WORDS, type BtlCard } from './card.ts';
import type { CashBand } from './deal.ts';
import { BTL_PRIORITY_LABELS, passesFor, type BtlPriority } from './rules.ts';
import { judgedOf } from './card.ts';
import { CASH_BAND_LABELS } from './sheet.ts';
import type { ListingKind } from './rent.ts';

export const BTL_REPORT_VERSION = 1;

/**
 * The provider calls one report can make, at most: a rent valuation (up to
 * three attempts, paid only on an answer), a sale valuation, sold prices,
 * and the nine EPC, flood, planning and demand questions. Its worst-case raw
 * cost is this many PropertyData calls, which the welcome price never goes under.
 */
export const BTL_REPORT_MAX_CALLS = 15;

export interface ReportCheck {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'info';
}

export interface BtlReport {
  v: number;
  createdAt: string;
  dealId: string | null;
  /** "3-bed house in B44". */
  title: string;
  outcode: string | null;
  postcodeArea: string | null;
  price: number;
  card: BtlCard;
  priority: BtlPriority;
  band: CashBand | null;
  benchmark: Benchmark | null;
  regionName: string | null;
  saleValuation: { estimate: number; low: number; high: number; confidence: string | null } | null;
  sold: { count: number; median: number; low: number; high: number; months: number } | null;
  /** The rent valuation the range was narrowed with, £ a month; null when PropertyData had none. */
  rentValuation: number | null;
  checks: ReportCheck[];
  summary: string[];
}

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const span = (low: number, high: number) => (Math.round(low) === Math.round(high) ? gbp(low) : `${gbp(low)}${low < 0 || high < 0 ? ' to ' : '–'}${gbp(high)}`);

/** Sold prices nearby as one line's figures: the count, the median and the middle half. */
export function soldSummary(sales: readonly PdSoldSale[] | null, months: number): BtlReport['sold'] {
  const prices = (sales ?? []).map((s) => s.price).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.max(0, Math.round(q * (prices.length - 1))))];
  return { count: prices.length, median: at(0.5), low: at(0.25), high: at(0.75), months };
}

/** The flood and planning checks, and the EPC, in words. */
export function reportChecks(card: BtlCard, dd: DueDiligence | null): ReportCheck[] {
  const out: ReportCheck[] = [];
  const epc = card.flags.epc;
  out.push(epc ? { label: 'EPC', value: `Rated ${epc}`, tone: epc === 'A' || epc === 'B' || epc === 'C' ? 'ok' : 'warn' } : { label: 'EPC', value: 'Not found on the register', tone: 'info' });
  if (dd?.floodRisk) out.push({ label: 'Flood risk', value: dd.floodRisk.level, tone: dd.floodRisk.high ? 'warn' : 'ok' });
  const designations: [string, { inside: boolean; name: string | null } | null][] = [
    ['Conservation area', dd?.conservationArea ?? null],
    ['Green belt', dd?.greenBelt ?? null],
    ['Area of outstanding natural beauty', dd?.aonb ?? null],
    ['National park', dd?.nationalPark ?? null],
  ];
  for (const [label, d] of designations) if (d) out.push({ label, value: d.inside ? `Inside${d.name ? `: ${d.name}` : ''}` : 'Outside', tone: d.inside ? 'info' : 'ok' });
  if (dd?.listedBuildings) out.push({ label: 'Listed buildings', value: dd.listedBuildings.possiblyListed ? 'One very close: it may be listed' : 'None very close', tone: dd.listedBuildings.possiblyListed ? 'warn' : 'ok' });
  return out;
}

/** The short written summary: template sentences from the figures, every one a range where the figures are. */
export function reportSummary(r: Omit<BtlReport, 'summary' | 'v' | 'createdAt'>): string[] {
  const c = r.card;
  const out: string[] = [];
  out.push(`At ${gbp(r.price)}, this ${r.title} would let for about ${span(c.rent.low, c.rent.high)} a month (${RENT_CONFIDENCE_WORDS[c.rent.confidence].toLowerCase()}${r.rentValuation ? `, checked against a rent valuation of ${gbp(r.rentValuation)}` : ''}).`);
  out.push(`After running costs and ${Math.round((c.loan / r.price) * 100)}% interest-only finance at ${pct1(c.ratePct)}, that leaves ${span(c.cashflowMonthly.low, c.cashflowMonthly.high)} a month before tax, on ${span(c.cashIn.low, c.cashIn.high)} cash in: ${pct1(c.roiPct.low)} to ${pct1(c.roiPct.high)} a year on your cash.`);
  out.push(c.rentTest.pass ? (c.rent.low < c.rentTest.requiredRent ? `It passes the lender’s rent test (${gbp(c.rentTest.requiredRent)} needed), but only just at the low end of the rent.` : `It passes the lender’s rent test comfortably (${gbp(c.rentTest.requiredRent)} needed).`) : `It fails the lender’s rent test (${gbp(c.rentTest.requiredRent)} needed)${c.rentTest.depositPctToPass !== null ? `; a ${c.rentTest.depositPctToPass}% deposit would pass` : ''}.`);
  if (r.benchmark && !r.benchmark.none) {
    const v = passesFor(r.priority, judgedOf(c), r.benchmark);
    out.push(`Against ${r.benchmark.count} buy-to-let deals with ${CASH_BAND_LABELS[r.benchmark.band]} cash in, it ${v.pass ? 'beats' : 'falls short of'} the typical deal for “${BTL_PRIORITY_LABELS[r.priority].toLowerCase()}”.`);
  }
  if (r.saleValuation) {
    const where = r.price < r.saleValuation.low ? 'below' : r.price > r.saleValuation.high ? 'above' : 'within';
    out.push(`PropertyData values it at ${span(r.saleValuation.low, r.saleValuation.high)}: the asking price is ${where} that range.`);
  }
  if (r.sold) out.push(`${r.sold.count} similar home${r.sold.count === 1 ? '' : 's'} sold nearby in the last ${r.sold.months} months, at a median of ${gbp(r.sold.median)}.`);
  if (c.growth) out.push(`If prices here repeat their last five years, or half that pace, it would be worth ${span(c.growth.value5y.low, c.growth.value5y.high)} in five years. That is history, not a forecast.`);
  const warns = r.checks.filter((x) => x.tone === 'warn').map((x) => `${x.label.toLowerCase()} (${x.value.toLowerCase()})`);
  if (c.flags.serviceChargeConfirmed === false) warns.push('the service charge is our estimate, not the listing’s');
  if (c.flags.shortLease) warns.push('the lease is short');
  if (warns.length > 0) out.push(`Check before you offer: ${warns.join('; ')}.`);
  return out;
}

export function buildBtlReport(input: Omit<BtlReport, 'summary' | 'v' | 'createdAt' | 'checks'> & { createdAt: string; dueDiligence: DueDiligence | null }): BtlReport {
  const { dueDiligence, createdAt, ...rest } = input;
  const base = { ...rest, checks: reportChecks(rest.card, dueDiligence) };
  return { v: BTL_REPORT_VERSION, createdAt, ...base, summary: reportSummary(base) };
}

/** A stored report back; null when it is not one this version can draw. */
export function parseBtlReport(raw: unknown): BtlReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== BTL_REPORT_VERSION || typeof r.title !== 'string' || typeof r.price !== 'number') return null;
  const card = parseBtlCard(r.card);
  if (!card || !Array.isArray(r.summary) || !Array.isArray(r.checks)) return null;
  return { ...(r as unknown as BtlReport), card };
}

/** "3-bed house in B44". */
export function reportTitle(bedrooms: number | null, kind: ListingKind, outcode: string | null): string {
  const beds = bedrooms !== null && bedrooms > 0 ? `${bedrooms}-bed ` : '';
  return `${beds}${kind === 'unknown' ? 'home' : kind}${outcode ? ` in ${outcode}` : ''}`;
}
