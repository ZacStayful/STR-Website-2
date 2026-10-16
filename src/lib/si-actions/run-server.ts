import 'server-only';

/**
 * Batch 27: carrying out an instruction.
 *
 *   finaliseInstruction  right after the answer is delivered (the chat's own
 *                        request): the free steps run (Keep / Pass, stage
 *                        moves, profile changes), and the charged ones are
 *                        set to count down, wait for a yes, or stay blocked
 *   nextStep             after the Stop countdown, the page asks for the next
 *                        charged step, one at a time (two analyses at once,
 *                        like Part H's "Analyse all"). The first claim stamps
 *                        charged_started_at: from then on Stop can only stop
 *                        what hasn't started. Each step is claimed once (its
 *                        id is the idempotency key), the live balance is
 *                        checked before it, and it is started by its
 *                        button's own code
 *   stopInstruction / confirmInstruction / keepLink
 *   instructionView      the card, after settling any step whose long part
 *                        ran through its button's own route
 *
 * Nothing here charges. A step that fails, times out or finds nothing is
 * charged only what its own code charges for that (a failed analysis or PMI
 * opinion nothing; a deep search its cost, as the button: Zac, 11 Oct).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { getBalance } from '../credit/ledger';
import { CHARGED_KINDS, RUNNING_STALE_MS } from './config';
import { laterCheck, type PricedStep } from './spend';
import { cardView, doneLines, type ActionCardView } from './view';
import { actionsOn, claimStep, instructionFor, liveInstructionFor, logActionLine, moveInstruction, moveSteps, readActionConfig, stepPayload, stepsFor, updateStep, type InstructionRow, type StepRow } from './store-server';
import { applyWhatIf } from '../intelligence/what-if-apply-server';
import { questionById } from '../profile/questions';
import { activeProfileFor } from '../profiles/server';
import { applyCriteria, criteriaNow, checkLink, handOutPmi, keepCheckedListing, runStageStep, startAnalysis, startSearch, type ActingMember, type ChargedStart, type HandOut } from './steps-server';
import { fileAutoBug, unexpectedFailure } from './report-server';
import { leftBehind } from './live';
import type { PipelineStatus } from '../listing/pipeline';
import type { ChatReply } from '../chat/reply';

export type Admin = ReturnType<typeof createAdminClient>;

const iso = (d: Date = new Date()) => d.toISOString();

/** What a credit-short step tells the page: Batch 20's offer opens with these. */
export interface OutOfCredit {
  requiredPence: number;
  availablePence: number;
}

async function autoTopupOn(admin: Admin, payerId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('auto_topup_amount_pence').eq('id', payerId).maybeSingle();
  return Boolean((data as { auto_topup_amount_pence?: number | null } | null)?.auto_topup_amount_pence);
}

async function spendable(m: ActingMember): Promise<number> {
  if (m.admin) return Number.POSITIVE_INFINITY;
  return (await getBalance(m.payerId).catch(() => null))?.spendableBasePence ?? 0;
}

async function view(admin: Admin, m: ActingMember, i: InstructionRow, steps: readonly StepRow[], now: Date = new Date()): Promise<ActionCardView> {
  const config = await readActionConfig(admin);
  const needsCredit = i.status === 'blocked' || i.status === 'awaiting_confirm';
  const [s, auto] = needsCredit ? await Promise.all([spendable(m), autoTopupOn(admin, m.payerId)]) : [null, false];
  return cardView(i, steps, { now, undoHours: config.undoHours, spendableBasePence: s, autoTopupOn: auto });
}

// ── After the answer ────────────────────────────────────────────────────────

