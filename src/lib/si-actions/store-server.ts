import 'server-only';

/**
 * Batch 27: the instruction and step rows (supabase/schema.sql, "Batch 27"),
 * read and written with the service role. Every read here is scoped to the
 * member the route took from the session: an instruction id from a page is
 * only ever looked up together with that member's id, so one member's
 * instruction can't be read, stopped, confirmed or undone by another.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { LIFECYCLE_KEYS, parseLifecycle } from '../lifecycle/settings';
import { addTurns } from '../conversations/log-server';
import { ACTION_SETTING_KEYS, parseActionSettings, type ActionSettings } from './settings';
import type { InstructionStatus, StepKind, StepStatus } from './config';

export type Admin = ReturnType<typeof createAdminClient>;

export interface InstructionRow {
  id: string;
  user_id: string;
  payer_id: string | null;
  status: InstructionStatus;
  decision: 'free' | 'run' | 'confirm' | 'insufficient';
  confirm_kind: 'low_balance' | 'over_cap' | null;
  confirm_answer: 'yes' | 'no' | null;
  quoted_base_pence: number;
  quoted_face_pence: number;
  later_face_pence: number;
  balance_before_pence: number | null;
  spend_line: string | null;
  conversation_id: string | null;
  starts_after: string | null;
  charged_started_at: string | null;
  stopped_at: string | null;
  report_ref: number | null;
  report_kind: 'bug' | 'feature' | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StepRow {
  id: string;
  instruction_id: string;
  user_id: string | null;
  seq: number;
  action: StepKind;
  deal_id: string | null;
  target_label: string | null;
  params: Record<string, unknown>;
  part: 'now' | 'later';
  quote_base_pence: number;
  quote_face_pence: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  profile_id: string | null;
  payload: Record<string, unknown> | null;
  ledger_ref: string | null;
  status: StepStatus;
  drop_reason: string | null;
  error_code: string | null;
  report_ref: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  undone_at: string | null;
  undo_note: string | null;
}

const INSTRUCTION_COLUMNS = 'id, user_id, payer_id, status, decision, confirm_kind, confirm_answer, quoted_base_pence, quoted_face_pence, later_face_pence, balance_before_pence, spend_line, conversation_id, starts_after, charged_started_at, stopped_at, report_ref, report_kind, created_at, updated_at, finished_at';
// payload is left out on purpose: it is read only by the one step that needs it (keepLink).
const STEP_COLUMNS = 'id, instruction_id, user_id, seq, action, deal_id, target_label, params, part, quote_base_pence, quote_face_pence, before, after, profile_id, ledger_ref, status, drop_reason, error_code, report_ref, created_at, started_at, finished_at, undone_at, undo_note';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function instructionOf(r: Record<string, unknown>): InstructionRow {
  return {
    ...(r as unknown as InstructionRow),
    quoted_base_pence: num(r.quoted_base_pence),
    quoted_face_pence: num(r.quoted_face_pence),
    later_face_pence: num(r.later_face_pence),
    balance_before_pence: r.balance_before_pence === null || r.balance_before_pence === undefined ? null : num(r.balance_before_pence),
  };
}

function stepOf(r: Record<string, unknown>): StepRow {
  return {
    ...(r as unknown as StepRow),
    params: (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>,
    quote_base_pence: num(r.quote_base_pence),
    quote_face_pence: num(r.quote_face_pence),
    payload: null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface ActionConfig extends ActionSettings {
  /** Batch 20's low-credit line (face pence), the one the email and the call use too. */
  lowCreditPence: number;
}

export async function readActionConfig(admin: Admin = createAdminClient()): Promise<ActionConfig> {
  const keys = [...Object.values(ACTION_SETTING_KEYS), LIFECYCLE_KEYS.lowCreditPence];
  const { data } = await admin.from('billing_settings').select('key, value').in('key', keys);
  const rows = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  // Read exactly as Batch 20 reads it, so the eye's line is never a different number from the email's.
  return { ...parseActionSettings(rows), lowCreditPence: parseLifecycle((k) => rows.get(k)).lowCreditPence };
}

/** Actions are on: the setting, and the service role to record them. */
export function actionsOn(config: Pick<ActionSettings, 'enabled'>): boolean {
  return config.enabled && hasServiceRole();
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** One of this member's instructions (never another member's), with its steps in order. */
export async function instructionFor(admin: Admin, userId: string, id: unknown): Promise<{ instruction: InstructionRow; steps: StepRow[] } | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from('si_instructions').select(INSTRUCTION_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`si instruction read: ${error.message}`);
  if (!data) return null;
  const steps = await stepsFor(admin, id);
  return { instruction: instructionOf(data as Record<string, unknown>), steps };
}

