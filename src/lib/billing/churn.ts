/**
 * Churn, retention and income stability, derived from the subscription_events
 * log. Pure on purpose: every figure comes from the rows handed in, so this
 * module is unit tested with plain fixtures (churn.test.ts) and never imports
 * `server-only`. churn-server.ts does the reading.
 *
 * Two ideas carry the whole file:
 *
 *   A CYCLE is one unbroken paid spell. A member who leaves and comes back has
 *   two, so a win-back never flatters the first cohort's tenure.
 *
 *   A horizon is ANSWERABLE when we know the answer, which is not the same as
 *   "enough time has passed" — see retentionByHorizon.
 */

// ---------------------------------------------------------------
// Events in
// ---------------------------------------------------------------

export type SubEventKind =
  | 'started'
  | 'cancel_scheduled'
  | 'cancel_reverted'
  | 'ended'
  | 'paused'
  | 'resumed'
  | 'past_due'
  | 'recovered'
  | 'plan_changed';

export interface SubEvent {
  userId: string;
  at: string;
  kind: SubEventKind;
  cycleStartedAt: string | null;
  planCode: string | null;
  mrrPence: number | null;
  reason: string | null;
  reasonComment: string | null;
  source: string;
}

/** Live monthly price per plan code, injected so this file stays pure. */
export type PriceMap = Record<string, number>;

/**
 * A plan's monthly-equivalent price. An annual plan is divided down rather
 * than booked as a lump, so the revenue chart is not a sawtooth and an annual
 * subscriber is comparable against a monthly one.
 */
export function monthlyPence(plan: { pricePence: number; interval: 'month' | 'year' }): number {
  if (!Number.isFinite(plan.pricePence) || plan.pricePence <= 0) return 0;
  return plan.interval === 'year' ? Math.round(plan.pricePence / 12) : Math.round(plan.pricePence);
}

// ---------------------------------------------------------------
// Dates
// ---------------------------------------------------------------

/**
 * Calendar-month arithmetic, clamped to the end of a short month so that
 * 31 January plus one month is 28 February and not 3 March. Horizons are
 * months as a person counts them, not 30-day blocks.
 */
export function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

function days(from: string, to: string): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------

export type CycleState = 'active' | 'at_risk' | 'ended';

export interface Cycle {
  userId: string;
  startedAt: string;
  endedAt: string | null;
  planCode: string | null;
  mrrPence: number | null;
  reason: string | null;
  reasonComment: string | null;
  source: string;
  tenureDays: number;
  state: CycleState;
  /** Why it is at risk, for the at-risk table. */
  riskKind: 'past_due' | 'paused' | null;
  /** Reason captured on a pause or a scheduled cancel that has not landed. */
  intentReason: string | null;
  intentComment: string | null;
}

/**
 * Group events into cycles. A cycle is keyed by (user, cycleStartedAt): that is
 * what tells a win-back from a longer first spell. Events whose cycle cannot be
 * identified are attached to the user's only open cycle, which is how a
 * `past_due` that arrives before any `started` (a plan set up by hand, or a
 * backfill that saw the invoice but not the subscription) still counts.
 */
