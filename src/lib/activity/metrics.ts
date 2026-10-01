/**
 * The weekly-active figures on /admin/weekly-active, from what the database
 * grouped (public.activity_weekly_facts). The database only counts; every
 * rule is here, so it is tested:
 *
 *   - a week is Monday to Sunday, UK time (week.ts)
 *   - a member counts from the week they signed up; every account counts
 *   - admin (ADMIN_EMAILS), @stayful.co.uk and switched-off accounts are left
 *     out of every figure, as the member and as the base
 *   - weekly active: at least one qualifying action in the week (kinds.ts)
 *   - billing groups are judged at the end of each week, or now for the week
 *     in progress (billing.ts); a team member is in their owner's group
 *   - Active paying: paying, paid in the last 90 days (a live subscription
 *     counts), and a qualifying action in the 30 days to the week's end
 *
 * Pure: no network, no database, no server-only.
 */
import { billingAt, type BillingCategory, type BillingFacts } from './billing.ts';
import { kindLabel } from './kinds.ts';
import { addDays, daysEnding, ukDay, ukWeekRange, weekDays, weekLabel } from './week.ts';
import { emailKey } from '../supabase/email-key.ts';

// ── What the database sends ──

export interface FactMember {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string | null;
  plan: string | null;
  plan_code: string | null;
  plan_source: string | null;
  status: string | null;
  sub_started: string | null;
  sub_ended: string | null;
  paused_from: string | null;
  paused_until: string | null;
  owner: string | null;
  /**
   * auth.users.last_sign_in_at is set: the account confirmed its email (or was
   * signed in by a magic link) at least once. Absent from facts made before the
   * Batch 21 schema, when every sign-up form counted as a member.
   */
  signed_in?: boolean | null;
}

export interface WeeklyFacts {
  now: string;
  first_week: string;
  this_week: string;
  weeks: number;
  tracking_since: string | null;
  visits_since: string | null;
  members: FactMember[];
  excluded: { u: string; reason: string | null }[];
  payments: { u: string; first: string | null; before: string | null; list: string[] }[];
  sub_events: { u: string; k: string; at: string }[];
  qdays: { u: string; d: string[] }[];
  weekly: { u: string; w: string; c: number; r: number }[];
  visits: { u: string; w: string; n: number; a: number; s: number[] }[];
  opens: { u: string; w: string; n: number; m: number; c: number; cm: number }[];
  today: { u: string; w: string; shown: number; kept: number }[];
  last: { u: string; k: string; at: string }[];
}

/** An empty set of facts, for when the schema has not been run yet. */
export function emptyFacts(now: Date, thisWeek: string, weeks: number): WeeklyFacts {
  return {
    now: now.toISOString(),
    first_week: addDays(thisWeek, -(weeks - 1) * 7),
    this_week: thisWeek,
    weeks,
    tracking_since: null,
    visits_since: null,
    members: [],
    excluded: [],
    payments: [],
    sub_events: [],
    qdays: [],
    weekly: [],
    visits: [],
    opens: [],
    today: [],
    last: [],
  };
}

// ── What the page shows ──

/** A share: `active` of `base`. The page shows both counts beside the %. */
export interface Share {
  base: number;
  active: number;
}

export interface WeekMetrics {
  week: string;
  label: string;
  /** The week in progress. */
  current: boolean;
  /**
   * How much of the week live tracking covers: 'none' (before it started:
   * backfilled history only), 'partial' (it started during the week), 'full'.
   */
  tracked: 'none' | 'partial' | 'full';
  members: Share;
  paying: Share;
  activePaying: Share;
  paused: Share;
  cancelled: Share;
  /** Null for weeks before visits were recorded. */
  visits: { total: number; byActive: number; actions: number; medianSeconds: number | null } | null;
  openToReport: { opens: number; matured: number; reported: number; reportedMatured: number };
  reports: { total: number; byActive: number };
  /** Null for weeks before Today views were recorded. */
  keep: { shown: number; kept: number } | null;
}

/** Why an account's own details leave it out of every figure (exclusionFor). */
export type AccountExclusion = 'admin' | 'staff' | 'manual';
/** AccountExclusion, plus the sign-up that never signed in (Batch 21, E3): only the weekly-active base applies it. */
export type ExclusionReason = AccountExclusion | 'never_signed_in';

export interface MemberWeek {
  week: string;
  active: boolean;
  visits: number;
  actions: number;
}

