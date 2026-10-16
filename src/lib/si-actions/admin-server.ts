import 'server-only';

/**
 * Batch 27: what /admin/intelligence/actions shows. Instructions and their
 * steps (never a member's name, a link or an address), what each charged
 * step's own code charged (analysis_purchases, member_searches), the
 * question's AI line (chat_turns, which shares the instruction's id), and the
 * activity log for next-week weekly active. Never throws: a read that fails
 * says so.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { QUALIFYING_KINDS } from '../activity/kinds';
import { metricsExcludedIds } from '../activity/admin-server';
import { recentWeeks, ukWeekStart, ukWeekRange } from '../activity/week';
import { readActionConfig, type ActionConfig } from './store-server';
import { actionRevenue, actionsPerDay, failures, nextWeekActive, safety, turnMargin, undoRates, HAPPENED, type ActionDay, type ActionMoney, type Failure, type InstructionFact, type NextWeek, type Safety, type StepFact, type TurnMargin, type TurnMoney, type UndoRate } from './metrics';
import { isStepKind, type StepKind } from './config';

export const ACTION_ADMIN_DAYS = 30;
/** Weeks of next-week weekly active (the newest one's "next week" is the week in progress). */
export const ACTION_ADMIN_WEEKS = 5;
/** PostgREST returns at most 1,000 rows a request: read a page at a time, up to this many in all. */
const PAGE = 1000;
const ROW_LIMIT = 20_000;
const CHUNK = 200;

type Page = { data: unknown[] | null; error: { message: string } | null };

/** Every row a query returns (in pages, to ROW_LIMIT); the query must be ordered so pages don't overlap. */
async function allRows<T>(read: (from: number, to: number) => PromiseLike<Page>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; from < ROW_LIMIT; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return { rows, error: null };
}

export interface ActionsAdmin {
  config: ActionConfig;
  days: ActionDay[];
  revenue: { rows: ActionMoney[]; totalPence: number; estimated: number };
  ai: TurnMargin;
  safety: Safety;
  failures: { rows: Failure[]; total: number; autoReported: number };
  undo: UndoRate[];
  nextWeek: NextWeek[];
}

export type ActionsAdminLoad = { status: 'ok'; data: ActionsAdmin } | { status: 'no_service_role' } | { status: 'failed'; message: string };

type Admin = ReturnType<typeof createAdminClient>;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

const num = (v: unknown) => Number(v) || 0;

type RawIns = { id: string; user_id: string | null; created_at: string; status: string; decision: string; confirm_kind: string | null; confirm_answer: string | null; charged_started_at: string | null; stopped_at: string | null; report_kind: string | null };

interface RawStep {
  instruction_id: string;
  user_id: string | null;
  action: string;
  status: string;
  params: Record<string, unknown> | null;
  quote_base_pence: number;
  ledger_ref: string | null;
  report_ref: number | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  undone_at: string | null;
}