export function cyclesFromEvents(events: SubEvent[], now: Date = new Date()): Cycle[] {
  const nowIso = now.toISOString();
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));

  // user -> cycle key -> draft
  const byUser = new Map<string, Map<string, Cycle>>();
  const order: Cycle[] = [];

  const keyFor = (e: SubEvent): string => e.cycleStartedAt ?? '__unknown__';

  for (const e of sorted) {
    let cycles = byUser.get(e.userId);
    if (!cycles) {
      cycles = new Map();
      byUser.set(e.userId, cycles);
    }

    let key = keyFor(e);
    if (key === '__unknown__') {
      // Attach to the newest still-open cycle; otherwise open one at this event.
      const open = [...cycles.values()].filter((c) => c.endedAt === null).pop();
      key = open ? open.startedAt : e.at;
    }

    let cycle = cycles.get(key);
    if (!cycle) {
      cycle = {
        userId: e.userId,
        startedAt: e.cycleStartedAt ?? key,
        endedAt: null,
        planCode: e.planCode,
        mrrPence: e.mrrPence,
        reason: null,
        reasonComment: null,
        source: e.source,
        tenureDays: 0,
        state: 'active',
        riskKind: null,
        intentReason: null,
        intentComment: null,
      };
      cycles.set(key, cycle);
      order.push(cycle);
    }

    // The latest known plan and price win, so a plan_changed rewrites neither
    // history (each event keeps its own snapshot) nor the cycle's start.
    if (e.planCode !== null) cycle.planCode = e.planCode;
    if (e.mrrPence !== null) cycle.mrrPence = e.mrrPence;

    switch (e.kind) {
      case 'ended':
        // First end wins: a replayed delete must not move the date.
        if (cycle.endedAt === null) cycle.endedAt = e.at;
        // A reason on the end event beats one captured at scheduling time,
        // because it is the last thing we were told.
        if (e.reason) cycle.reason = e.reason;
        if (e.reasonComment) cycle.reasonComment = e.reasonComment;
        if (e.source) cycle.source = e.source;
        cycle.state = 'ended';
        cycle.riskKind = null;
        break;
      case 'cancel_scheduled':
        // Earliest intent wins — a second scheduling event for one cycle is a
        // replay, not a change of heart.
        if (cycle.intentReason === null && e.reason) cycle.intentReason = e.reason;
        if (cycle.intentComment === null && e.reasonComment) cycle.intentComment = e.reasonComment;
        if (cycle.reason === null && e.reason) cycle.reason = e.reason;
        if (cycle.reasonComment === null && e.reasonComment) cycle.reasonComment = e.reasonComment;
        break;
      case 'cancel_reverted':
        cycle.intentReason = null;
        cycle.intentComment = null;
        cycle.reason = null;
        cycle.reasonComment = null;
        break;
      case 'paused':
        if (cycle.state !== 'ended') {
          cycle.state = 'at_risk';
          cycle.riskKind = 'paused';
        }
        if (e.reason) cycle.intentReason = e.reason;
        if (e.reasonComment) cycle.intentComment = e.reasonComment;
        break;
      case 'past_due':
        if (cycle.state !== 'ended') {
          cycle.state = 'at_risk';
          cycle.riskKind = 'past_due';
        }
        break;
      case 'resumed':
      case 'recovered':
        if (cycle.state !== 'ended') {
          cycle.state = 'active';
          cycle.riskKind = null;
        }
        break;
      case 'started':
      case 'plan_changed':
        break;
    }
  }

  for (const c of order) c.tenureDays = days(c.startedAt, c.endedAt ?? nowIso);
  return order;
}

// ---------------------------------------------------------------
// Retention by horizon
// ---------------------------------------------------------------

export const HORIZONS = [1, 3, 6, 12] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HORIZON_LABELS: Record<Horizon, string> = {
  1: 'trial phase',
  3: 'less stable',
  6: 'quite stable',
  12: 'very stable',
};

export interface HorizonRetention {
  months: Horizon;
  /** Cycles whose outcome at this horizon is already known. */
  answerable: number;
  retained: number;
  churned: number;
  /** Still live and not yet old enough to ask. */
  maturing: number;
  /** null when nothing is answerable yet — never render this as 0%. */
  retentionPct: number | null;
  /** When the first maturing cycle reaches this horizon. */
  firstAnswerDue: string | null;
  label: string;
}

/**
 * Retention at each horizon.
 *
 * The rule that matters: a cycle is ANSWERABLE once we know the outcome, which
 * is true as soon as it ends — not only once the calendar passes the horizon.
 * A member who cancelled after six weeks answers the 3, 6 AND 12-month
 * questions immediately, because we know they did not reach any of them.
 * Waiting for the calendar would drop every early churn out of the long
 * horizons and report retention far higher than it is.
 */
export function retentionByHorizon(cycles: Cycle[], now: Date = new Date()): HorizonRetention[] {
  return HORIZONS.map((months) => {
    let retained = 0;
    let churned = 0;
    let maturing = 0;
    let due: number | null = null;

    for (const c of cycles) {
      const mark = addMonths(c.startedAt, months).getTime();
      if (c.endedAt !== null) {
        if (new Date(c.endedAt).getTime() < mark) churned += 1;
        else retained += 1;
      } else if (now.getTime() >= mark) {
        retained += 1;
      } else {
        maturing += 1;
        if (due === null || mark < due) due = mark;
      }
    }

    const answerable = retained + churned;
    return {
      months,
      answerable,
      retained,
      churned,
      maturing,
      retentionPct: answerable === 0 ? null : Math.round((retained / answerable) * 1000) / 10,
      firstAnswerDue: due === null ? null : new Date(due).toISOString(),
      label: HORIZON_LABELS[months],
    };
  });
}

