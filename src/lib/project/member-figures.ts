/**
 * A member's own working on a Project deal (Part G): our lines with their
 * changes (quantity, cost a unit, needed or not) and up to 20 lines of their
 * own, worked out with exactly the sums the estimate was (estimate.ts
 * evaluateLines), in the browser as they type and again on the server when
 * they save or lock. Private to the member: never shown to anyone else and
 * never used to change our estimate.
 *
 * A line of their own counts at cost in the value after works (like a
 * hidden fix), never twice over: adding a line can never make a deal look
 * better than the works it pays for.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AuctionTerms } from '../deal-quality/auction.ts';
import type { TaxCountry, TaxName } from '../listing/stamp-duty.ts';
import type { ProjectSettings } from './config.ts';
import type { LineStatus, ProjectLevel, WorksLine } from './costing.ts';
import { evaluateLines, type Evaluation, type ProjectEstimate } from './estimate.ts';
import type { Ceiling } from './value.ts';

export const MAX_OWN_LINES = 20;
export const OWN_LABEL_MAX = 60;
export const MAX_QUANTITY = 999;
export const MAX_UNIT_COST = 250_000;
const OWN_KEY = /^own-\d{1,3}$/;
const STATUSES: readonly LineStatus[] = ['needed', 'not_needed', 'cant_tell'];

export type CleanLines = { ok: true; lines: WorksLine[] } | { ok: false; error: 'not_a_list' | 'too_many_own_lines' | 'bad_line' };

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

function cleanLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Letters, numbers and ordinary punctuation; no control characters, no markup.
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length === 0 ? null : s.slice(0, OWN_LABEL_MAX);
}

/**
 * The member's lines made safe against our estimate's. Our lines keep their
 * label, unit, value role, reason and photos; only the quantity (0–999), the
 * cost a unit (£0–£250,000) and the status change. A line missing from what
 * was sent stays as we had it; a key we do not know is ignored. Their own
 * lines ("own-<n>") need a label, and there are at most 20.
 */
export function cleanMemberLines(raw: unknown, base: readonly WorksLine[]): CleanLines {
  if (!Array.isArray(raw)) return { ok: false, error: 'not_a_list' };
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'bad_line' };
    const r = item as Record<string, unknown>;
    if (typeof r.key !== 'string' || byKey.has(r.key)) return { ok: false, error: 'bad_line' };
    byKey.set(r.key, r);
  }
  const edit = (r: Record<string, unknown> | undefined, from: { quantity: number; unitCost: number; status: LineStatus }) => {
    if (!r) return from;
    const q = finite(r.quantity);
    const c = finite(r.unitCost);
    const quantity = q === null ? from.quantity : Math.round(Math.min(MAX_QUANTITY, Math.max(0, q)) * 100) / 100;
    const unitCost = c === null ? from.unitCost : Math.round(Math.min(MAX_UNIT_COST, Math.max(0, c)));
    const status = STATUSES.includes(r.status as LineStatus) ? (r.status as LineStatus) : from.status;
    return { quantity, unitCost, status };
  };
  const lines: WorksLine[] = base.map((b) => ({ ...b, photos: [...b.photos], ...edit(byKey.get(b.key), b) }));
  const own = [...byKey.entries()].filter(([k]) => OWN_KEY.test(k));
  if (own.length > MAX_OWN_LINES) return { ok: false, error: 'too_many_own_lines' };
  for (const [key, r] of own) {
    const label = cleanLabel(r.label);
    if (!label) return { ok: false, error: 'bad_line' };
    lines.push({ key, label, unit: 'job', valueRole: 'hidden', reason: null, photos: [], own: true, ...edit(r, { quantity: 1, unitCost: 0, status: 'needed' }) });
  }
  // Keys that are neither ours nor theirs are simply not read.
  return { ok: true, lines };
}

/** The tax a stored estimate was worked out under, as the nation it came from. */
export function countryOfTax(taxName: TaxName): TaxCountry {
  if (taxName === 'LTT') return 'wales';
  if (taxName === 'LBTT') return 'scotland';
  return 'england';
}

/** What the member's working needs besides their lines: all from the stored estimate, the card and the settings. */
export interface MemberContext {
  price: number;
  bedrooms: number;
  level: ProjectLevel;
  country: TaxCountry;
  ceiling: Ceiling | null;
  settings: ProjectSettings;
  bridging?: AuctionTerms;
}

export function memberContextFrom(estimate: ProjectEstimate, bedrooms: number, settings: ProjectSettings, bridging?: AuctionTerms): MemberContext {
  return { price: estimate.finance.price, bedrooms, level: estimate.level, country: countryOfTax(estimate.finance.taxName), ceiling: estimate.value.ceiling, settings, bridging };
}

/** The member's lines worked out: the same sums as our estimate, at our level (the photos' rating) and ceiling. */
export function evaluateMember(lines: readonly WorksLine[], ctx: MemberContext): Evaluation {
  return evaluateLines({ price: ctx.price, facts: { bedrooms: ctx.bedrooms, bathrooms: null, propertyKind: 'house', floorAreaSqft: null }, country: ctx.country, level: ctx.level, lines: [...lines], ceiling: ctx.ceiling, settings: ctx.settings, bridging: ctx.bridging });
}

/** The figures kept with each saved version (numbers only, for the admin's learning view and the report). */
export interface MemberFigures {
  level: ProjectLevel;
  worksLow: number;
  worksHigh: number;
  value: number;
  valueAdded: number;
  valueAddedPct: number;
  passes: boolean;
  cashLow: number;
  cashHigh: number;
  moneyLeftInLow: number | null;
  moneyLeftInHigh: number | null;
  ownLines: number;
  changedLines: number;
}

export function memberFiguresFrom(e: Evaluation, base: readonly WorksLine[]): MemberFigures {
  const baseByKey = new Map(base.map((b) => [b.key, b]));
  const changed = e.lines.filter((l) => {
    const b = baseByKey.get(l.key);
    return b !== undefined && (b.quantity !== l.quantity || b.unitCost !== l.unitCost || b.status !== l.status);
  }).length;
  return {
    level: e.level,
    worksLow: e.works.low,
    worksHigh: e.works.high,
    value: e.value.value,
    valueAdded: e.test.valueAdded,
    valueAddedPct: e.test.valueAddedPct,
    passes: e.test.passes,
    cashLow: e.finance.cash.low,
    cashHigh: e.finance.cash.high,
    moneyLeftInLow: e.finance.refinance?.moneyLeftIn.low ?? null,
    moneyLeftInHigh: e.finance.refinance?.moneyLeftIn.high ?? null,
    ownLines: e.lines.filter((l) => l.own).length,
    changedLines: changed,
  };
}

/** The next "own-<n>" key for a line the member adds. */
export function nextOwnKey(lines: readonly Pick<WorksLine, 'key'>[]): string {
  const used = lines.map((l) => /^own-(\d+)$/.exec(l.key)?.[1]).filter((x): x is string => Boolean(x)).map(Number);
  return `own-${(used.length ? Math.max(...used) : 0) + 1}`;
}