/** What each charged step's own code charged, base pence: its purchase, its add-on or its search. A link check is metered, so null. */
async function chargesFor(admin: Admin, steps: readonly RawStep[]): Promise<Map<RawStep, number | null>> {
  const out = new Map<RawStep, number | null>();
  const happened = steps.filter((s) => HAPPENED.has(s.status));
  const purchaseIds = new Set<string>();
  const addOnReports = new Set<string>();
  const searchIds = new Set<string>();
  for (const s of happened) {
    if (!s.ledger_ref) continue;
    if (s.action === 'deep_search') searchIds.add(s.ledger_ref);
    else if (s.action === 'deep_report' && s.params?.addOn === true) addOnReports.add(s.ledger_ref);
    else if (s.action === 'full_analysis' || s.action === 'deep_report' || s.action === 'btl_report') purchaseIds.add(s.ledger_ref);
  }
  const purchases = new Map<string, number>();
  for (const ids of chunks([...purchaseIds])) {
    const { data } = await admin.from('analysis_purchases').select('id, charged_base_pence').in('id', ids);
    for (const r of (data ?? []) as { id: string; charged_base_pence: number }[]) purchases.set(r.id, num(r.charged_base_pence));
  }
  type AddOn = { report_id: string; buyer_id: string; charged_base_pence: number; created_at: string };
  const addOns: AddOn[] = [];
  for (const ids of chunks([...addOnReports])) {
    const { data } = await admin.from('analysis_purchases').select('report_id, buyer_id, charged_base_pence, created_at').eq('kind', 'pmi_addon').in('report_id', ids).order('created_at', { ascending: true });
    addOns.push(...((data ?? []) as AddOn[]));
  }
  const searches = new Map<string, number>();
  for (const ids of chunks([...searchIds])) {
    const { data } = await admin.from('member_searches').select('id, charged_base_pence').in('id', ids);
    for (const r of (data ?? []) as { id: string; charged_base_pence: number }[]) searches.set(r.id, num(r.charged_base_pence));
  }
  for (const s of happened) {
    if (s.action === 'check_link') out.set(s, null);
    else if (!s.ledger_ref) out.set(s, 0); // reused (a report that was already there): free
    else if (s.action === 'deep_search') out.set(s, searches.get(s.ledger_ref) ?? 0);
    else if (s.action === 'deep_report' && s.params?.addOn === true) {
      // The add-on bought for this report by this member, from the moment the step started (reconcile's own match).
      const from = Date.parse(s.started_at ?? s.created_at) - 60_000;
      const hit = addOns.find((a) => a.report_id === s.ledger_ref && a.buyer_id === s.user_id && Date.parse(a.created_at) >= from);
      out.set(s, hit ? num(hit.charged_base_pence) : 0);
    } else out.set(s, purchases.get(s.ledger_ref) ?? 0);
  }
  return out;
}