export interface PlanRetention {
  planCode: string;
  cycles: number;
  rows: HorizonRetention[];
}

export function retentionByPlan(cycles: Cycle[], now: Date = new Date()): PlanRetention[] {
  const groups = new Map<string, Cycle[]>();
  for (const c of cycles) {
    const key = c.planCode ?? 'none';
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.entries()]
    .map(([planCode, list]) => ({ planCode, cycles: list.length, rows: retentionByHorizon(list, now) }))
    .sort((a, b) => b.cycles - a.cycles);
}

// ---------------------------------------------------------------
// Tenure bands and income stability
// ---------------------------------------------------------------

export type Stability = 'trial' | 'less stable' | 'quite stable' | 'very stable';

export interface TenureBand {
  key: string;
  label: string;
  /** Inclusive lower bound and exclusive upper bound, in months. */
  fromMonths: number;
  toMonths: number | null;
  stability: Stability;
}

/**
 * The bands the stability read is built on. 6–12 months counts as quite stable
 * income and 12+ as very stable; the first month is the trial phase and the
 * least reliable of all.
 */
export const TENURE_BANDS: TenureBand[] = [
  { key: '0-1', label: 'Under 1 month', fromMonths: 0, toMonths: 1, stability: 'trial' },
  { key: '1-3', label: '1–3 months', fromMonths: 1, toMonths: 3, stability: 'less stable' },
  { key: '3-6', label: '3–6 months', fromMonths: 3, toMonths: 6, stability: 'less stable' },
  { key: '6-12', label: '6–12 months', fromMonths: 6, toMonths: 12, stability: 'quite stable' },
  { key: '12+', label: '12 months or more', fromMonths: 12, toMonths: null, stability: 'very stable' },
];

/** Revenue in these bands is the "stable share" headline. */
const STABLE: Stability[] = ['quite stable', 'very stable'];

/** The band a cycle sits in at a given moment, by elapsed calendar months. */
export function bandFor(startedAt: string, asOf: Date): TenureBand {
  for (const band of TENURE_BANDS) {
    const from = addMonths(startedAt, band.fromMonths).getTime();
    const to = band.toMonths === null ? Infinity : addMonths(startedAt, band.toMonths).getTime();
    if (asOf.getTime() >= from && asOf.getTime() < to) return band;
  }
  return TENURE_BANDS[TENURE_BANDS.length - 1];
}

export interface BandRevenue {
  key: string;
  label: string;
  stability: Stability;
  customers: number;
  mrrPence: number;
  /** Of these, how many are past due or paused. */
  atRisk: number;
  atRiskMrrPence: number;
  sharePct: number;
}

export interface StabilitySummary {
  bands: BandRevenue[];
  mrrPence: number;
  stableMrrPence: number;
  stableSharePct: number | null;
  atRiskMrrPence: number;
  customers: number;
  atRisk: number;
  /** Cycles counted in retention but contributing no revenue (manual grants). */
  unpriced: number;
}

/**
 * Live monthly revenue split by how long the customer has been paying.
 *
 * A manually granted plan has no plan_code and therefore no price. It is
 * counted as a customer and reported in `unpriced`, but contributes £0 — which
 * is the truth, and better than inventing a number for it.
 */
export function revenueByTenureBand(cycles: Cycle[], asOf: Date = new Date(), prices: PriceMap = {}): StabilitySummary {
  const rows = new Map<string, BandRevenue>();
  for (const band of TENURE_BANDS) {
    rows.set(band.key, {
      key: band.key,
      label: band.label,
      stability: band.stability,
      customers: 0,
      mrrPence: 0,
      atRisk: 0,
      atRiskMrrPence: 0,
      sharePct: 0,
    });
  }

  let unpriced = 0;
  let atRisk = 0;
  let customers = 0;

  for (const c of cycles) {
    if (c.endedAt !== null) continue;
    const row = rows.get(bandFor(c.startedAt, asOf).key);
    if (!row) continue;
    const pence = c.mrrPence ?? (c.planCode ? (prices[c.planCode] ?? 0) : 0);
    if (pence <= 0) unpriced += 1;
    customers += 1;
    row.customers += 1;
    row.mrrPence += pence;
    if (c.state === 'at_risk') {
      atRisk += 1;
      row.atRisk += 1;
      row.atRiskMrrPence += pence;
    }
  }

  const bands = [...rows.values()];
  const mrrPence = bands.reduce((n, b) => n + b.mrrPence, 0);
  for (const b of bands) b.sharePct = mrrPence > 0 ? Math.round((b.mrrPence / mrrPence) * 1000) / 10 : 0;
  const stableMrrPence = bands.filter((b) => STABLE.includes(b.stability)).reduce((n, b) => n + b.mrrPence, 0);

  return {
    bands,
    mrrPence,
    stableMrrPence,
    stableSharePct: mrrPence > 0 ? Math.round((stableMrrPence / mrrPence) * 1000) / 10 : null,
    atRiskMrrPence: bands.reduce((n, b) => n + b.atRiskMrrPence, 0),
    customers,
    atRisk,
    unpriced,
  };
}