export interface MemberRow {
  id: string;
  email: string | null;
  name: string | null;
  joined: string | null;
  category: BillingCategory;
  paidRecently: boolean;
  /** The drill-down weeks, oldest first. */
  weeks: MemberWeek[];
  lastAction: { kind: string; label: string; at: string } | null;
}

export interface ExcludedRow {
  id: string;
  email: string | null;
  name: string | null;
  reason: ExclusionReason;
  note: string | null;
}

export interface WeeklyActiveReport {
  weeks: WeekMetrics[];
  members: MemberRow[];
  excluded: ExcludedRow[];
  trackingSince: string | null;
  visitsSince: string | null;
}

export const STAFF_DOMAIN = 'stayful.co.uk';
export const DRILL_WEEKS = 8;
export const ACTIVE_WINDOW_DAYS = 30;
export const TARGET_ALL = 0.4;
export const TARGET_PAYING = 0.6;

// ── Rules ──

/** Why an account is left out of the figures, or null when it counts. */
export function exclusionFor(
  email: string | null,
  manualNote: string | null | undefined,
  adminEmails: ReadonlySet<string>,
  staffDomain: string = STAFF_DOMAIN,
): AccountExclusion | null {
  const key = email ? emailKey(email) : '';
  if (key && adminEmails.has(key)) return 'admin';
  if (key.endsWith(`@${staffDomain}`)) return 'staff';
  if (manualNote !== undefined) return 'manual';
  return null;
}

/** A / B, or null when there is nothing to divide by. */
export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function groupBy<T extends { u: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.u);
    if (list) list.push(r);
    else out.set(r.u, [r]);
  }
  return out;
}

function byUserWeek<T extends { u: string; w: string }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) out.set(`${r.u}|${r.w}`, r);
  return out;
}

/**
 * Everything on the page, from the facts. `adminEmails` are the addresses in
 * ADMIN_EMAILS (src/lib/admin.ts), passed in so this stays pure.
 */
