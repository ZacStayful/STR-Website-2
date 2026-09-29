/**
 * The project in a Full analysis (Batch 17, Part F). A Project deal's report
 * carries our estimate as it stood when the analysis ran (stored on the
 * report, which only a member whose account opened the deal can buy), and,
 * never stored, the figures the viewer locked on the deal sheet beside it:
 * the web report and its PDF read them for whoever is looking, so a
 * teammate who can read the report never sees another member's figures.
 *
 * Photos and photo numbers are left out: a report is kept and downloaded,
 * and the listing's photos are analysed, never republished. The reasons
 * stay (the member opened the deal to buy the analysis).
 *
 * Pure: no network, no database, no server-only.
 */
import { lineCost, type LineStatus, type ProjectLevel } from './costing.ts';
import type { ProjectEstimate } from './estimate.ts';
import type { MemberFigures } from './member-figures.ts';

export const REPORT_PROJECT_VERSION = 1;

export interface Span {
  low: number;
  high: number;
}

export interface ReportProjectLine {
  label: string;
  quantity: number;
  unitCost: number;
  cost: number;
  status: Exclude<LineStatus, 'not_needed'>;
  reason: string | null;
}

export interface ReportProject {
  v: typeof REPORT_PROJECT_VERSION;
  estimatedAt: string;
  level: ProjectLevel;
  /** Needed and can't-tell lines, in the estimate's order. */
  lines: ReportProjectLine[];
  /** The lines the photos say are not needed, by name. */
  notNeeded: string[];
  works: Span & { contingencyPct: number; neededLines: number; cantTellLines: number };
  value: number;
  /** The sold prices that capped the value, when they did. */
  ceiling: { sales: number; radiusMiles: number } | null;
  valueAdded: number;
  valueAddedPct: number;
  finance: {
    price: number;
    taxName: string;
    stampDuty: number;
    buyingCosts: number;
    months: number;
    holding: Span;
    furnishing: number;
    totalIn: Span;
    cash: Span;
    bridge: { loan: number; ltvPct: number; monthlyPct: number; arrangementFee: number } | null;
    refinance: { pct: number; loan: number; moneyLeftIn: Span } | null;
  };
  /** The monthly profit once the works are done, on this report's own income at the buyer's finance; null without one. */
  profitAfterWorksPcm: number | null;
}

/** The viewer's locked figures, for the report they are looking at. Never stored on a report. */
export interface ReportProjectMine {
  version: number;
  lockedAt: string;
  works: Span;
  value: number;
  valueAdded: number;
  valueAddedPct: number;
  passes: boolean;
  cash: Span;
  moneyLeftIn: Span | null;
  changedLines: number;
  ownLines: number;
}

const whole = (n: number) => Math.round(n);

export function reportProjectFrom(e: ProjectEstimate, estimatedAt: string, profitAfterWorksPcm: number | null): ReportProject {
  const f = e.finance;
  return {
    v: REPORT_PROJECT_VERSION,
    estimatedAt,
    level: e.level,
    lines: e.lines
      .filter((l) => l.status !== 'not_needed')
      .map((l) => ({ label: l.label, quantity: l.quantity, unitCost: l.unitCost, cost: whole(lineCost(l)), status: l.status as Exclude<LineStatus, 'not_needed'>, reason: l.reason ?? null })),
    notNeeded: e.lines.filter((l) => l.status === 'not_needed').map((l) => l.label),
    works: { low: e.works.low, high: e.works.high, contingencyPct: e.works.contingencyPct, neededLines: e.works.neededLines, cantTellLines: e.works.cantTellLines },
    value: e.value.value,
    ceiling: e.value.ceilingApplied && e.value.ceiling ? { sales: e.value.ceiling.sales, radiusMiles: e.value.ceiling.radiusMiles } : null,
    valueAdded: e.test.valueAdded,
    valueAddedPct: e.test.valueAddedPct,
    finance: {
      price: f.price,
      taxName: f.taxName,
      stampDuty: f.stampDuty,
      buyingCosts: f.buyingCosts,
      months: f.months,
      holding: { ...f.holding },
      furnishing: f.furnishing,
      totalIn: { ...f.totalIn },
      cash: { ...f.cash },
      bridge: f.bridge ? { loan: f.bridge.loan, ltvPct: f.bridge.ltvPct, monthlyPct: f.bridge.monthlyPct, arrangementFee: f.bridge.arrangementFee } : null,
      refinance: f.refinance ? { pct: f.refinance.pct, loan: f.refinance.loan, moneyLeftIn: { ...f.refinance.moneyLeftIn } } : null,
    },
    profitAfterWorksPcm: profitAfterWorksPcm !== null && Number.isFinite(profitAfterWorksPcm) ? whole(profitAfterWorksPcm) : null,
  };
}