/** A free step, run now. Never throws: a failure is the step's, recorded on it. */
async function runFreeStep(m: ActingMember, supabase: SupabaseClient, i: InstructionRow, s: StepRow): Promise<void> {
  const admin = createAdminClient();
  if (!(await claimStep(admin, s.id, 'queued', 'running', { started_at: iso() }))) return;
  try {
    if (s.action === 'keep' || s.action === 'pass' || s.action === 'stage_move') {
      const r = await runStageStep(m, i.id, { action: s.action, dealId: String(s.deal_id), stage: String(s.params.stage) as PipelineStatus });
      if (r.ok) await updateStep(admin, s.id, { status: 'done', before: r.before, after: r.after, finished_at: iso() });
      else {
        await updateStep(admin, s.id, { status: 'failed', error_code: r.code, finished_at: iso() });
        if (unexpectedFailure(r.code)) {
          const rep = await fileAutoBug({ userId: m.userId, email: m.email, instructionId: i.id, stepId: s.id, action: s.action, code: r.code, detail: 'The stage change did not save.' }).catch(() => null);
          if (rep && rep.ok) await updateStep(admin, s.id, { report_ref: rep.ref });
        }
      }
      return;
    }
    if (s.action === 'change_criteria') {
      const after = (s.after ?? {}) as { value?: unknown; label?: string; countBefore?: number | null; countAfter?: number | null };
      const r = await applyCriteria(m, supabase, String(s.params.savedAs), after.value);
      if (r.ok) await updateStep(admin, s.id, { status: 'done', after: { ...after, countAfter: r.countAfter ?? after.countAfter ?? null }, finished_at: iso() });
      else {
        // A save that failed on our side is a system error (the question isn't charged, and it is reported).
        await updateStep(admin, s.id, { status: 'failed', error_code: r.ours ? 'failed' : 'bad_value', undo_note: r.error.slice(0, 200), finished_at: iso() });
        if (r.ours) {
          const rep = await fileAutoBug({ userId: m.userId, email: m.email, instructionId: i.id, stepId: s.id, action: s.action, code: 'failed', detail: 'The profile change did not save.' }).catch(() => null);
          if (rep && rep.ok) await updateStep(admin, s.id, { report_ref: rep.ref });
        }
      }
      return;
    }
    await updateStep(admin, s.id, { status: 'failed', error_code: 'failed', finished_at: iso() });
  } catch (err) {
    console.error('[si-actions] free step failed:', (err as Error)?.message ?? err);
    await updateStep(admin, s.id, { status: 'failed', error_code: 'failed', finished_at: iso() });
    const rep = await fileAutoBug({ userId: m.userId, email: m.email, instructionId: i.id, stepId: s.id, action: s.action, code: 'threw', detail: 'A free step threw before it finished.' }).catch(() => null);
    if (rep && rep.ok) await updateStep(admin, s.id, { report_ref: rep.ref });
  }
}

/**
 * Called by the chat once its answer has passed its checks and been shown
 * (delivered = true), or when it wasn't (the page went, a refused answer):
 * then nothing in the instruction runs. Returns the card, or null when the
 * question made no instruction.
 */
export interface Finalised {
  card: ActionCardView | null;
  /** A free step failed on our side (and was reported): the question isn't charged (Zac, 11 Oct). */
  systemError: boolean;
}

export async function finaliseInstruction(m: ActingMember, supabase: SupabaseClient, turnId: string, o: { delivered: boolean; conversationId: string | null; now?: Date }): Promise<Finalised> {
  const admin = createAdminClient();
  const loaded = await instructionFor(admin, m.userId, turnId);
  if (!loaded || loaded.instruction.status !== 'proposed') return { card: loaded ? await view(admin, m, loaded.instruction, loaded.steps) : null, systemError: false };
  const { instruction: i } = loaded;
  if (!o.delivered) {
    await moveInstruction(admin, i.id, m.userId, ['proposed'], 'cancelled');
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'not_delivered' });
    return { card: null, systemError: false };
  }
  const now = o.now ?? new Date();
  await admin.from('si_instructions').update({ conversation_id: o.conversationId, updated_at: iso(now) }).eq('id', i.id);

  // The free steps, in order, now.
  for (const s of loaded.steps) if (s.status === 'queued' && !CHARGED_KINDS.has(s.action)) await runFreeStep(m, supabase, i, s);

  const steps = await stepsFor(admin, i.id);
  const chargedLeft = steps.some((s) => CHARGED_KINDS.has(s.action) && (s.status === 'queued' || s.status === 'deferred'));
  const config = await readActionConfig(admin);
  let to: InstructionRow['status'] = 'done';
  if (chargedLeft) to = i.decision === 'run' ? 'ready' : i.decision === 'confirm' ? 'awaiting_confirm' : i.decision === 'insufficient' ? 'blocked' : 'done';
  const patch = to === 'ready' ? { starts_after: iso(new Date(now.getTime() + config.stopGraceSeconds * 1000)) } : {};
  if (!(await moveInstruction(admin, i.id, m.userId, ['proposed'], to, patch))) {
    // Another instruction is counting down or running (the one-at-a-time index): nothing charged starts.
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'busy' });
    await moveInstruction(admin, i.id, m.userId, ['proposed'], 'done');
  }
  if (to === 'blocked') await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'insufficient_credit' });

  // The spend line and what was done, into the conversation log (the chat history shows them).
  const lines = [...doneLines(steps), ...(to === 'ready' && i.spend_line ? [`${i.spend_line}.`] : []), ...(to === 'awaiting_confirm' && i.spend_line ? [`${i.spend_line} — waiting for your yes.`] : []), ...(to === 'blocked' ? ['Not enough credit for the rest, so nothing that costs anything ran.'] : [])];
  if (lines.length > 0) await logActionLine(admin, o.conversationId, lines.join('. ').replace(/\.\./g, '.'));

  const fresh = await instructionFor(admin, m.userId, i.id);
  const systemError = steps.some((s) => s.status === 'failed' && (s.error_code === 'failed' || s.error_code === 'threw' || s.report_ref !== null));
  return { card: fresh ? await view(admin, m, fresh.instruction, fresh.steps) : null, systemError };
}