export async function loadActionsAdmin(now: Date = new Date()): Promise<ActionsAdminLoad> {
  if (!hasServiceRole()) return { status: 'no_service_role' };
  try {
    const admin = createAdminClient();
    const weeks = recentWeeks(now, ACTION_ADMIN_WEEKS);
    const daysFrom = new Date(now.getTime() - ACTION_ADMIN_DAYS * 86_400_000);
    const weeksFrom = ukWeekRange(weeks[0]).start;
    const since = new Date(Math.min(daysFrom.getTime(), weeksFrom.getTime())).toISOString();

    const [config, insRes, stepsRes, chatRes] = await Promise.all([
      readActionConfig(admin),
      allRows<RawIns>((a, b) => admin.from('si_instructions').select('id, user_id, created_at, status, decision, confirm_kind, confirm_answer, charged_started_at, stopped_at, report_kind').gte('created_at', since).order('created_at', { ascending: false }).order('id').range(a, b)),
      allRows<RawStep>((a, b) => admin.from('si_action_steps').select('id, instruction_id, user_id, action, status, params, quote_base_pence, ledger_ref, report_ref, error_code, created_at, started_at, finished_at, undone_at').gte('created_at', since).order('created_at', { ascending: false }).order('id').range(a, b)),
      allRows<{ user_id: string | null; created_at: string }>((a, b) => admin.from('chat_turns').select('id, user_id, created_at').eq('surface', 'full').gte('created_at', weeksFrom.toISOString()).order('created_at', { ascending: false }).order('id').range(a, b)),
    ]);
    if (insRes.error) return { status: 'failed', message: `si_instructions: ${insRes.error}` };
    if (stepsRes.error) return { status: 'failed', message: `si_action_steps: ${stepsRes.error}` };
    if (chatRes.error) return { status: 'failed', message: `chat_turns: ${chatRes.error}` };

    const allIns = insRes.rows;
    const rawSteps = stepsRes.rows.filter((s) => isStepKind(s.action));
    const withSteps = new Set(rawSteps.map((s) => s.instruction_id));
    const outOfCredit = new Set(rawSteps.filter((s) => s.error_code === 'insufficient_credit').map((s) => s.instruction_id));
    const facts: InstructionFact[] = allIns.map((r) => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, status: r.status, decision: r.decision, confirmKind: r.confirm_kind, confirmAnswer: r.confirm_answer, chargedStartedAt: r.charged_started_at, stoppedAt: r.stopped_at, reportKind: r.report_kind, planned: withSteps.has(r.id), ranOutOfCredit: r.status === 'blocked' || outOfCredit.has(r.id) }));
    const charges = await chargesFor(admin, rawSteps);
    const stepFacts: (StepFact & { userId: string | null })[] = rawSteps.map((s) => ({
      instructionId: s.instruction_id,
      userId: s.user_id,
      action: s.action as StepKind,
      status: s.status,
      createdAt: s.created_at,
      finishedAt: s.finished_at,
      undoneAt: s.undone_at,
      errorCode: s.error_code,
      autoReported: s.report_ref !== null && s.report_ref !== undefined,
      chargedBasePence: charges.has(s) ? charges.get(s)! : null,
      estimateBasePence: num(s.params?.aboutBasePence ?? s.quote_base_pence),
    }));

    // The window's panels read the last ACTION_ADMIN_DAYS days; next-week weekly active reads whole weeks.
    const inDays = (iso: string) => Date.parse(iso) >= daysFrom.getTime();
    const insDays = facts.filter((f) => inDays(f.createdAt));
    const stepDays = stepFacts.filter((s) => inDays(s.createdAt));

    // The question's own AI line: chat_turns shares the instruction's id.
    const ids = insDays.filter((f) => f.status !== 'cancelled' && f.planned).map((f) => f.id);
    const turns: TurnMoney[] = [];
    for (const part of chunks(ids)) {
      const { data } = await admin.from('chat_turns').select('id, raw_pence, charged_base_pence').in('id', part);
      for (const t of (data ?? []) as { id: string; raw_pence: number; charged_base_pence: number }[]) turns.push({ id: t.id, rawPence: num(t.raw_pence), chargedBasePence: num(t.charged_base_pence) });
    }

    // Next-week weekly active. R3-67: admin, staff and excluded accounts are left out, as on Weekly active.
    const weekOf = (iso: string) => ukWeekStart(new Date(iso));
    const insWeek = new Map(allIns.map((r) => [r.id, weekOf(r.created_at)]));
    const actors = new Map<string, Set<string>>();
    for (const s of stepFacts) {
      if (!s.userId || !HAPPENED.has(s.status)) continue;
      const w = insWeek.get(s.instructionId);
      if (!w || !weeks.includes(w)) continue;
      const set = actors.get(w) ?? new Set<string>();
      set.add(s.userId);
      actors.set(w, set);
    }
    const chatUsers = new Map<string, Set<string>>();
    for (const t of chatRes.rows) {
      if (!t.user_id) continue;
      const w = weekOf(t.created_at);
      if (!weeks.includes(w)) continue;
      const set = chatUsers.get(w) ?? new Set<string>();
      set.add(t.user_id);
      chatUsers.set(w, set);
    }
    const everyone = [...new Set([...actors.values(), ...chatUsers.values()].flatMap((s) => [...s]))];
    const excluded = await metricsExcludedIds(everyone);
    const keep = (m: Map<string, Set<string>>) => new Map([...m].map(([w, set]) => [w, new Set([...set].filter((u) => !excluded.has(u)))]));
    const counted = everyone.filter((u) => !excluded.has(u));
    const activeByWeek = new Map<string, Set<string>>();
    for (const part of chunks(counted)) {
      const { rows: events } = await allRows<{ user_id: string; occurred_at: string }>((a, b) => admin.from('activity_events').select('id, user_id, occurred_at').in('user_id', part).in('kind', QUALIFYING_KINDS as string[]).gte('occurred_at', weeksFrom.toISOString()).order('id').range(a, b));
      for (const e of events) {
        const w = weekOf(e.occurred_at);
        const set = activeByWeek.get(w) ?? new Set<string>();
        set.add(e.user_id);
        activeByWeek.set(w, set);
      }
    }

    return {
      status: 'ok',
      data: {
        config,
        days: actionsPerDay(insDays, stepDays, ACTION_ADMIN_DAYS, now),
        revenue: actionRevenue(stepDays),
        ai: turnMargin(new Set(ids), turns),
        safety: safety(insDays),
        failures: failures(stepDays),
        undo: undoRates(stepDays),
        nextWeek: nextWeekActive([...weeks].reverse(), keep(actors), keep(chatUsers), activeByWeek, now),
      },
    };
  } catch (err) {
    return { status: 'failed', message: (err as Error)?.message ?? 'failed' };
  }
}