export function reportProjectMineFrom(f: MemberFigures, version: number, lockedAt: string): ReportProjectMine {
  return {
    version,
    lockedAt,
    works: { low: f.worksLow, high: f.worksHigh },
    value: f.value,
    valueAdded: f.valueAdded,
    valueAddedPct: f.valueAddedPct,
    passes: f.passes,
    cash: { low: f.cashLow, high: f.cashHigh },
    moneyLeftIn: f.moneyLeftInLow !== null && f.moneyLeftInHigh !== null ? { low: f.moneyLeftInLow, high: f.moneyLeftInHigh } : null,
    changedLines: f.changedLines,
    ownLines: f.ownLines,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSpan = (v: unknown): v is Span => isObj(v) && isNum(v.low) && isNum(v.high);

/**
 * A report's stored project, checked for the shape the report reads; null
 * when it is absent or not that shape (an older report, a hand-edited row),
 * and the report then simply has no project section.
 */
export function parseReportProject(raw: unknown): ReportProject | null {
  if (!isObj(raw) || raw.v !== REPORT_PROJECT_VERSION || (raw.level !== 'light' && raw.level !== 'full')) return null;
  if (typeof raw.estimatedAt !== 'string' || !Array.isArray(raw.lines) || !Array.isArray(raw.notNeeded)) return null;
  if (!isSpan(raw.works) || !isNum(raw.value) || !isNum(raw.valueAdded) || !isNum(raw.valueAddedPct)) return null;
  const f = raw.finance;
  if (!isObj(f) || !isNum(f.price) || !isNum(f.stampDuty) || !isNum(f.buyingCosts) || !isNum(f.months) || !isNum(f.furnishing)) return null;
  if (!isSpan(f.holding) || !isSpan(f.totalIn) || !isSpan(f.cash)) return null;
  for (const l of raw.lines) {
    if (!isObj(l) || typeof l.label !== 'string' || !isNum(l.quantity) || !isNum(l.unitCost) || !isNum(l.cost)) return null;
    if (l.status !== 'needed' && l.status !== 'cant_tell') return null;
  }
  return raw as unknown as ReportProject;
}

export function parseReportProjectMine(raw: unknown): ReportProjectMine | null {
  if (!isObj(raw) || !isNum(raw.version) || typeof raw.lockedAt !== 'string') return null;
  if (!isSpan(raw.works) || !isNum(raw.value) || !isNum(raw.valueAdded) || !isNum(raw.valueAddedPct) || !isSpan(raw.cash)) return null;
  if (raw.moneyLeftIn !== null && !isSpan(raw.moneyLeftIn)) return null;
  return raw as unknown as ReportProjectMine;
}

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;

/** "£14,300–£26,100", or one figure when the ends meet. */
export function spanLabel(s: Span): string {
  return Math.round(s.low) === Math.round(s.high) ? gbp(s.high) : `${gbp(s.low)}–${gbp(s.high)}`;
}

/** One line of the working as the report prints it: "4 × £250". */
export function quantityLabel(l: Pick<ReportProjectLine, 'quantity' | 'unitCost'>): string {
  return `${Number.isInteger(l.quantity) ? l.quantity : l.quantity.toFixed(1)} × ${gbp(l.unitCost)}`;
}

/** Under the value: why it is what it is. */
export function valueBasis(p: Pick<ReportProject, 'ceiling'>): string {
  return p.ceiling ? `Capped by nearby sold prices: ${p.ceiling.sales} sales within ${p.ceiling.radiusMiles} miles` : 'The price, twice the visible works and the rest at cost';
}

/** How the viewer's locked figures compare with ours, in one line. */
export function mineVersusOurs(ours: Pick<ReportProject, 'works' | 'valueAdded'>, mine: ReportProjectMine): string {
  const worksDiff = mine.works.high - ours.works.high;
  const addedDiff = mine.valueAdded - ours.valueAdded;
  const works = Math.abs(worksDiff) < 1 ? 'the same works as ours' : `works ${gbp(Math.abs(worksDiff))} ${worksDiff > 0 ? 'above' : 'below'} ours at the high end`;
  const added = Math.abs(addedDiff) < 1 ? 'the same value added' : `value added ${gbp(Math.abs(addedDiff))} ${addedDiff > 0 ? 'more' : 'less'}`;
  return `Your locked figures (version ${mine.version}): ${works}, ${added}${mine.passes ? '' : ', under the bar'}.`;
}