// ── Reconciling the steps whose long part ran through a button's route ──────

const FAILURE_CODES = new Set(['insufficient_credit', 'price_changed', 'gone', 'missing', 'held', 'checking', 'running', 'already_done', 'seat_paused', 'unavailable', 'incomplete', 'expired', 'abandoned']);

function failureCode(raw: string | null | undefined): string {
  const f = String(raw ?? '').split(':').pop() ?? '';
  return FAILURE_CODES.has(f) ? f : f.includes('credit') ? 'insufficient_credit' : 'failed';
}

async function reconcile(admin: Admin, m: ActingMember, i: InstructionRow, steps: StepRow[], now: Date): Promise<boolean> {
  let changed = false;
  for (const s of steps.filter((x) => x.status === 'handed_out' && x.ledger_ref)) {
    const started = s.started_at ? Date.parse(s.started_at) : now.getTime();
    let outcome: { status: 'done' | 'failed'; after?: Record<string, unknown>; code?: string } | null = null;
    if (s.action === 'deep_search') {
      const { data } = await admin.from('member_searches').select('status, found, stop_reason').eq('id', s.ledger_ref).maybeSingle();
      const r = data as { status?: string; found?: number; stop_reason?: string | null } | null;
      if (r?.status === 'done') outcome = { status: 'done', after: { found: r.found ?? 0 } };
      else if (r?.status === 'failed' || !r) outcome = { status: 'failed', code: failureCode(r?.stop_reason) };
    } else if (s.action === 'deep_report' && s.params.addOn === true) {
      const { data } = await admin.from('analysis_purchases').select('status, failure').eq('report_id', s.ledger_ref).eq('kind', 'pmi_addon').eq('buyer_id', m.userId).gte('created_at', new Date(started - 60_000).toISOString()).order('created_at', { ascending: false }).limit(1);
      const r = ((data ?? []) as { status: string; failure: string | null }[])[0];
      if (r?.status === 'complete') outcome = { status: 'done', after: { reportId: s.ledger_ref } };
      else if (r?.status === 'failed') outcome = { status: 'failed', code: failureCode(r.failure) };
      else if (!r && now.getTime() - started > 5 * 60_000) outcome = { status: 'failed', code: 'expired' };
    } else {
      const { data } = await admin.from('analysis_purchases').select('status, report_id, failure, run_started_at').eq('id', s.ledger_ref).maybeSingle();
      const r = data as { status?: string; report_id?: string | null; failure?: string | null; run_started_at?: string | null } | null;
      if (r?.status === 'complete') outcome = { status: 'done', after: { reportId: r.report_id ?? null } };
      else if (r?.status === 'failed' || !r) outcome = { status: 'failed', code: failureCode(r?.failure) };
      // Its run was never asked for (the page went): its own window closes and its hold is released; nothing more is charged.
      else if (!r.run_started_at && now.getTime() - started > 12 * 60_000) outcome = { status: 'failed', code: 'expired' };
    }
    if (!outcome) continue;
    changed = true;
    if (!(await claimStep(admin, s.id, 'handed_out', outcome.status, { finished_at: iso(now), ...(outcome.after ? { after: { ...(s.after ?? {}), ...outcome.after } } : {}), ...(outcome.code ? { error_code: outcome.code } : {}) }))) continue;
    if (outcome.status === 'failed' && unexpectedFailure(outcome.code)) {
      const rep = await fileAutoBug({ userId: m.userId, email: m.email, instructionId: i.id, stepId: s.id, action: s.action, code: outcome.code ?? 'failed', detail: 'The step was started but did not finish.' }).catch(() => null);
      if (rep && rep.ok) await updateStep(admin, s.id, { report_ref: rep.ref });
    }
  }
  return changed;
}

/** Closes a running instruction once nothing in it is still going: done, stopped, or the rest past the cap waiting for a yes. */
async function settleIfIdle(admin: Admin, m: ActingMember, i: InstructionRow, steps: readonly StepRow[]): Promise<void> {
  if (i.status !== 'running') return;
  if (steps.some((s) => s.status === 'queued' || s.status === 'running' || s.status === 'handed_out')) return;
  if (!i.stopped_at && steps.some((s) => s.status === 'deferred')) {
    const laterFace = steps.filter((s) => s.status === 'deferred').reduce((a, s) => a + s.quote_face_pence, 0);
    const balance = m.admin ? null : await getBalance(m.payerId).catch(() => null);
    // A new question: an earlier low-credit yes isn't this one's answer (the admin counts each confirm once).
    await moveInstruction(admin, i.id, m.userId, ['running'], 'awaiting_confirm', { confirm_kind: 'over_cap', confirm_answer: null, confirmed_at: null, later_face_pence: laterFace, balance_before_pence: balance ? balance.totalPence : i.balance_before_pence });
    return;
  }
  await moveInstruction(admin, i.id, m.userId, ['running'], i.stopped_at ? 'stopped' : 'done');
}

