/**
 * How /admin/weekly-active (and the headline on /admin) words and shapes the
 * figures from metrics.ts: the table cells, the trend's points and which
 * members the drill-down lists. Every percentage is shown with its counts.
 *
 * Pure: no network, no database, no server-only.
 */
import type { BillingCategory } from './billing.ts';
import { formatDuration, pct, ratio, TARGET_ALL, TARGET_PAYING, type MemberRow, type MemberWeek, type Share, type WeekMetrics } from './metrics.ts';
import { ukWeekRange } from './week.ts';

export const CATEGORY_LABELS: Record<BillingCategory, string> = {
  paying: 'Paying',
  paused: 'Paused',
  cancelled: 'Cancelled',
  never_paid: 'Never paid',
};

export type GroupKey = 'members' | 'paying' | 'activePaying' | 'paused' | 'cancelled';

export interface Group {
  key: GroupKey;
  title: string;
  /** Percent, or null: shown, with no target. */
  target: number | null;
  /** Who is in the group, in a line. */
  who: string;
}

export const GROUPS: readonly Group[] = [
  { key: 'members', title: 'All members', target: Math.round(TARGET_ALL * 100), who: 'Every account, counted from the week it joined.' },
  { key: 'paying', title: 'Paying', target: Math.round(TARGET_PAYING * 100), who: 'Has paid real money: a subscription that charged, or a card top-up, not refunded.' },
  {
    key: 'activePaying',
    title: 'Active paying',
    target: Math.round(TARGET_PAYING * 100),
    who: 'Paying, paid in the last 90 days (a live subscription counts), and did something in the 30 days to the week’s end.',
  },
  { key: 'paused', title: 'Paused', target: null, who: 'Inside a pause.' },
  { key: 'cancelled', title: 'Cancelled', target: null, who: 'Subscription ended, and not paid since.' },
];

/** The three groups with a target: the headline and the trend. */
export const HEADLINE_GROUPS: readonly Group[] = GROUPS.filter((g) => g.target !== null);

/** "42% · 8 of 19", or "—" when nobody is in the group. */
export function shareCell(s: Share): string {
  return s.base === 0 ? '—' : `${pct(s)} · ${s.active} of ${s.base}`;
}

/** Whole-number percent, or null with nobody to divide by. */
export function sharePercent(s: Share): number | null {
  const r = ratio(s.active, s.base);
  return r === null ? null : Math.round(r * 100);
}

/** Whether a share meets its target: null when there is no target or nobody to count. */
export function onTarget(s: Share, target: number | null): boolean | null {
  const p = sharePercent(s);
  return target === null || p === null ? null : p >= target;
}

function oneDecimal(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Visits per active member: "2.4". */
export function visitsPerActive(w: WeekMetrics): string {
  return w.visits ? oneDecimal(ratio(w.visits.byActive, w.members.active)) : '—';
}

/** Actions per visit: "5.1". */
export function actionsPerVisit(w: WeekMetrics): string {
  return w.visits ? oneDecimal(ratio(w.visits.actions, w.visits.total)) : '—';
}

/** Median time per visit: "3 min 20 s". */
export function medianVisit(w: WeekMetrics): string {
  return w.visits ? formatDuration(w.visits.medianSeconds) : '—';
}

/** Reports per active member: "0.8". */
export function reportsPerActive(w: WeekMetrics): string {
  return w.members.active === 0 ? '—' : oneDecimal(ratio(w.reports.byActive, w.members.active));
}

/**
 * Deals opened that week with a report on the same deal within 14 days,
 * over the opens old enough to have had their 14 days. Younger opens are
 * still counting and are said so, never counted as misses.
 */
export function openToReport(w: WeekMetrics): { value: string; note: string | null } {
  const o = w.openToReport;
  if (o.opens === 0) return { value: '—', note: null };
  if (o.matured === 0) return { value: 'still counting', note: `${o.opens} ${o.opens === 1 ? 'open' : 'opens'} under 14 days old` };
  const value = shareCell({ base: o.matured, active: o.reportedMatured });
  const young = o.opens - o.matured;
  return { value, note: young > 0 ? `${young} more still counting` : null };
}

/** Kept ÷ shown on the Today lists the members viewed: "20% · 3 of 15". */
export function keepRate(w: WeekMetrics): string {
  return w.keep && w.keep.shown > 0 ? shareCell({ base: w.keep.shown, active: w.keep.kept }) : '—';
}

/** Said beside a week the live log does not fully cover. */
export function trackingNote(w: WeekMetrics): string | null {
  if (w.tracked === 'none') return 'Backfilled history only (undercounts)';
  if (w.tracked === 'partial') return 'Live tracking started this week';
  return null;
}

// ── The trend (TrendChart.tsx) ──

export interface TrendPoint {
  /** "22 Sept": the week's Monday. */
  label: string;
  /** Percent active, or null where nothing is plotted (before live tracking, or nobody in the group). */
  pct: number | null;
  active: number;
  base: number;
  current: boolean;
  tracked: WeekMetrics['tracked'];
}

export interface TrendPanel {
  title: string;
  target: number;
  points: TrendPoint[];
}

/** One panel per headline group; weeks before live tracking carry no point. */
export function trendPanels(weeks: readonly WeekMetrics[]): TrendPanel[] {
  return HEADLINE_GROUPS.map((g) => ({
    title: g.title,
    target: g.target ?? 0,
    points: weeks.map((w) => {
      const s = w[g.key];
      return { label: w.label, pct: w.tracked === 'none' ? null : sharePercent(s), active: s.active, base: s.base, current: w.current, tracked: w.tracked };
    }),
  }));
}

// ── The drill-down ──

/** Members who did anything in the drill-down weeks, or everyone with `all`. */
export function drillMembers(rows: readonly MemberRow[], all: boolean): MemberRow[] {
  return all ? [...rows] : rows.filter((r) => r.weeks.some((w) => w.active || w.visits > 0 || w.actions > 0));
}

/**
 * A member's drill-down weeks, each marked with whether the account existed
 * by the week's end: a week before they joined is not a week they missed.
 */
export function memberWeeks(row: MemberRow): (MemberWeek & { member: boolean })[] {
  const joined = row.joined ? Date.parse(row.joined) : Number.NaN;
  return row.weeks.map((w) => ({ ...w, member: !Number.isFinite(joined) || joined < ukWeekRange(w.week).end.getTime() }));
}
