import 'server-only';

/**
 * Batch 26: one typed question from claim to charge.
 *
 *   preflight   a retry or reconnect gets the stored result (never a second
 *               model call or charge); a dead instance's pending question is
 *               failed; the rate limit and the unanswered-questions cap
 *   insertTurn  the pending row: one per member at a time (a second tab gets
 *               "still answering")
 *   startHold   startAction with the budget as the hold, requireCredit so it
 *               holds even with CREDIT_ENFORCE off: the balance can't go
 *               below £0
 *   settle      the member is charged only for a delivered answer: the
 *               pending → answered update decides it once, then every
 *               round's tokens are metered against the hold (the morning
 *               briefing's chargeOnce, src/lib/briefing/runner.ts). Anything
 *               else is metered as house spend: logged, never charged.
 *
 * The question and answer text go to Batch 23's conversation log (channel
 * 'chat') only; chat_turns never holds any text.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { isAdminEmail } from '../admin';
import { payerFor } from '../team';
import { startAction, actionSpend, type StartedAction } from '../credit/action';
import { meter } from '../credit/meter';
import { getBalance } from '../credit/ledger';
import { getUnitCostTable } from '../credit/unit-costs';
import type { MeterContext } from '../credit/context';
import { ukDay } from '../activity/week';
import { londonDayStart } from '../leads/search';
import { CHAT_ACTION, CHARGE_DESCRIPTION, MODEL_FOR, MODEL_UNITS, PENDING_STALE_MS, UNBILLED_ACTION, type ChatSurface } from './config';
import { chargeLines, costOf, PROVIDER, type RoundUsage } from './budget';
import { parseChatSettings, CHAT_SETTING_KEYS, type ChatSettings } from './settings';
import type { ChatButton } from './actions';
import type { ChatUi } from './reply';
import type { QuestionOutcome } from '../voice/config';

export type Admin = ReturnType<typeof createAdminClient>;

// ── Settings and the switch ─────────────────────────────────────────────────

export async function readChatSettings(admin: Admin = createAdminClient()): Promise<ChatSettings> {
  const { data } = await admin.from('billing_settings').select('key, value').in('key', Object.values(CHAT_SETTING_KEYS));
  return parseChatSettings(new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])));
}

let uiCache: { at: number; settings: ChatSettings } | null = null;

/** The settings for drawing the box on every page (cached a minute, like getBillingSettings); a question always reads them fresh. */
export async function chatSettingsForPage(): Promise<ChatSettings | null> {
  if (!chatEnvOn() || !hasServiceRole()) return null;
  if (uiCache && Date.now() - uiCache.at < 60_000) return uiCache.settings;
  try {
    const settings = await readChatSettings();
    uiCache = { at: Date.now(), settings };
    return settings;
  } catch {
    return null;
  }
}


export async function chatUi(): Promise<ChatUi | null> {
  const s = await chatSettingsForPage();
  if (!s || !s.enabled) return null;
  return { quickHintPence: s.quickHintPence, fullHintPence: s.fullHintPence, quickFloorPence: s.quickFloorPence, fullFloorPence: s.fullFloorPence };
}

/** The env switch: off until SI_CHAT_ENABLED=true (README, Batch 26 deploy steps). */
export function chatEnvOn(): boolean {
  return process.env.SI_CHAT_ENABLED === 'true';
}

export function chatOn(settings: ChatSettings): boolean {
  return chatEnvOn() && settings.enabled && hasServiceRole();
}

// ── Who is asking ───────────────────────────────────────────────────────────

export interface ChatMember {
  /** Who typed the question (the activity, the log, the facts are theirs). */
  userId: string;
  /** Whose credit pays (a team member's owner). */
  payerId: string;
  admin: boolean;
  /** A team member spending the owner's credit: no top-up buttons. */
  teamMember: boolean;
  /** A paused seat may not spend the team's credit. */
  seatPaused: boolean;
}