/**
 * Closes the member's live instruction if its page has gone (live.ts): a
 * countdown nobody acted on expires, a start that never finished fails, and
 * queued steps nobody is going to start are skipped. Called before a new
 * instruction is judged busy, so a closed tab never blocks the next one
 * until the nightly job. Nothing charged is started or undone here.
 */
export async function freshenLive(m: ActingMember, now: Date = new Date()): Promise<void> {
  const admin = createAdminClient();
  const live = await liveInstructionFor(admin, m.userId);
  if (!live) return;
  let loaded = await instructionFor(admin, m.userId, live.id);
  if (!loaded) return;
  if (await reconcile(admin, m, loaded.instruction, loaded.steps, now)) loaded = (await instructionFor(admin, m.userId, live.id))!;
  const left = leftBehind(loaded.instruction, loaded.steps, now);
  if (left.expire) {
    if (await moveInstruction(admin, live.id, m.userId, ['ready'], 'expired')) await moveSteps(admin, live.id, ['queued', 'deferred'], 'skipped', { error_code: 'expired' });
    return;
  }
  for (const stepId of left.abandon) {
    if (!(await claimStep(admin, stepId, 'running', 'failed', { error_code: 'abandoned', finished_at: iso(now) }))) continue;
    const s = loaded.steps.find((x) => x.id === stepId)!;
    const rep = await fileAutoBug({ userId: m.userId, email: m.email, instructionId: live.id, stepId, action: s.action, code: 'abandoned', detail: 'The step was claimed but its start never finished.' }).catch(() => null);
    if (rep && rep.ok) await updateStep(admin, stepId, { report_ref: rep.ref });
  }
  if (left.skipQueued) await moveSteps(admin, live.id, ['queued'], 'skipped', { error_code: 'expired' });
  if (left.abandon.length > 0 || left.skipQueued) {
    loaded = (await instructionFor(admin, m.userId, live.id))!;
    await settleIfIdle(admin, m, loaded.instruction, loaded.steps);
  }
}

/**
 * The card of a question already answered, for a retry or "Try again" that
 * gets the stored answer: so a page that came back can still Stop, confirm
 * or Undo. Null when the question planned nothing.
 */
export async function storedCard(m: ActingMember, turnId: string): Promise<ActionCardView | null> {
  const loaded = await instructionFor(createAdminClient(), m.userId, turnId);
  if (!loaded || loaded.steps.length === 0) return null;
  return instructionView(m, turnId);
}

/** A stored reply with its card, when its question planned anything. */
export async function withStoredCard(reply: ChatReply, m: ActingMember): Promise<ChatReply> {
  if (!reply.turnId || reply.state === 'busy') return reply;
  const card = await storedCard(m, reply.turnId).catch(() => null);
  return card ? { ...reply, actions: card } : reply;
}

/** The card as it stands now (and anything whose own route has finished, settled). */
export async function instructionView(m: ActingMember, id: unknown, now: Date = new Date()): Promise<ActionCardView | null> {
  const admin = createAdminClient();
  let loaded = await instructionFor(admin, m.userId, id);
  if (!loaded) return null;
  const changed = await reconcile(admin, m, loaded.instruction, loaded.steps, now);
  if (changed || loaded.instruction.status === 'running') {
    loaded = (await instructionFor(admin, m.userId, loaded.instruction.id))!;
    await settleIfIdle(admin, m, loaded.instruction, loaded.steps);
    loaded = (await instructionFor(admin, m.userId, loaded.instruction.id))!;
  }
  return view(admin, m, loaded.instruction, loaded.steps, now);
}

// ── The charged steps, one at a time ────────────────────────────────────────

export type NextResult =
  | { kind: 'card'; card: ActionCardView }
  /** Not yet: the Stop countdown still has this long to run. */
  | { kind: 'wait'; card: ActionCardView; waitMs: number }
  | { kind: 'started'; card: ActionCardView; handOut: HandOut | null }
  | { kind: 'out_of_credit'; card: ActionCardView; credit: OutOfCredit };