// ---------------------------------------------------------------
// Why they left, and at what point
// ---------------------------------------------------------------

/**
 * The reporting vocabulary. A superset of CANCEL_REASONS in
 * src/app/account/plan-view.ts: `payment_failed` is recorded by the webhook for
 * a subscription that died past-due, and `unknown` covers a cancellation that
 * reached us with nothing attached (a Stripe dashboard cancel, say).
 *
 * Deliberately NOT added to CANCEL_REASONS, which drives the member-facing
 * radio list — nobody picks "my card failed" as their reason for leaving.
 */
export const CHURN_REASON_LABELS: Record<string, string> = {
  too_expensive: 'Too expensive',
  not_using: 'Not using it enough',
  stopped_looking: 'Stopped looking for a property',
  missing_feature: 'Missing something they need',
  another_tool: 'Using something else',
  other: 'Something else',
  payment_failed: 'Payment failed',
  unknown: 'No reason given',
};

export function churnReasonLabel(slug: string | null): string {
  if (!slug) return CHURN_REASON_LABELS.unknown;
  return CHURN_REASON_LABELS[slug] ?? slug;
}

export interface ReasonCell {
  reason: string;
  label: string;
  bandKey: string;
  count: number;
  mrrLostPence: number;
}

export interface ReasonTotals {
  reason: string;
  label: string;
  count: number;
  mrrLostPence: number;
  byBand: Record<string, number>;
}

export interface ReasonCrossTab {
  cells: ReasonCell[];
  reasons: ReasonTotals[];
  bandTotals: { key: string; label: string; count: number; mrrLostPence: number }[];
  churned: number;
  mrrLostPence: number;
}

/**
 * Churn reasons against the tenure band the customer dropped in — the cross-tab
 * that answers "why do the ones who leave at three months leave?".
 *
 * The band is measured at the moment they LEFT, so it is the point of drop-off
 * and not where they would be today.
 */
