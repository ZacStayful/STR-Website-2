/**
 * Part G: the figures behind /admin/tailoring, from what is already
 * recorded (nothing new is logged for them):
 *
 *   Keep rate on Today's 5   of the deals on a member's Today (the stored
 *                            list and the day's pick), the share they kept
 *                            the same Today-day, from the grid, Today or the
 *                            email's "Yes, more like this". By main role, by
 *                            how complete the profile is (0 / 1–49 / 50–99 /
 *                            100%), and by the deals they want in 12 months.
 *   Open → Full analysis     of the deals members opened themselves, the
 *                            share that got a Full analysis: Batch 10's own
 *                            pairing (analysis/take-up.ts), by what they say
 *                            holds them back.
 *   Tailoring actions        how often each Batch 14 action happened, by step.
 *
 * The accounts every admin figure leaves out (admins, staff, switched off)
 * are left out here too, by the caller.
 *
 * Pure: no network, no database, no `server-only`.
 */
import { takeUpFigures, type TakeUpEvent } from '../analysis/take-up.ts';
import { ABOUT_OPTIONS, type AboutYou } from '../profile/about.ts';
import { questionById } from '../profile/questions.ts';
import { todayKey } from '../today/day.ts';

export const COMPLETENESS_BUCKETS = ['0', '1-49', '50-99', '100'] as const;
export type CompletenessBucket = (typeof COMPLETENESS_BUCKETS)[number];

export function completenessBucket(percent: number): CompletenessBucket {
  const p = Number.isFinite(percent) ? Math.round(percent) : 0;
  if (p <= 0) return '0';
  if (p >= 100) return '100';
  return p < 50 ? '1-49' : '50-99';
}

const NONE = 'none';

/** The member's main role, else their only one; "none" before they answer. */
export function roleOf(about: AboutYou | null): string {
  return about?.mainRole ?? about?.roles[0] ?? NONE;
}

/** An answer's words from the quiz itself ("Investor buying", "2 to 5"), so the page and the quiz never differ. */
function labelsOf(questionId: string, values: readonly string[]): Record<string, string> {
  const q = questionById(questionId);
  const options = q && Array.isArray(q.options) ? q.options : [];
  const out: Record<string, string> = { [NONE]: 'Not answered' };
  for (const v of values) out[v] = options.find((o) => o.value === v)?.label ?? v;
  return out;
}

export const ROLE_ROWS = labelsOf('roles', ['investor', 'r2r', 'sourcer', 'manager', 'exploring']);
export const BLOCKER_ROWS = labelsOf('blocker', ABOUT_OPTIONS.blocker);
export const DEALS_WANTED_ROWS = labelsOf('deals_wanted', ABOUT_OPTIONS.dealsWanted12m);
export const COMPLETENESS_ROWS: Record<CompletenessBucket, string> = { '0': '0%', '1-49': '1–49%', '50-99': '50–99%', '100': '100%' };

export interface MemberFact {
  id: string;
  role: string;
  completeness: CompletenessBucket;
  blocker: string;
  dealsWanted: string;
}

export function memberFact(id: string, about: AboutYou | null, percent: number): MemberFact {
  return { id, role: roleOf(about), completeness: completenessBucket(percent), blocker: about?.blocker ?? NONE, dealsWanted: about?.dealsWanted12m ?? NONE };
}

/** A member's Today on one Today-day: the stored list, with the day's pick. */
export interface ShownDay {
  userId: string;
  day: string;
  dealIds: string[];
}

/** A Keep (grid, Today) or an email "Yes", as the activity log holds it. */
export interface KeepEvent {
  userId: string;
  dealId: string;
  at: string;
}

export interface RateRow {
  key: string;
  label: string;
  members: number;
  shown: number;
  kept: number;
  /** kept ÷ shown, or null with nothing shown. */
  rate: number | null;
}

export interface KeepRates {
  total: RateRow;
  byRole: RateRow[];
  byCompleteness: RateRow[];
  byDealsWanted: RateRow[];
}

const rate = (kept: number, shown: number) => (shown > 0 ? kept / shown : null);