export async function nextStep(m: ActingMember, supabase: SupabaseClient, id: unknown, now: Date = new Date()): Promise<NextResult | null> {
  const admin = createAdminClient();
  let loaded = await instructionFor(admin, m.userId, id);
  if (!loaded) return null;
  let i = loaded.instruction;
  const config = await readActionConfig(admin);
  // Switched off on the admin page: nothing more starts, including what was already counting down or running.
  if (!actionsOn(config) && (i.status === 'ready' || i.status === 'running')) {
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'switched_off' });
    await moveInstruction(admin, i.id, m.userId, ['ready'], 'expired');
    return { kind: 'card', card: (await instructionView(m, i.id, now))! };
  }
  if (i.status === 'ready') {
    const startsAt = i.starts_after ? Date.parse(i.starts_after) : 0;
    // The countdown is the Stop window: nothing charged starts before it ends, whatever the page asks.
    if (now.getTime() < startsAt) return { kind: 'wait', card: await view(admin, m, i, loaded.steps, now), waitMs: startsAt - now.getTime() };
    if (now.getTime() - startsAt > config.confirmMinutes * 60_000) {
      await moveInstruction(admin, i.id, m.userId, ['ready'], 'expired');
      await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'expired' });
      return { kind: 'card', card: (await instructionView(m, i.id, now))! };
    }
    // The first charged step: from here Stop only stops what hasn't started.
    await admin.from('si_instructions').update({ status: 'running', charged_started_at: iso(now), updated_at: iso(now) }).eq('id', i.id).eq('user_id', m.userId).eq('status', 'ready').is('stopped_at', null);
    loaded = (await instructionFor(admin, m.userId, i.id))!;
    i = loaded.instruction;
  }
  if (i.status !== 'running' || i.stopped_at) return { kind: 'card', card: await instructionView(m, i.id, now).then((c) => c!) };

  const step = loaded.steps.find((s) => s.status === 'queued' && CHARGED_KINDS.has(s.action));
  if (!step) return { kind: 'card', card: (await instructionView(m, i.id, now))! };
  if (!(await claimStep(admin, step.id, 'queued', 'running', { started_at: iso(now) }))) return { kind: 'card', card: (await instructionView(m, i.id, now))! };
  // A Stop that landed between reading the instruction and the claim wins: the step goes back unstarted.
  const { data: stop } = await admin.from('si_instructions').select('stopped_at').eq('id', i.id).eq('user_id', m.userId).maybeSingle();
  if ((stop as { stopped_at?: string | null } | null)?.stopped_at) {
    await claimStep(admin, step.id, 'running', 'stopped', { started_at: null });
    return { kind: 'card', card: (await instructionView(m, i.id, now))! };
  }

  // The balance when its turn comes (another charge, or a run already holding credit, may have used it).
  const have = await spendable(m);
  if (have + 0.005 < step.quote_base_pence) {
    await updateStep(admin, step.id, { status: 'skipped', error_code: 'insufficient_credit', finished_at: iso(now) });
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'insufficient_credit' });
    return { kind: 'out_of_credit', card: (await instructionView(m, i.id, now))!, credit: { requiredPence: step.quote_base_pence, availablePence: Math.max(0, Math.round(have)) } };
  }

  let r: ChargedStart;
  try {
    if (step.action === 'full_analysis' || (step.action === 'deep_report' && step.params.addOn !== true)) r = await startAnalysis(m, supabase, step.id, { dealId: String(step.deal_id), withPmi: step.action === 'deep_report', quotedBasePence: step.quote_base_pence });
    else if (step.action === 'deep_report') r = typeof step.params.reportId === 'string' ? handOutPmi(step.id, step.params.reportId, step.quote_base_pence) : { ok: false, code: 'missing' };
    else if (step.action === 'deep_search') r = await startSearch(m, Number(step.params.upToBasePence ?? step.quote_base_pence));
    else if (step.action === 'check_link') r = await checkLink(m, supabase, i.id, String(step.params.url ?? ''));
    else r = { ok: false, code: 'failed' };
  } catch (err) {
    console.error('[si-actions] charged step threw:', (err as Error)?.message ?? err);
    r = { ok: false, code: 'threw' };
  }

  if (r.ok) {
    await updateStep(admin, step.id, {
      status: r.done ? 'done' : 'handed_out',
      ledger_ref: r.ledgerRef,
      ...(r.after ? { after: { ...(step.after ?? {}), ...r.after } } : {}),
      ...(r.payload ? { payload: r.payload } : {}),
      ...(r.done ? { finished_at: iso() } : {}),
    });
    loaded = (await instructionFor(admin, m.userId, i.id))!;
    await settleIfIdle(admin, m, loaded.instruction, loaded.steps);
    return { kind: 'started', card: (await instructionView(m, i.id))!, handOut: r.handOut };
  }

  await updateStep(admin, step.id, { status: r.code === 'insufficient_credit' ? 'skipped' : 'failed', error_code: r.code, finished_at: iso() });
  if (unexpectedFailure(r.code)) {
    const rep = await fileAutoBug({ userId: m.userId, email: m.email, instructionId: i.id, stepId: step.id, action: step.action, code: r.code, detail: 'The step could not be started.' }).catch(() => null);
    if (rep && rep.ok) await updateStep(admin, step.id, { report_ref: rep.ref });
  }
  if (r.code === 'insufficient_credit') {
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'insufficient_credit' });
    return { kind: 'out_of_credit', card: (await instructionView(m, i.id))!, credit: { requiredPence: r.requiredPence ?? step.quote_base_pence, availablePence: Math.max(0, Math.round(r.availablePence ?? have)) } };
  }
  return { kind: 'card', card: (await instructionView(m, i.id))! };
}