export async function chatMemberFor(user: { id: string; email?: string | null }): Promise<ChatMember> {
  const admin = isAdminEmail(user.email ?? null);
  if (admin) return { userId: user.id, payerId: user.id, admin, teamMember: false, seatPaused: false };
  const payer = await payerFor(user.id);
  return { userId: user.id, payerId: payer.payerId, admin, teamMember: payer.payerId !== user.id, seatPaused: payer.suspended };
}

/** The payer's spendable credit, base pence (0 when it can't be read: fail closed). */
export async function spendableFor(member: ChatMember): Promise<number> {
  if (member.admin) return Number.POSITIVE_INFINITY;
  try {
    return (await getBalance(member.payerId)).spendableBasePence;
  } catch (err) {
    console.error('[chat] balance read failed:', (err as Error)?.message ?? err);
    return 0;
  }
}

// ── The row ─────────────────────────────────────────────────────────────────

export type TurnStatus = 'pending' | 'answered' | 'no_answer' | 'failed';

export interface TurnRow {
  id: string;
  user_id: string | null;
  payer_id: string | null;
  client_turn_id: string;
  surface: ChatSurface;
  status: TurnStatus;
  outcome: QuestionOutcome | null;
  conversation_id: string | null;
  question_id: string | null;
  knowledge_slug: string | null;
  charged_base_pence: number;
  charged_face_pence: number;
  capped: boolean;
  fact_proposal: FactProposal | null;
  log_seq: number | null;
  buttons: ChatButton[] | null;
  created_at: string;
}

export interface FactProposal {
  fact: string;
  asked: string | null;
  answered?: 'yes' | 'no';
  saved?: boolean;
}

const TURN_COLUMNS = 'id, user_id, payer_id, client_turn_id, surface, status, outcome, conversation_id, question_id, knowledge_slug, charged_base_pence, charged_face_pence, capped, fact_proposal, log_seq, buttons, created_at';