export function computeWeeklyActive(facts: WeeklyFacts, opts: { adminEmails: readonly string[]; staffDomain?: string; drillWeeks?: number }): WeeklyActiveReport {
  const now = time(facts.now) ?? Date.now();
  const admins = new Set(opts.adminEmails.map(emailKey));
  const manual = new Map(facts.excluded.map((x) => [x.u, x.reason ?? null]));

  // ── Who counts ──
  const excluded: ExcludedRow[] = [];
  const included: FactMember[] = [];
  for (const m of facts.members) {
    // Batch 21 (E3): a sign-up that never confirmed its email is not a member
    // yet; it is listed as excluded, never counted in the base.
    const reason = exclusionFor(m.email, manual.get(m.id), admins, opts.staffDomain) ?? (m.signed_in === false ? 'never_signed_in' : null);
    if (reason) excluded.push({ id: m.id, email: m.email, name: m.name, reason, note: reason === 'manual' ? manual.get(m.id) ?? null : null });
    else included.push(m);
  }

  // ── Billing, by member (a team member is judged by their owner) ──
  const payments = new Map(facts.payments.map((p) => [p.u, p]));
  const subEvents = groupBy(facts.sub_events);
  const byId = new Map(facts.members.map((m) => [m.id, m]));
  const billingFacts = (m: FactMember): BillingFacts => ({
    createdAt: m.created_at,
    planSource: m.plan_source,
    status: m.status,
    subStarted: m.sub_started,
    subEnded: m.sub_ended,
    pausedFrom: m.paused_from,
    pausedUntil: m.paused_until,
    payments: { first: payments.get(m.id)?.first ?? null, before: payments.get(m.id)?.before ?? null, list: payments.get(m.id)?.list ?? [] },
    events: (subEvents.get(m.id) ?? []).map((e) => ({ k: e.k, at: e.at })),
  });
  const billingOf = (m: FactMember, at: Date) => {
    const owner = m.owner ? byId.get(m.owner) : undefined;
    return billingAt(billingFacts(owner ?? m), at);
  };

  // ── Activity, by member ──
  const qdays = new Map(facts.qdays.map((q) => [q.u, new Set(q.d)]));
  const weekly = byUserWeek(facts.weekly);
  const visits = byUserWeek(facts.visits);
  const opens = byUserWeek(facts.opens);
  const today = byUserWeek(facts.today);
  const last = new Map(facts.last.map((l) => [l.u, l]));

  const trackingSince = time(facts.tracking_since);
  const visitsSince = time(facts.visits_since);
  const weekStarts = Array.from({ length: Math.max(0, facts.weeks) }, (_, i) => addDays(facts.first_week, i * 7));

  const activeIn = (userId: string, days: readonly string[]): boolean => {
    const set = qdays.get(userId);
    return set ? days.some((d) => set.has(d)) : false;
  };

  const weeks: WeekMetrics[] = weekStarts.map((week) => {
    const { start, end } = ukWeekRange(week);
    const at = new Date(Math.min(end.getTime() - 1, now));
    const days = weekDays(week);
    const window30 = daysEnding(ukDay(at), ACTIVE_WINDOW_DAYS);

    const members: Share = { base: 0, active: 0 };
    const paying: Share = { base: 0, active: 0 };
    const activePaying: Share = { base: 0, active: 0 };
    const paused: Share = { base: 0, active: 0 };
    const cancelled: Share = { base: 0, active: 0 };
    let visitTotal = 0;
    let visitByActive = 0;
    let visitActions = 0;
    const durations: number[] = [];
    const o2r = { opens: 0, matured: 0, reported: 0, reportedMatured: 0 };
    const reports = { total: 0, byActive: 0 };
    const keep = { shown: 0, kept: 0 };

    for (const m of included) {
      const joined = time(m.created_at);
      if (joined !== null && joined > at.getTime()) continue;
      const active = activeIn(m.id, days);
      const bump = (s: Share) => {
        s.base += 1;
        if (active) s.active += 1;
      };
      bump(members);
      const billing = billingOf(m, at);
      if (billing.category === 'paying') {
        bump(paying);
        if (billing.paidRecently && activeIn(m.id, window30)) bump(activePaying);
      } else if (billing.category === 'paused') bump(paused);
      else if (billing.category === 'cancelled') bump(cancelled);

      const key = `${m.id}|${week}`;
      const v = visits.get(key);
      if (v) {
        visitTotal += v.n;
        visitActions += v.a;
        durations.push(...v.s);
        if (active) visitByActive += v.n;
      }
      const o = opens.get(key);
      if (o) {
        o2r.opens += o.n;
        o2r.matured += o.m;
        o2r.reported += o.c;
        o2r.reportedMatured += o.cm;
      }
      const w = weekly.get(key);
      if (w) {
        reports.total += w.r;
        if (active) reports.byActive += w.r;
      }
      const t = today.get(key);
      if (t) {
        keep.shown += t.shown;
        keep.kept += t.kept;
      }
    }

    const tracked: WeekMetrics['tracked'] =
      trackingSince === null || end.getTime() <= trackingSince ? 'none' : start.getTime() < trackingSince ? 'partial' : 'full';
    const hasVisits = visitsSince !== null && end.getTime() > visitsSince;
    return {
      week,
      label: weekLabel(week),
      current: week === facts.this_week,
      tracked,
      members,
      paying,
      activePaying,
      paused,
      cancelled,
      visits: hasVisits ? { total: visitTotal, byActive: visitByActive, actions: visitActions, medianSeconds: median(durations) } : null,
      openToReport: o2r,
      reports,
      keep: tracked === 'none' ? null : keep,
    };
  });

  // ── The drill-down ──
  const drill = weekStarts.slice(-(opts.drillWeeks ?? DRILL_WEEKS));
  const nowDate = new Date(now);
  const rows: MemberRow[] = included.map((m) => {
    const billing = billingOf(m, nowDate);
    const l = last.get(m.id);
    return {
      id: m.id,
      email: m.email,
      name: m.name,
      joined: m.created_at,
      category: billing.category,
      paidRecently: billing.paidRecently,
      weeks: drill.map((week) => {
        const key = `${m.id}|${week}`;
        return { week, active: activeIn(m.id, weekDays(week)), visits: visits.get(key)?.n ?? 0, actions: weekly.get(key)?.c ?? 0 };
      }),
      lastAction: l ? { kind: l.k, label: kindLabel(l.k), at: l.at } : null,
    };
  });
  rows.sort((a, b) => (time(b.lastAction?.at) ?? -Infinity) - (time(a.lastAction?.at) ?? -Infinity) || (a.email ?? '').localeCompare(b.email ?? ''));

  return { weeks, members: rows, excluded, trackingSince: facts.tracking_since, visitsSince: facts.visits_since };
}

/** "42%" (whole numbers; "—" when there is nothing to divide by). */
export function pct(share: Share): string {
  const r = ratio(share.active, share.base);
  return r === null ? '—' : `${Math.round(r * 100)}%`;
}

/** "3 min 20 s", "45 s", "1 h 5 min". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