/**
 * The page's word that a PMI opinion's own route refused (the price changed,
 * not enough credit, one already running), so the step closes now rather
 * than after reconcile's wait. Believed only when the route made no purchase
 * for it: a purchase settles the step from its own row, as ever. Nothing is
 * charged or refunded here.
 */
export async function handOutRefused(m: ActingMember, id: unknown, stepId: unknown, code: unknown, now: Date = new Date()): Promise<ActionCardView | null> {
  const admin = createAdminClient();
  const loaded = await instructionFor(admin, m.userId, id);
  if (!loaded) return null;
  const s = loaded.steps.find((x) => x.id === stepId && x.status === 'handed_out' && x.action === 'deep_report' && x.params.addOn === true);
  if (s?.ledger_ref) {
    const from = new Date(Date.parse(s.started_at ?? s.created_at) - 60_000).toISOString();
    const { data } = await admin.from('analysis_purchases').select('id').eq('report_id', s.ledger_ref).eq('kind', 'pmi_addon').eq('buyer_id', m.userId).gte('created_at', from).limit(1);
    if ((data ?? []).length === 0) {
      // Only the route's own refusal codes; anything else is "failed" (and never reported on the page's word).
      const c = failureCode(typeof code === 'string' ? code.slice(0, 40) : '');
      await claimStep(admin, s.id, 'handed_out', c === 'insufficient_credit' ? 'skipped' : 'failed', { error_code: c, finished_at: iso(now) });
    }
  }
  return instructionView(m, loaded.instruction.id, now);
}

// ── Stop, a yes or a no, Keep ───────────────────────────────────────────────

/** Stop: before the first charged step, nothing charged runs; after it, what hasn't started doesn't. */
export async function stopInstruction(m: ActingMember, id: unknown): Promise<ActionCardView | null> {
  const admin = createAdminClient();
  const loaded = await instructionFor(admin, m.userId, id);
  if (!loaded) return null;
  const i = loaded.instruction;
  const now = iso();
  let status = i.status;
  if (status === 'ready') {
    if (await moveInstruction(admin, i.id, m.userId, ['ready'], 'stopped', { stopped_at: now })) {
      await moveSteps(admin, i.id, ['queued', 'deferred'], 'stopped');
      return instructionView(m, i.id);
    }
    // The countdown ended as Stop was tapped and the first step was claimed: Stop still stops the rest.
    status = (await instructionFor(admin, m.userId, i.id))?.instruction.status ?? status;
  }
  if (status === 'running') {
    await admin.from('si_instructions').update({ stopped_at: now, updated_at: now }).eq('id', i.id).eq('user_id', m.userId).eq('status', 'running').is('stopped_at', null);
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'stopped');
  } else if (status === 'awaiting_confirm') {
    return confirmInstruction(m, id, false);
  }
  return instructionView(m, i.id);
}

export type ConfirmResult = { card: ActionCardView; credit: OutOfCredit | null };

/** The member's yes or no to the confirm card (the low-credit line, or past the cap). */
export async function confirmInstruction(m: ActingMember, id: unknown, yes: boolean): Promise<ActionCardView | null> {
  return (await confirmWithCredit(m, id, yes))?.card ?? null;
}

