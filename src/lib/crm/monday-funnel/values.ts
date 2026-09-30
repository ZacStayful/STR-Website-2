/**
 * The Monday funnel's column values (Batch 20, Part F): what a member's row
 * should say, what it says now, and the difference, which is all that is
 * ever written. Pure.
 *
 * Never written: Monday's formulas, the old Status and Site Visits, the
 * Reports PDFs (config.ts NEVER_WRITTEN). Written once, only while empty:
 * Name, Email, Mobile, Signed up and First payment. For a plan set by hand
 * with no tier, Plan, Total paid and Monthly value are left as they are.
 * Nothing written carries an address, a postcode, a listing link or a deal
 * figure: these are the member's own facts.
 */
import { ukDay } from '../../activity/week.ts';
import { COLUMNS, COLUMN_TYPES, NEXT_DEAL_LABELS, NO_PLAN_LABEL, PLAN_LABELS, ROUTE_LABELS, SET_ONCE, type ColumnKey } from './config.ts';
import type { MemberFacts } from './facts.ts';
import { billingStatus } from './precedence.ts';

/** A column's value, normalised: text and labels as strings, numbers as numbers, dates as YYYY-MM-DD, ticks as booleans; null is empty. */
export type Cell = string | number | boolean | null;
export type Row = Partial<Record<ColumnKey, Cell>>;

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ukDay(new Date(t)) : null;
}

const money = (pence: number) => Math.round(pence) / 100;

/** The Plan column: the live (or paused) plan's name, else "Pay as you go". */
export function planLabel(f: Pick<MemberFacts, 'planStatus' | 'planCode'>): string {
  if (f.planStatus === 'paid' || f.planStatus === 'subscription_trial' || f.planStatus === 'paused') return (f.planCode && PLAN_LABELS[f.planCode]) || f.planCode || NO_PLAN_LABEL;
  return NO_PLAN_LABEL;
}

/** Cancel date (F7): the day the plan stops, the booked end or when it ended. Never cleared. */
export function cancelDay(f: Pick<MemberFacts, 'cancelAt' | 'endedAt'>): string | null {
  return day(f.cancelAt) ?? day(f.endedAt);
}

/** What the member's row should say. A column left out is not the site's to write for this member. */
export function desiredRow(f: MemberFacts, lowCreditPence: number): Row {
  const row: Row = {
    name: f.name?.trim() || null,
    email: f.email?.trim() || null,
    mobile: f.mobile?.trim() || null,
    signedUp: day(f.createdAt),
    firstPayment: day(f.firstPaidAt),
    topups: f.topups,
    route: f.packBoughtAt ? ROUTE_LABELS.pack : ROUTE_LABELS.free,
    nextDeal: (f.nextDeal && NEXT_DEAL_LABELS[f.nextDeal]) || null,
    credit: money(f.balancePence),
    lastTopup: day(f.lastTopupAt),
    billingStatus: billingStatus(f, lowCreditPence) || null,
    hitZero: day(f.hitZeroAt),
    lastActive: day(f.lastActiveDay),
    activeDays: f.activeDays,
    activeWeeks: f.activeWeeks,
    adSource: f.adSource,
    emailOk: f.emailOk,
    smsOk: f.smsOk,
    reengageSince: day(f.reengageSince),
  };
  if (!f.manualNoTier) {
    row.plan = planLabel(f);
    row.totalPaid = money(f.totalPaidPence);
    row.monthlyValue = money(f.monthlyValuePence);
  }
  const cancel = cancelDay(f);
  if (cancel) row.cancelDate = cancel;
  return row;
}

/** A Monday column value as it comes back from the API: its display text and raw JSON. */
export interface RawColumn {
  id: string;
  text: string | null;
  value: string | null;
}

function parse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The row's current values, normalised as desiredRow's. */
export function currentRow(columns: readonly RawColumn[]): Row {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const row: Row = {};
  for (const [key, id] of Object.entries(COLUMNS) as [ColumnKey, string][]) {
    const c = byId.get(id);
    if (!c) continue;
    const text = (c.text ?? '').trim();
    switch (COLUMN_TYPES[key]) {
      case 'text':
      case 'status':
        row[key] = text || null;
        break;
      case 'numbers': {
        const n = text === '' ? Number.NaN : Number(text.replace(/,/g, ''));
        row[key] = Number.isFinite(n) ? n : null;
        break;
      }
      case 'date': {
        const d = parse(c.value)?.date;
        row[key] = typeof d === 'string' && d ? d : text ? text.slice(0, 10) : null;
        break;
      }
      case 'checkbox': {
        const checked = parse(c.value)?.checked;
        row[key] = checked === true || checked === 'true';
        break;
      }
    }
  }
  return row;
}

function same(key: ColumnKey, a: Cell | undefined, b: Cell | undefined): boolean {
  const type = COLUMN_TYPES[key];
  if (type === 'checkbox') return Boolean(a) === Boolean(b);
  const empty = (v: Cell | undefined) => v === null || v === undefined || v === '';
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (type === 'numbers') return Math.abs(Number(a) - Number(b)) < 0.005;
  return String(a).trim() === String(b).trim();
}

/** The value as Monday's change_multiple_column_values takes it; null clears. */
export function mondayValue(key: ColumnKey, v: Cell): unknown {
  if (v === null || v === '') return null;
  switch (COLUMN_TYPES[key]) {
    case 'text':
      return String(v);
    case 'numbers':
      return String(v);
    case 'date':
      return { date: String(v) };
    case 'status':
      return { label: String(v) };
    case 'checkbox':
      return v ? { checked: 'true' } : null;
  }
}

/**
 * The columns to write: those whose value differs, the set-once ones only
 * while the row has none. `current` null is a row being created.
 */
export function changedColumns(current: Row | null, desired: Row): Partial<Record<ColumnKey, Cell>> {
  const out: Partial<Record<ColumnKey, Cell>> = {};
  for (const key of Object.keys(desired) as ColumnKey[]) {
    const want = desired[key] ?? null;
    const have = current ? current[key] : undefined;
    if (SET_ONCE.has(key)) {
      const empty = have === null || have === undefined || have === '';
      if (want !== null && empty) out[key] = want;
      continue;
    }
    if (current === null) {
      if (want !== null && want !== false) out[key] = want;
      continue;
    }
    if (!same(key, have, want)) out[key] = want;
  }
  return out;
}

/** The JSON for change_multiple_column_values / create_item, keyed by column id. */
export function columnValuesJson(changes: Partial<Record<ColumnKey, Cell>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(changes) as [ColumnKey, Cell][]) out[COLUMNS[key]] = mondayValue(key, v);
  return out;
}