/** Shown and kept per member: a deal counts once per day it was on their Today, kept when they kept it that day. */
export function keepRates(days: readonly ShownDay[], keeps: readonly KeepEvent[], members: readonly MemberFact[]): KeepRates {
  const known = new Map(members.map((m) => [m.id, m]));
  const keptOn = new Set(keeps.map((k) => `${k.userId}|${todayKey(new Date(k.at))}|${k.dealId}`));
  const per = new Map<string, { shown: number; kept: number }>();
  for (const d of days) {
    if (!known.has(d.userId)) continue;
    const p = per.get(d.userId) ?? { shown: 0, kept: 0 };
    for (const id of new Set(d.dealIds)) {
      p.shown += 1;
      if (keptOn.has(`${d.userId}|${d.day}|${id}`)) p.kept += 1;
    }
    per.set(d.userId, p);
  }
  const group = (keyOf: (m: MemberFact) => string, labels: Record<string, string>): RateRow[] =>
    Object.entries(labels).map(([key, label]) => {
      const inGroup = members.filter((m) => keyOf(m) === key);
      const shown = inGroup.reduce((n, m) => n + (per.get(m.id)?.shown ?? 0), 0);
      const kept = inGroup.reduce((n, m) => n + (per.get(m.id)?.kept ?? 0), 0);
      return { key, label, members: inGroup.length, shown, kept, rate: rate(kept, shown) };
    });
  const shown = [...per.values()].reduce((n, p) => n + p.shown, 0);
  const kept = [...per.values()].reduce((n, p) => n + p.kept, 0);
  return {
    total: { key: 'all', label: 'Everyone', members: members.length, shown, kept, rate: rate(kept, shown) },
    byRole: group((m) => m.role, ROLE_ROWS),
    byCompleteness: group((m) => m.completeness, COMPLETENESS_ROWS),
    byDealsWanted: group((m) => m.dealsWanted, DEALS_WANTED_ROWS),
  };
}

export interface AnalysisRow {
  key: string;
  label: string;
  members: number;
  opened: number;
  analysed: number;
  rate: number | null;
}

/** Open → Full analysis by what holds them back, through Batch 10's own pairing. */
export function analysisByBlocker(events: readonly TakeUpEvent[], members: readonly MemberFact[]): AnalysisRow[] {
  const none = new Set<string>();
  return Object.entries(BLOCKER_ROWS).map(([key, label]) => {
    const ids = new Set(members.filter((m) => m.blocker === key).map((m) => m.id));
    const f = takeUpFigures(events.filter((e) => ids.has(e.user_id)), none);
    return { key, label, members: ids.size, opened: f.analysis.opened, analysed: f.analysis.analysed, rate: rate(f.analysis.analysed, f.analysis.opened) };
  });
}

/** The Batch 14 actions, and the email answers to Today's 5. */
export const ACTION_KINDS = ['tailoring_mode', 'tailoring_widen_shown', 'tailoring_widen', 'tailoring_prompt_shown', 'tailoring_prompt', 'leads_upsell_clicked', 'email_feedback'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

const ACTION_LABELS: Record<ActionKind, string> = {
  tailoring_mode: 'Must-have / nice-to-have switched',
  tailoring_widen_shown: 'Shown ways to widen (Today)',
  tailoring_widen: 'Widened from Today',
  tailoring_prompt_shown: 'Shown a profile check (Today)',
  tailoring_prompt: 'Answered a profile check',
  leads_upsell_clicked: 'Tapped the Leads card',
  email_feedback: 'Answered a Today’s 5 teaser by email',
};

export interface ActionEvent {
  user_id: string;
  kind: string;
  extras: Record<string, unknown> | null;
}

export interface ActionRow {
  kind: ActionKind;
  label: string;
  total: number;
  members: number;
  /** extras.step (shown / accepted / dismissed / applied), extras.mode, or the email's answer. */
  by: Record<string, number>;
}

export function actionCounts(events: readonly ActionEvent[], members: readonly MemberFact[]): ActionRow[] {
  const known = new Set(members.map((m) => m.id));
  return ACTION_KINDS.map((kind) => {
    const rows = events.filter((e) => e.kind === kind && known.has(e.user_id) && !(e.extras && 'env' in e.extras) && (kind !== 'email_feedback' || e.extras?.part === 'teaser'));
    const by: Record<string, number> = {};
    for (const e of rows) {
      const x = e.extras ?? {};
      const key = typeof x.step === 'string' ? x.step : typeof x.mode === 'string' ? x.mode : typeof x.answer === 'string' ? x.answer : null;
      if (key) by[key] = (by[key] ?? 0) + 1;
    }
    return { kind, label: ACTION_LABELS[kind], total: rows.length, members: new Set(rows.map((e) => e.user_id)).size, by };
  });
}

/** "38%", or "—" with nothing to divide. */
export function pct(r: number | null): string {
  return r === null ? '—' : `${Math.round(r * 100)}%`;
}