export async function confirmWithCredit(m: ActingMember, id: unknown, yes: boolean, now: Date = new Date()): Promise<ConfirmResult | null> {
  const admin = createAdminClient();
  const loaded = await instructionFor(admin, m.userId, id);
  if (!loaded) return null;
  const i = loaded.instruction;
  if (i.status !== 'awaiting_confirm') return { card: (await instructionView(m, i.id, now))!, credit: null };
  const config = await readActionConfig(admin);
  if (now.getTime() - Date.parse(i.updated_at) > config.confirmMinutes * 60_000) {
    await moveInstruction(admin, i.id, m.userId, ['awaiting_confirm'], 'expired');
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'expired' });
    return { card: (await instructionView(m, i.id, now))!, credit: null };
  }
  const started = Boolean(i.charged_started_at);
  if (yes && !actionsOn(config)) {
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'switched_off' });
    await moveInstruction(admin, i.id, m.userId, ['awaiting_confirm'], started ? 'done' : 'expired', { confirm_answer: 'yes', confirmed_at: iso(now) });
    return { card: (await instructionView(m, i.id, now))!, credit: null };
  }
  if (!yes) {
    await moveInstruction(admin, i.id, m.userId, ['awaiting_confirm'], started ? 'done' : 'declined', { confirm_answer: 'no', confirmed_at: iso(now) });
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'declined');
    return { card: (await instructionView(m, i.id, now))!, credit: null };
  }
  // A yes: what it would run now must still be affordable (the balance may have moved). After the low-credit
  // confirm that is the part inside the cap (the rest past it still gets its own question); after the cap's, the rest.
  const overCap = i.confirm_kind === 'over_cap';
  const pending = loaded.steps.filter((s) => s.status === 'queued' || (overCap && s.status === 'deferred'));
  const balance = m.admin ? null : await getBalance(m.payerId).catch(() => null);
  const priced: PricedStep[] = pending.map((s, index) => ({ index, kind: s.action, basePence: s.quote_base_pence, facePence: s.quote_face_pence, opensDeal: s.params.opensDeal === true }));
  const check = m.admin ? { ok: true as const } : laterCheck({ steps: priced, spendableBasePence: balance?.spendableBasePence ?? 0, balanceFacePence: balance?.totalPence ?? 0 });
  if (!check.ok) {
    await moveInstruction(admin, i.id, m.userId, ['awaiting_confirm'], 'blocked', { confirm_answer: 'yes', confirmed_at: iso(now) });
    await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'insufficient_credit' });
    return { card: (await instructionView(m, i.id, now))!, credit: { requiredPence: check.requiredBasePence, availablePence: Math.round(check.availableBasePence) } };
  }
  // Another instruction whose page went away doesn't hold the lock against this yes.
  await freshenLive(m, now).catch(() => undefined);
  // Queued before the instruction moves, so the card's next never finds it running with nothing queued.
  if (overCap) await moveSteps(admin, i.id, ['deferred'], 'queued');
  // The yes is the go-ahead: no second countdown.
  const moved = await moveInstruction(admin, i.id, m.userId, ['awaiting_confirm'], started ? 'running' : 'ready', { confirm_answer: 'yes', confirmed_at: iso(now), starts_after: iso(now) });
  if (!moved) {
    // Still waiting: another instruction is live (the one-at-a-time index), so nothing here starts. Anything else
    // (a second tap of the same yes already moved it) is left alone.
    const still = (await instructionFor(admin, m.userId, i.id))?.instruction.status === 'awaiting_confirm';
    if (still) {
      await moveSteps(admin, i.id, ['queued', 'deferred'], 'skipped', { error_code: 'busy' });
      await moveInstruction(admin, i.id, m.userId, ['awaiting_confirm'], 'done');
    }
  }
  return { card: (await instructionView(m, i.id, now))!, credit: null };
}

/** Keep on a checked listing: into My deals as Kept, the way the Explorer records a check. Once. */
export async function keepLink(m: ActingMember, id: unknown, stepId: unknown): Promise<ActionCardView | null> {
  const admin = createAdminClient();
  const loaded = await instructionFor(admin, m.userId, id);
  if (!loaded || typeof stepId !== 'string') return null;
  const step = loaded.steps.find((s) => s.id === stepId && s.action === 'check_link' && s.status === 'done');
  if (!step || typeof step.after?.checkedListingId === 'string') return instructionView(m, loaded.instruction.id);
  const payload = await stepPayload(admin, step.id, m.userId);
  if (!payload) return instructionView(m, loaded.instruction.id);
  // Claimed by clearing the held snapshot: a double tap can't record it twice.
  const { data: claimed } = await admin.from('si_action_steps').update({ payload: null }).eq('id', step.id).eq('user_id', m.userId).not('payload', 'is', null).select('id');
  if ((claimed ?? []).length === 0) return instructionView(m, loaded.instruction.id);
  const listingId = await keepCheckedListing(m, loaded.instruction.id, payload);
  if (listingId) await updateStep(admin, step.id, { after: { ...(step.after ?? {}), checkedListingId: listingId, keptAt: iso(), keepable: false } });
  else await updateStep(admin, step.id, { payload });
  return instructionView(m, loaded.instruction.id);
}

// ── The nightly tidy (/api/internal/si-actions) ─────────────────────────────

/**
 * Instructions nobody finished: a question that never delivered its answer
 * (proposed for over 10 minutes) is cancelled; a countdown or confirm past
 * si_action_confirm_minutes expires; a run older than RUNNING_STALE_MS is
 * closed (its steps' own code has settled them). A checked listing's held
 * snapshot is cleared once the Undo window has passed without a Keep.
 */