export function reasonsByBand(cycles: Cycle[]): ReasonCrossTab {
  const cells = new Map<string, ReasonCell>();
  const reasons = new Map<string, ReasonTotals>();
  const bandTotals = new Map<string, { key: string; label: string; count: number; mrrLostPence: number }>();
  for (const band of TENURE_BANDS) bandTotals.set(band.key, { key: band.key, label: band.label, count: 0, mrrLostPence: 0 });

  let churned = 0;
  let mrrLostPence = 0;

  for (const c of cycles) {
    if (c.endedAt === null) continue;
    const reason = c.reason ?? 'unknown';
    const band = bandFor(c.startedAt, new Date(c.endedAt));
    const lost = c.mrrPence ?? 0;
    churned += 1;
    mrrLostPence += lost;

    const cellKey = `${reason}::${band.key}`;
    const cell = cells.get(cellKey);
    if (cell) {
      cell.count += 1;
      cell.mrrLostPence += lost;
    } else {
      cells.set(cellKey, { reason, label: churnReasonLabel(reason), bandKey: band.key, count: 1, mrrLostPence: lost });
    }

    const total = reasons.get(reason);
    if (total) {
      total.count += 1;
      total.mrrLostPence += lost;
      total.byBand[band.key] = (total.byBand[band.key] ?? 0) + 1;
    } else {
      reasons.set(reason, { reason, label: churnReasonLabel(reason), count: 1, mrrLostPence: lost, byBand: { [band.key]: 1 } });
    }

    const bt = bandTotals.get(band.key);
    if (bt) {
      bt.count += 1;
      bt.mrrLostPence += lost;
    }
  }

  return {
    cells: [...cells.values()],
    reasons: [...reasons.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    bandTotals: [...bandTotals.values()],
    churned,
    mrrLostPence,
  };
}

// ---------------------------------------------------------------
// The trend
// ---------------------------------------------------------------

export interface TrendPoint {
  /** 'YYYY-MM'. */
  month: string;
  label: string;
  active: number;
  atRisk: number;
  started: number;
  churned: number;
  mrrPence: number;
  stableMrrPence: number;
  stableSharePct: number | null;
  /** Churned during the month over those active at its start. */
  churnRatePct: number | null;
  byBand: Record<string, number>;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${String(y).slice(2)}`;
}

/**
 * One point per calendar month, measured at each month's END so a member who
 * joined and left inside the month shows as a start and a churn without ever
 * counting as active.
 *
 * Derived entirely from the cycles, which is why there is no snapshot table and
 * no cron: the same reasoning that makes the pause window self-healing makes
 * this self-correcting, and a backfill improves every past month at once.
 */
export function monthlyTrend(cycles: Cycle[], from: Date, to: Date, prices: PriceMap = {}): TrendPoint[] {
  const out: TrendPoint[] = [];
  if (cycles.length === 0) return out;

  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  while (cursor.getTime() <= last.getTime()) {
    const monthStart = new Date(cursor.getTime());
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    // Measured at the last instant of the month, capped at `to` for the month
    // still in progress so today's point is not a projection.
    const atRaw = new Date(monthEnd.getTime() - 1);
    const at = atRaw.getTime() > to.getTime() ? to : atRaw;

    const byBand: Record<string, number> = {};
    for (const band of TENURE_BANDS) byBand[band.key] = 0;

    let active = 0;
    let atRisk = 0;
    let started = 0;
    let churned = 0;
    let activeAtStart = 0;
    let mrrPence = 0;
    let stableMrrPence = 0;

    for (const c of cycles) {
      const start = new Date(c.startedAt).getTime();
      const end = c.endedAt === null ? Infinity : new Date(c.endedAt).getTime();
      const pence = c.mrrPence ?? (c.planCode ? (prices[c.planCode] ?? 0) : 0);

      if (start >= monthStart.getTime() && start < monthEnd.getTime()) started += 1;
      if (end >= monthStart.getTime() && end < monthEnd.getTime()) churned += 1;
      if (start < monthStart.getTime() && end >= monthStart.getTime()) activeAtStart += 1;

      if (start <= at.getTime() && end > at.getTime()) {
        active += 1;
        mrrPence += pence;
        const band = bandFor(c.startedAt, at);
        byBand[band.key] = (byBand[band.key] ?? 0) + pence;
        if (STABLE.includes(band.stability)) stableMrrPence += pence;
        // A cycle's at-risk flag is only known as of now, not historically, so
        // it is reported on the current month alone.
        if (c.state === 'at_risk' && at.getTime() === to.getTime()) atRisk += 1;
      }
    }

    const key = monthKey(monthStart);
    out.push({
      month: key,
      label: monthLabel(key),
      active,
      atRisk,
      started,
      churned,
      mrrPence,
      stableMrrPence,
      stableSharePct: mrrPence > 0 ? Math.round((stableMrrPence / mrrPence) * 1000) / 10 : null,
      churnRatePct: activeAtStart > 0 ? Math.round((churned / activeAtStart) * 1000) / 10 : null,
      byBand,
    });

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return out;
}

/** The earliest month any cycle began, so the trend starts where the data does. */
export function firstCycleMonth(cycles: Cycle[]): Date | null {
  let earliest: number | null = null;
  for (const c of cycles) {
    const t = new Date(c.startedAt).getTime();
    if (earliest === null || t < earliest) earliest = t;
  }
  return earliest === null ? null : new Date(earliest);
}

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every cycle as a spreadsheet — one row per paid spell, so a member who left
 * and came back is two rows and neither hides the other.
 */
export function cyclesCsv(cycles: Cycle[]): string {
  const header = [
    'user_id',
    'started_at',
    'ended_at',
    'state',
    'risk',
    'plan_code',
    'mrr_pence',
    'tenure_days',
    'drop_off_band',
    'reason',
    'reason_label',
    'comment',
    'source',
  ];
  const rows = cycles.map((c) => [
    c.userId,
    c.startedAt,
    c.endedAt,
    c.state,
    c.riskKind,
    c.planCode,
    c.mrrPence,
    c.tenureDays,
    c.endedAt ? bandFor(c.startedAt, new Date(c.endedAt)).key : '',
    c.reason ?? c.intentReason,
    churnReasonLabel(c.reason ?? c.intentReason),
    c.reasonComment ?? c.intentComment,
    c.source,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