export async function stepsFor(admin: Admin, instructionId: string): Promise<StepRow[]> {
  const { data, error } = await admin.from('si_action_steps').select(STEP_COLUMNS).eq('instruction_id', instructionId).order('seq', { ascending: true });
  if (error) throw new Error(`si steps read: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(stepOf);
}

/** The member's instructions still counting down or running (at most one, by the unique index). */
export async function liveInstructionFor(admin: Admin, userId: string): Promise<InstructionRow | null> {
  const { data } = await admin.from('si_instructions').select(INSTRUCTION_COLUMNS).eq('user_id', userId).in('status', ['ready', 'running']).limit(1);
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  return row ? instructionOf(row) : null;
}

/** How many instructions the member gave since a time (cancelled ones too: each cost a question). */
export async function instructionsSince(admin: Admin, userId: string, since: Date): Promise<number> {
  const { count } = await admin.from('si_instructions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since.toISOString()).is('report_kind', null);
  return count ?? 0;
}

/** The member's recent instructions with something Undo could still put back (My deals' banner). */
export async function recentUndoable(admin: Admin, userId: string, since: Date): Promise<{ instruction: InstructionRow; steps: StepRow[] }[]> {
  const { data: steps } = await admin
    .from('si_action_steps')
    .select(STEP_COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'done')
    .is('undone_at', null)
    .in('action', ['keep', 'pass', 'stage_move', 'change_criteria', 'check_link'])
    .gte('finished_at', since.toISOString())
    .order('finished_at', { ascending: false })
    .limit(200);
  const byInstruction = new Map<string, StepRow[]>();
  for (const s of ((steps ?? []) as Record<string, unknown>[]).map(stepOf)) {
    const list = byInstruction.get(s.instruction_id) ?? [];
    list.push(s);
    byInstruction.set(s.instruction_id, list);
  }
  if (byInstruction.size === 0) return [];
  const { data } = await admin.from('si_instructions').select(INSTRUCTION_COLUMNS).eq('user_id', userId).in('id', [...byInstruction.keys()]);
  return ((data ?? []) as Record<string, unknown>[]).map(instructionOf).map((instruction) => ({ instruction, steps: byInstruction.get(instruction.id) ?? [] }));
}

/** A step's held payload (a checked listing's snapshot), for its own step only. */
export async function stepPayload(admin: Admin, stepId: string, userId: string): Promise<Record<string, unknown> | null> {
  const { data } = await admin.from('si_action_steps').select('payload').eq('id', stepId).eq('user_id', userId).maybeSingle();
  const p = (data as { payload?: unknown } | null)?.payload;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface NewStep {
  seq: number;
  action: StepKind;
  deal_id: string | null;
  target_label: string | null;
  params: Record<string, unknown>;
  part: 'now' | 'later';
  quote_base_pence: number;
  quote_face_pence: number;
  status: StepStatus;
  drop_reason: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  profile_id?: string | null;
}

/** The proposed instruction and its steps. Null when this question already has one (one plan per answer). */
export async function insertInstruction(admin: Admin, row: Omit<InstructionRow, 'created_at' | 'updated_at' | 'finished_at' | 'charged_started_at' | 'stopped_at' | 'confirm_answer' | 'starts_after' | 'report_ref' | 'report_kind'>, steps: readonly NewStep[]): Promise<boolean> {
  const { error } = await admin.from('si_instructions').insert(row);
  if (error) {
    if (error.code === '23505') return false;
    throw new Error(`si instruction insert: ${error.message}`);
  }
  if (steps.length > 0) {
    const { error: stepErr } = await admin.from('si_action_steps').insert(steps.map((s) => ({ ...s, instruction_id: row.id, user_id: row.user_id })));
    if (stepErr) {
      await admin.from('si_instructions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', row.id);
      throw new Error(`si steps insert: ${stepErr.message}`);
    }
  }
  return true;
}

/** Moves an instruction from one of `from` to `to` (with any other fields); true when this call made the move. */
export async function moveInstruction(admin: Admin, id: string, userId: string, from: readonly InstructionStatus[], to: InstructionStatus, patch: Record<string, unknown> = {}): Promise<boolean> {
  const now = new Date().toISOString();
  const done = to === 'done' || to === 'stopped' || to === 'declined' || to === 'blocked' || to === 'expired' || to === 'cancelled';
  const { data, error } = await admin
    .from('si_instructions')
    .update({ status: to, updated_at: now, ...(done ? { finished_at: now } : {}), ...patch })
    .eq('id', id)
    .eq('user_id', userId)
    .in('status', [...from])
    .select('id');
  if (error) {
    // The one-live-instruction index: another one is counting down or running.
    if (error.code === '23505') return false;
    throw new Error(`si instruction update: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/** Claims a step (from one status to another): true for the one caller that got it. The step id is the idempotency key. */
export async function claimStep(admin: Admin, stepId: string, from: StepStatus, to: StepStatus, patch: Record<string, unknown> = {}): Promise<boolean> {
  const { data, error } = await admin.from('si_action_steps').update({ status: to, ...patch }).eq('id', stepId).eq('status', from).select('id');
  if (error) throw new Error(`si step claim: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function updateStep(admin: Admin, stepId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('si_action_steps').update(patch).eq('id', stepId);
  if (error) console.error('[si-actions] step update failed:', error.message);
}

/** Every step of an instruction still in one of `from` moves to `to` (Stop, a no, a cap run out). */
export async function moveSteps(admin: Admin, instructionId: string, from: readonly StepStatus[], to: StepStatus, patch: Record<string, unknown> = {}): Promise<void> {
  const { error } = await admin.from('si_action_steps').update({ status: to, ...patch }).eq('instruction_id', instructionId).in('status', [...from]);
  if (error) console.error('[si-actions] steps update failed:', error.message);
}

/**
 * One line into the chat's conversation log (Batch 23), after the question's
 * own turns: the spend line and what was done, so the history shows them.
 * Written only from inside the question's own request, right after its
 * answer, so it can never take the seq the next question's turns will use.
 */
export async function logActionLine(admin: Admin, conversationId: string | null, text: string): Promise<void> {
  if (!conversationId || !text.trim()) return;
  try {
    const { data } = await admin.from('si_conversation_turns').select('seq').eq('conversation_id', conversationId).order('seq', { ascending: false }).limit(1);
    const last = ((data ?? []) as { seq: number }[])[0]?.seq ?? -1;
    await addTurns(conversationId, [{ role: 'agent', text: text.trim() }], last + 1);
  } catch (err) {
    console.error('[si-actions] log line failed:', (err as Error)?.message ?? err);
  }
}