export async function tidyInstructions(o: { apply: boolean; now?: Date }): Promise<{ cancelled: number; expired: number; closed: number; snapshots: number }> {
  const admin = createAdminClient();
  const now = o.now ?? new Date();
  const config = await readActionConfig(admin);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const count = async (q: PromiseLike<{ data: unknown[] | null }>) => ((await q).data ?? []).length;
  if (!o.apply) {
    const [cancelled, expired, closed, snapshots] = await Promise.all([
      count(admin.from('si_instructions').select('id').eq('status', 'proposed').lt('updated_at', ago(10 * 60_000)).limit(1000)),
      count(admin.from('si_instructions').select('id').in('status', ['ready', 'awaiting_confirm']).lt('updated_at', ago(config.confirmMinutes * 60_000)).limit(1000)),
      count(admin.from('si_instructions').select('id').eq('status', 'running').lt('updated_at', ago(RUNNING_STALE_MS)).limit(1000)),
      count(admin.from('si_action_steps').select('id').not('payload', 'is', null).lt('created_at', ago(config.undoHours * 3_600_000)).limit(1000)),
    ]);
    return { cancelled, expired, closed, snapshots };
  }
  const ids = async (q: PromiseLike<{ data: unknown[] | null }>) => ((await q).data ?? []).map((r) => String((r as { id: string }).id));
  const cancelIds = await ids(admin.from('si_instructions').update({ status: 'cancelled', updated_at: now.toISOString(), finished_at: now.toISOString() }).eq('status', 'proposed').lt('updated_at', ago(10 * 60_000)).select('id'));
  const expireIds = await ids(admin.from('si_instructions').update({ status: 'expired', updated_at: now.toISOString(), finished_at: now.toISOString() }).in('status', ['ready', 'awaiting_confirm']).lt('updated_at', ago(config.confirmMinutes * 60_000)).select('id'));
  const closeIds = await ids(admin.from('si_instructions').update({ status: 'done', updated_at: now.toISOString(), finished_at: now.toISOString() }).eq('status', 'running').lt('updated_at', ago(RUNNING_STALE_MS)).select('id'));
  for (const id of [...cancelIds, ...expireIds, ...closeIds]) await moveSteps(admin, id, ['queued', 'deferred'], 'skipped', { error_code: 'expired' });
  const snaps = await ids(admin.from('si_action_steps').update({ payload: null }).not('payload', 'is', null).lt('created_at', ago(config.undoHours * 3_600_000)).select('id'));
  return { cancelled: cancelIds.length, expired: expireIds.length, closed: closeIds.length, snapshots: snaps.length };
}

/**
 * A report the eye filed for the member (a bug, with Batch 18's #ref), or a
 * feature request it filled in for them to send (no ref: the member sends
 * it), kept on the question's instruction row (made for it when the question
 * had none) for the admin's counts.
 */
export async function recordReport(admin: Admin, m: ActingMember, turnId: string, kind: 'bug' | 'feature', ref: number | null): Promise<void> {
  const { error } = await admin.from('si_instructions').insert({ id: turnId, user_id: m.userId, payer_id: m.payerId, status: 'done', decision: 'free', report_kind: kind, report_ref: ref, report_only: true, finished_at: iso() });
  if (error?.code === '23505') {
    await admin.from('si_instructions').update({ report_kind: kind, report_ref: ref }).eq('id', turnId).eq('user_id', m.userId);
  } else if (error) console.error('[si-actions] report record failed:', error.message);
}

// ── The chat's "Use this" (Batch 26's button), now with Undo ────────────────

/**
 * A what-if suggestion the answer offered, applied through Batch 22's own
 * function (applyWhatIf, the view's "Use this"), and recorded as a profile
 * change of the question's instruction so it can be undone for the window,
 * from the chat line or My deals. Only a suggestion this answer's buttons
 * offered.
 */
export async function applyUseThisStep(m: ActingMember, supabase: SupabaseClient, turnId: string, key: unknown): Promise<{ card: ActionCardView | null; error: string | null }> {
  const admin = createAdminClient();
  const { data: turn } = await admin.from('chat_turns').select('buttons').eq('id', turnId).eq('user_id', m.userId).eq('status', 'answered').maybeSingle();
  const offered = (((turn as { buttons?: unknown } | null)?.buttons ?? []) as { kind?: string; whatIfKey?: string | null }[]).some((b) => b.kind === 'use_this' && b.whatIfKey === key);
  if (!offered) return { card: null, error: 'That suggestion has changed. Please ask again.' };
  const active = await activeProfileFor(m.userId).catch(() => null);
  const r = await applyWhatIf({ id: m.userId, email: m.email ?? undefined }, supabase, key);
  if (!r.ok) return { card: null, error: r.error };
  const { error } = await admin.from('si_instructions').insert({ id: turnId, user_id: m.userId, payer_id: m.payerId, status: 'done', decision: 'free', finished_at: iso() });
  if (error && error.code !== '23505') console.error('[si-actions] use-this instruction failed:', error.message);
  const loaded = await instructionFor(admin, m.userId, turnId);
  if (loaded) {
    const now = await criteriaNow(m.userId, r.questionId);
    const label = `${questionById(r.questionId)?.short ?? 'Your profile'}: changed`;
    const seq = loaded.steps.reduce((a, s) => Math.max(a, s.seq), -1) + 1;
    await admin.from('si_action_steps').insert({
      instruction_id: turnId,
      user_id: m.userId,
      seq,
      action: 'change_criteria',
      target_label: label,
      params: { savedAs: r.questionId, whatIf: String(key), via: 'use_this' },
      before: r.undo === null || r.undo === undefined ? null : { value: r.undo },
      after: { value: now?.value ?? r.value, label, countAfter: r.matchCount },
      profile_id: active?.id ?? null,
      status: 'done',
      started_at: iso(),
      finished_at: iso(),
    });
  }
  return { card: await instructionView(m, turnId), error: null };
}