function rowOf(r: Record<string, unknown>): TurnRow {
  return {
    ...(r as unknown as TurnRow),
    charged_base_pence: Number(r.charged_base_pence ?? 0) || 0,
    charged_face_pence: Number(r.charged_face_pence ?? 0) || 0,
    buttons: Array.isArray(r.buttons) ? (r.buttons as ChatButton[]) : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export type Preflight =
  | { kind: 'existing'; turn: TurnRow }
  | { kind: 'too_fast' }
  | { kind: 'uncharged_cap' }
  | { kind: 'ok' };

/**
 * Before a question is taken: a retry (same client id) gets what happened
 * the first time; a pending question older than PENDING_STALE_MS (its
 * instance died) is failed so it can't lock the member out; then the rate
 * limit and the unanswered-questions cap (answered questions are never
 * capped: credit is the only limit on those).
 */
export async function preflight(admin: Admin, member: ChatMember, clientTurnId: string, settings: ChatSettings, now: Date = new Date()): Promise<Preflight> {
  const existing = await admin.from('chat_turns').select(TURN_COLUMNS).eq('user_id', member.userId).eq('client_turn_id', clientTurnId).maybeSingle();
  if (existing.error) throw new Error(`chat turn read: ${existing.error.message}`);
  if (existing.data) return { kind: 'existing', turn: rowOf(existing.data as Record<string, unknown>) };

  const stale = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
  await admin.from('chat_turns').update({ status: 'failed' }).eq('user_id', member.userId).eq('status', 'pending').lt('created_at', stale);

  const last = await admin.from('chat_turns').select('created_at').eq('user_id', member.userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (last.error) throw new Error(`chat turn read: ${last.error.message}`);
  const lastAt = last.data ? Date.parse(String((last.data as { created_at: string }).created_at)) : Number.NaN;
  if (Number.isFinite(lastAt) && now.getTime() - lastAt < settings.minSeconds * 1000) return { kind: 'too_fast' };

  if (!member.admin) {
    const dayStart = londonDayStart(ukDay(now)) ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Uncharged questions that still cost us: no answer, or failed after the model ran (a page closed part-way, again and again).
    const { count, error } = await admin.from('chat_turns').select('id', { count: 'exact', head: true }).eq('user_id', member.userId).or('status.eq.no_answer,and(status.eq.failed,rounds.gt.0)').gte('created_at', dayStart.toISOString());
    if (error) throw new Error(`chat turn count: ${error.message}`);
    if ((count ?? 0) >= settings.maxUnchargedPerDay) return { kind: 'uncharged_cap' };
  }
  return { kind: 'ok' };
}

export type Inserted = { kind: 'inserted'; turn: TurnRow } | { kind: 'existing'; turn: TurnRow } | { kind: 'busy' };

/** The pending row. A duplicate client id returns the first; another pending question means "still answering". */
export async function insertTurn(admin: Admin, member: ChatMember, clientTurnId: string, surface: ChatSurface): Promise<Inserted> {
  const { data, error } = await admin
    .from('chat_turns')
    .insert({ user_id: member.userId, payer_id: member.payerId, client_turn_id: clientTurnId, surface, model: MODEL_FOR[surface] })
    .select(TURN_COLUMNS)
    .single();
  if (!error && data) return { kind: 'inserted', turn: rowOf(data as Record<string, unknown>) };
  if (error?.code === '23505') {
    const again = await admin.from('chat_turns').select(TURN_COLUMNS).eq('user_id', member.userId).eq('client_turn_id', clientTurnId).maybeSingle();
    if (again.data) return { kind: 'existing', turn: rowOf(again.data as Record<string, unknown>) };
    return { kind: 'busy' };
  }
  throw new Error(`chat turn insert: ${error?.message ?? 'no row'}`);
}

export async function turnFor(admin: Admin, userId: string, turnId: string): Promise<TurnRow | null> {
  if (!isUuid(turnId)) return null;
  const { data } = await admin.from('chat_turns').select(TURN_COLUMNS).eq('id', turnId).eq('user_id', userId).maybeSingle();
  return data ? rowOf(data as Record<string, unknown>) : null;
}

// ── The hold ────────────────────────────────────────────────────────────────

/**
 * The hold: startAction with the budget, requireCredit (so it holds even in
 * shadow mode) and the chat's own markup. The turn id is the action id, so
 * the ledger groups the question's lines into one row. Throws
 * InsufficientCreditError (SeatPausedError for a paused seat) when the
 * budget can't be held.
 */
export async function startHold(member: ChatMember, turn: TurnRow, budgetPence: number, settings: ChatSettings): Promise<StartedAction> {
  return startAction({ userId: member.userId, admin: member.admin, action: CHAT_ACTION[turn.surface], actionId: turn.id, maxBasePence: budgetPence, requireCredit: true, markupOverride: settings.markup });
}

// ── Settling a question ─────────────────────────────────────────────────────

export interface Settlement {
  status: Exclude<TurnStatus, 'pending'>;
  outcome: QuestionOutcome | null;
  rounds: readonly RoundUsage[];
  toolsUsed?: readonly string[];
  knowledgeSlug?: string | null;
  /** The matcher's best score for the question, when it was looked up. */
  matchConfidence?: number | null;
  conversationId?: string | null;
  questionId?: string | null;
  logSeq?: number | null;
  capped?: boolean;
  factProposal?: FactProposal | null;
  buttons?: readonly ChatButton[];
  /** The question's hold: the charge never passes it, whatever the rounds cost. */
  capPence?: number;
}

export interface Settled {
  /** This process settled the question (false: another one already had). */
  won: boolean;
  chargedBasePence: number;
  /** What came off the balance (a grant's spend rate applied), for "Charged 0.9p". */
  chargedFacePence: number;
}

/**
 * Closes a question once. Only the process that moves it out of pending
 * meters it: an answered question against the member's hold (charged), any
 * other outcome as house spend (logged, never charged). Call before the
 * hold's finish(): the meter settles against the open reservation.
 */
export async function settle(admin: Admin, turn: TurnRow, member: ChatMember, action: StartedAction | null, s: Settlement, settings: ChatSettings): Promise<Settled> {
  const total = s.rounds.reduce((a, r) => ({ input: a.input + r.input, output: a.output + r.output, cacheRead: a.cacheRead + r.cacheRead, cacheWrite: a.cacheWrite + r.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const table = await getUnitCostTable();
  const units = MODEL_UNITS[turn.surface];
  const cost = costOf(table, units, s.rounds, settings.markup);
  const won = await admin
    .from('chat_turns')
    .update({
      status: s.status,
      outcome: s.outcome,
      rounds: s.rounds.length,
      tools_used: [...new Set(s.toolsUsed ?? [])],
      knowledge_slug: s.knowledgeSlug ?? null,
      match_confidence: typeof s.matchConfidence === 'number' && Number.isFinite(s.matchConfidence) ? Math.round(s.matchConfidence * 1000) / 1000 : null,
      conversation_id: s.conversationId ?? null,
      question_id: s.questionId ?? null,
      log_seq: s.logSeq ?? null,
      input_tokens: total.input,
      output_tokens: total.output,
      cache_read_tokens: total.cacheRead,
      cache_write_tokens: total.cacheWrite,
      raw_pence: cost.rawPence,
      capped: Boolean(s.capped),
      fact_proposal: s.factProposal ?? null,
      buttons: s.buttons && s.buttons.length > 0 ? s.buttons : null,
      answered_at: new Date().toISOString(),
    })
    .eq('id', turn.id)
    .eq('status', 'pending')
    .select('id');
  if (won.error) throw new Error(`chat turn settle: ${won.error.message}`);
  if ((won.data ?? []).length === 0) return { won: false, chargedBasePence: 0, chargedFacePence: 0 };

  const charge = s.status === 'answered' && action !== null && !member.admin;
  let ctx: MeterContext = charge ? action.ctx : { userId: null, admin: member.admin, action: UNBILLED_ACTION, actionId: turn.id };
  // The rounds are sized to fit the hold; if the prompt cache missed and they didn't, the charge is
  // scaled to the hold (the ceiling or the balance): a question never costs more than either.
  if (charge && s.capPence !== undefined && cost.basePence > s.capPence && cost.basePence > 0) {
    ctx = { ...ctx, markupOverride: settings.markup * Math.max(0, s.capPence - 0.01) / cost.basePence };
  }
  await meterRounds(ctx, turn.surface, s.rounds, table);
  if (!charge) return { won: true, chargedBasePence: 0, chargedFacePence: 0 };

  const spent = await actionSpend(turn.id);
  await admin.from('chat_turns').update({ charged_base_pence: spent.basePence, charged_face_pence: spent.chargedPence }).eq('id', turn.id);
  return { won: true, chargedBasePence: spent.basePence, chargedFacePence: spent.chargedPence };
}

/** A model call that threw before any usage came back: logged as a failed call (house, nothing charged) so the spend views see it. */
export async function logFailedCall(turn: TurnRow, member: ChatMember): Promise<void> {
  const ctx: MeterContext = { userId: null, admin: member.admin, action: UNBILLED_ACTION, actionId: turn.id };
  try {
    await meter({ provider: PROVIDER, unit: MODEL_UNITS[turn.surface].output, quantity: 0, skipPreflight: true, description: CHARGE_DESCRIPTION, question: CHAT_ACTION[turn.surface] }, async () => {
      throw new Error('model call failed');
    }, ctx);
  } catch {
    /* logged by the meter */
  }
}

/**
 * Every round's tokens through the meter: one provider_calls row per token
 * type per round (the spend views see each model call), and, under a
 * member's context, one debit each against the hold. Under the house context
 * the same rows are logged and nothing is charged.
 */
async function meterRounds(ctx: MeterContext, surface: ChatSurface, rounds: readonly RoundUsage[], table: Awaited<ReturnType<typeof getUnitCostTable>>): Promise<void> {
  for (const round of rounds) {
    for (const line of chargeLines(table, MODEL_UNITS[surface], round, 1)) {
      try {
        await meter({ provider: PROVIDER, unit: line.unit, quantity: line.quantity, skipPreflight: true, description: CHARGE_DESCRIPTION, question: CHAT_ACTION[surface] }, async () => null, ctx);
      } catch (err) {
        // The meter never throws on a debit (it logs); this is the provider_calls insert failing. Keep going.
        console.error('[chat] meter failed:', (err as Error)?.message ?? err);
      }
    }
  }
}
