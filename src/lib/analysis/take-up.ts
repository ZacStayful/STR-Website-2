/**
 * Batch 10's figures for the three slots Batch 9 left on
 * /admin/weekly-active, from the activity log (activity_events):
 *
 *   Full analysis take-up   of the deals members opened (a Quick look, or the
 *                           open inside a one-tap Full analysis), the share
 *                           that got a Full analysis. Counted per member and
 *                           deal, over the last TAKE_UP_DAYS days.
 *   PMI add-on take-up      Full analyses with PMI's second opinion, ticked
 *                           at purchase or added later from the report, as a
 *                           share of the Full analyses bought.
 *   Reminder shown → acted  the reminders shown (a stage move past Kept with
 *                           no Full analysis, or the Kept next step), and how
 *                           many were acted on: the member started a Full
 *                           analysis from the reminder's own button.
 *
 * And the events those figures come from, so the names cannot drift apart:
 *
 *   reminder_shown   { where, stage }  once per member, deal, where and stage
 *   reminder_acted   { where, stage }  once per member, deal, where and stage
 *   full_analysis    { via, reused, pmi_ticked, pmi }  once per purchase
 *   pmi_addon        { from: 'report' }  once per report
 *   deal_open        { via: 'full_analysis' } for the open inside a one-tap
 *                    Full analysis (a Quick look is logged by Batch 9 already)
 *
 * The same accounts are left out as everywhere on the page (admins, staff,
 * switched-off accounts), and so are events a preview deployment stamped
 * (extras.env).
 *
 * Pure: no network, no database, no server-only.
 */
import { isPipelineStatus, type PipelineStatus } from '../listing/pipeline.ts';

export const TAKE_UP_DAYS = 28;

/** The activity kinds the figures read. */
export const TAKE_UP_KINDS = ['deal_open', 'full_analysis', 'pmi_addon', 'reminder_shown', 'reminder_acted'] as const;

// ── The reminder events ──

/**
 * Where a reminder was shown: 'stage' is the line under a deal moved past
 * Kept (StageReminder), 'kept_step' the Full analysis leading the next step
 * at Kept. The deal page's `?from=` carries it into the purchase.
 */
export const REMINDER_WHERE = ['stage', 'kept_step'] as const;
export type ReminderWhere = (typeof REMINDER_WHERE)[number];

export function reminderWhere(v: unknown): ReminderWhere | null {
  return typeof v === 'string' && (REMINDER_WHERE as readonly string[]).includes(v) ? (v as ReminderWhere) : null;
}

export interface ReminderEvent {
  dedupeKey: string;
  extras: { where: ReminderWhere; stage: PipelineStatus };
}

/** The shown or acted event for one reminder, or null when the facts are not a reminder's. */
export function reminderEvent(kind: 'shown' | 'acted', input: { dealId: unknown; where: unknown; stage: unknown }): ReminderEvent | null {
  const where = reminderWhere(input.where);
  const dealId = typeof input.dealId === 'string' && /^[0-9a-f-]{36}$/i.test(input.dealId) ? input.dealId.toLowerCase() : null;
  if (!where || !dealId || !isPipelineStatus(input.stage)) return null;
  return { dedupeKey: `reminder_${kind}:${where}:${dealId}:${input.stage}`, extras: { where, stage: input.stage } };
}

// ── The figures ──

export interface TakeUpEvent {
  user_id: string;
  kind: string;
  deal_id: string | null;
  extras: Record<string, unknown> | null;
  occurred_at: string;
}

export interface TakeUpFigures {
  days: number;
  analysis: {
    /** Member and deal pairs opened (or bought outright). */
    opened: number;
    /** Of those, the pairs with a Full analysis. */
    analysed: number;
    /** Full analyses bought. */
    bought: number;
    oneTap: number;
    afterLook: number;
    reused: number;
  };
  pmi: {
    /** Full analyses bought (the base). */
    analyses: number;
    atPurchase: number;
    later: number;
    /** Ticked at purchase, but PMI had no answer (not charged). */
    noAnswer: number;
  };
  reminders: {
    shown: number;
    acted: number;
    /** Acted on, and the Full analysis then completed. */
    bought: number;
    byWhere: Record<ReminderWhere, { shown: number; acted: number }>;
  };
}

export function emptyTakeUp(days: number = TAKE_UP_DAYS): TakeUpFigures {
  return {
    days,
    analysis: { opened: 0, analysed: 0, bought: 0, oneTap: 0, afterLook: 0, reused: 0 },
    pmi: { analyses: 0, atPurchase: 0, later: 0, noAnswer: 0 },
    reminders: { shown: 0, acted: 0, bought: 0, byWhere: { stage: { shown: 0, acted: 0 }, kept_step: { shown: 0, acted: 0 } } },
  };
}

/** The figures from the window's events. `excluded`: accounts left out of every figure. */
export function takeUpFigures(events: readonly TakeUpEvent[], excluded: ReadonlySet<string>, days: number = TAKE_UP_DAYS): TakeUpFigures {
  const out = emptyTakeUp(days);
  const rows = events.filter((e) => !excluded.has(e.user_id) && !(e.extras && 'env' in e.extras));
  const pair = (e: TakeUpEvent) => `${e.user_id}:${e.deal_id}`;
  const opened = new Set<string>();
  const analysed = new Set<string>();
  // Per member and deal: when each Full analysis was bought, for "acted on, then bought".
  const boughtAt = new Map<string, number[]>();

  for (const e of rows) {
    const x = e.extras ?? {};
    if (e.kind === 'deal_open' && e.deal_id) opened.add(pair(e));
    if (e.kind === 'full_analysis') {
      out.analysis.bought += 1;
      if (x.via === 'one_tap') out.analysis.oneTap += 1;
      else if (x.via === 'upgrade') out.analysis.afterLook += 1;
      if (x.reused === true) out.analysis.reused += 1;
      if (x.pmi === true) out.pmi.atPurchase += 1;
      else if (x.pmi_ticked === true) out.pmi.noAnswer += 1;
      if (e.deal_id) {
        opened.add(pair(e));
        analysed.add(pair(e));
        const t = Date.parse(e.occurred_at);
        if (Number.isFinite(t)) boughtAt.set(pair(e), [...(boughtAt.get(pair(e)) ?? []), t]);
      }
    }
    if (e.kind === 'pmi_addon') out.pmi.later += 1;
    if (e.kind === 'reminder_shown' || e.kind === 'reminder_acted') {
      const where = reminderWhere(x.where);
      const shown = e.kind === 'reminder_shown';
      if (shown) out.reminders.shown += 1;
      else out.reminders.acted += 1;
      if (where) out.reminders.byWhere[where][shown ? 'shown' : 'acted'] += 1;
    }
  }
  out.analysis.opened = opened.size;
  out.analysis.analysed = analysed.size;
  out.pmi.analyses = out.analysis.bought;
  // The purchase is logged when it completes, after the start that acted on the reminder.
  for (const e of rows) {
    if (e.kind !== 'reminder_acted' || !e.deal_id) continue;
    const t = Date.parse(e.occurred_at);
    if ((boughtAt.get(pair(e)) ?? []).some((b) => !Number.isFinite(t) || b >= t)) out.reminders.bought += 1;
  }
  return out;
}
