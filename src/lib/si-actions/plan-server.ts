import 'server-only';

/**
 * Batch 27: the model's plan (the propose_actions tool), checked, priced and
 * recorded while the answer is being written. Nothing runs here: the free
 * steps run once the answer has passed its checks and been delivered
 * (run-server.ts finaliseInstruction), and the charged ones after the Stop
 * countdown or the member's yes.
 *
 * What the model gets back is what it may say: the deals by area and type,
 * the spend line with its exact price, whether the member will be asked
 * first, and what was dropped and why. Every figure in it is one the
 * answer's figure guard then allows.
 */
import { quoteBtlReport } from '../btl/report-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { getBalance } from '../credit/ledger';
import { quoterFor } from '../credit/quote-server';
import { formatPence } from '../credit/deal-pricing';
import { dealCardsByIds } from '../marketplace/queries';
import { cardStatesFor } from '../marketplace/card-state';
import { describeType, type DealCard } from '../marketplace/grid';
import { loadTrackedDeals } from '../listing/tracked-server';
import { ukDay } from '../activity/week';
import { londonDayStart } from '../leads/search';
import { CHARGED_KINDS, DROP_REASONS, isStepKind, type StepKind } from './config';
import { checkPlan, type PlanDeal, type ProposedStep, type ValidStep } from './validate';
import { decideSpend, spendLine, type PricedStep } from './spend';
import { actionsOn, insertInstruction, instructionsSince, liveInstructionFor, readActionConfig, type NewStep } from './store-server';
import { mayCheckLinks, previewCriteria, quoteAnalysis, quoteDeepSearch, quoteLinkCheck, quotePmiAddon, type ActingMember } from './steps-server';
import { freshenLive } from './run-server';

export interface ProposeInput {
  member: ActingMember;
  supabase: SupabaseClient;
  /** The question's chat_turns.id: the instruction's id. */
  turnId: string;
  /** The member's own words (for "remove" in plain words). */
  question: string;
  /** Deal ids this answer's own look-ups returned: the only deals a step may name. */
  seenDeals: ReadonlySet<string>;
  steps: ProposedStep[];
  /** The question's own hold (base pence, its budget): kept out of what the actions may leave. */
  holdPence: number;
  now: Date;
}

/** What the tool returns to the model (JSON). */
export type ProposeResult = Record<string, unknown>;

/** How the eye names a deal: its type and area, never an address ("2 bed flat in LS6"). */
export function dealLabel(card: Pick<DealCard, 'bedrooms' | 'raw_type' | 'tenure' | 'outcode' | 'town'>): string {
  const what = describeType(card) || 'deal';
  const where = card.outcode ?? card.town;
  return where ? `${what} in ${where}` : what;
}

async function planDeals(m: ActingMember, supabase: SupabaseClient, ids: string[]): Promise<Map<string, PlanDeal & { reportId: string | null }>> {
  const out = new Map<string, PlanDeal & { reportId: string | null }>();
  if (ids.length === 0) return out;
  const load = await loadTrackedDeals(m.userId, { scope: 'own', adminUser: m.admin });
  const tracked = new Map(load.view.filter((d) => d.dealId).map((d) => [d.dealId as string, d]));
  const untracked = ids.filter((id) => !load.cards.has(id));
  const [live, states] = await Promise.all([untracked.length > 0 ? dealCardsByIds(untracked, load.visibility) : Promise.resolve([] as DealCard[]), cardStatesFor(supabase as never, m.userId, m.payerId, ids)]);
  const cards = new Map<string, Pick<DealCard, 'bedrooms' | 'raw_type' | 'tenure' | 'outcode' | 'town' | 'btl_pass'>>([...load.cards.entries(), ...live.map((c) => [c.id, c] as const)]);
  for (const id of ids) {
    const card = cards.get(id);
    if (!card) continue;
    const item = tracked.get(id);
    const state = states.get(id);
    out.set(id, {
      dealId: id,
      label: dealLabel(card),
      stage: item ? item.stage : null,
      opened: Boolean(item?.opened || state?.opened || m.admin),
      analysed: Boolean(state?.reportId),
      reportId: state?.reportId ?? null,
      btl: card.btl_pass === true,
    });
  }
  return out;
}

/** The face pence each step takes, worked through the grants in order, so they add up to what the whole takes. */
function faces(quote: (base: number) => number, bases: readonly number[]): number[] {
  const out: number[] = [];
  let cum = 0;
  let prevFace = 0;
  for (const b of bases) {
    cum += b;
    const f = quote(cum);
    out.push(Math.max(0, Math.round((f - prevFace) * 10_000) / 10_000));
    prevFace = f;
  }
  return out;
}

export async function proposeActions(input: ProposeInput): Promise<ProposeResult> {
  const { member: m, now } = input;
  const admin = createAdminClient();
  const config = await readActionConfig(admin);
  if (!actionsOn(config)) return { ok: false, note: 'Doing things for the member is switched off just now: offer the button instead (offer_action).' };

  // Zac: one instruction at a time, and a limit an hour and a day. One whose page went away doesn't count as live.
  await freshenLive(m, now).catch((err) => console.error('[si-actions] freshen live failed:', (err as Error)?.message ?? err));
  const dayStart = londonDayStart(ukDay(now)) ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [lastHour, today, live] = await Promise.all([instructionsSince(admin, m.userId, new Date(now.getTime() - 60 * 60 * 1000)), instructionsSince(admin, m.userId, dayStart), liveInstructionFor(admin, m.userId)]);
  if (lastHour >= config.ratePerHour || today >= config.ratePerDay) return { ok: false, note: 'They have given a lot of instructions in a short time: tell them to try again a little later. Nothing was done.' };

  const wanted = new Set(input.steps.map((s) => s.action));
  const ids = [...new Set(input.steps.map((s) => (s.dealId ?? '').trim().toLowerCase()).filter((id) => input.seenDeals.has(id)))];
  const [deals, search, links] = await Promise.all([
    planDeals(m, input.supabase, ids),
    wanted.has('deep_search') ? quoteDeepSearch(m.userId) : Promise.resolve(null),
    wanted.has('check_link') ? mayCheckLinks() : Promise.resolve(false),
  ]);
  const checked = checkPlan(input.steps, {
    deals,
    maxTargets: config.maxTargets,
    question: input.question,
    deepSearch: !search ? 'off' : search.running ? 'running' : search.quote ? 'available' : 'off',
    linkChecks: links,
  });

  // ── Price every charged step exactly as its own code will; preview every profile change ──
  type Planned = { step: ValidStep; row: NewStep; basePence: number; aboutBasePence: number | null; opensDeal: boolean };
  const planned: Planned[] = [];
  const dropped: NewStep[] = [];
  const dropRow = (action: StepKind, label: string | null, reason: keyof typeof DROP_REASONS): NewStep => ({ seq: 0, action, deal_id: null, target_label: label, params: {}, part: 'now', quote_base_pence: 0, quote_face_pence: 0, status: 'dropped', drop_reason: reason });

  for (const step of checked.steps) {
    const base: NewStep = { seq: 0, action: step.kind, deal_id: 'dealId' in step ? step.dealId : null, target_label: 'label' in step ? step.label : null, params: {}, part: 'now', quote_base_pence: 0, quote_face_pence: 0, status: 'queued', drop_reason: null };
    if (step.kind === 'keep' || step.kind === 'pass' || step.kind === 'stage_move') {
      planned.push({ step, row: { ...base, params: { stage: step.stage, from: step.from } }, basePence: 0, aboutBasePence: null, opensDeal: false });
    } else if (step.kind === 'change_criteria') {
      const p = await previewCriteria(m, step.question, step.value);
      if ('reason' in p) {
        dropped.push({ ...dropRow('change_criteria', step.question, p.reason === 'failed' ? 'bad_value' : p.reason), params: { question: step.question, value: step.value, message: 'message' in p ? (p.message ?? null) : null } });
        continue;
      }
      planned.push({ step, row: { ...base, target_label: p.label, params: { question: step.question, value: step.value, savedAs: p.savedAs }, before: { value: p.before, countBefore: p.countBefore }, after: { value: p.value, label: p.label, countBefore: p.countBefore, countAfter: p.countAfter }, profile_id: p.profileId }, basePence: 0, aboutBasePence: null, opensDeal: false });
    } else if (step.kind === 'full_analysis') {
      const q = await quoteAnalysis(m, step.dealId, false);
      if (!q) {
        dropped.push(dropRow('full_analysis', step.label, 'not_seen'));
        continue;
      }
      planned.push({ step, row: { ...base, params: { withPmi: false } }, basePence: q.basePence, aboutBasePence: null, opensDeal: q.opensDeal });
    } else if (step.kind === 'deep_report') {
      const reportId = step.addOn ? (deals.get(step.dealId)?.reportId ?? null) : null;
      if (step.addOn && reportId) {
        const price = await quotePmiAddon(m);
        planned.push({ step, row: { ...base, params: { withPmi: true, addOn: true, reportId } }, basePence: price, aboutBasePence: null, opensDeal: false });
      } else {
        const q = await quoteAnalysis(m, step.dealId, true);
        if (!q) {
          dropped.push(dropRow('deep_report', step.label, 'not_seen'));
          continue;
        }
        planned.push({ step, row: { ...base, params: { withPmi: true, addOn: false } }, basePence: q.basePence, aboutBasePence: null, opensDeal: q.opensDeal });
      }
    } else if (step.kind === 'deep_search') {
      const q = search?.quote;
      if (!q) {
        dropped.push(dropRow('deep_search', null, 'deep_search_off'));
        continue;
      }
      planned.push({ step, row: { ...base, target_label: q.areas.length > 0 ? q.areas.slice(0, 6).join(', ') : null, params: { upToBasePence: q.upToBasePence, firstDiscount: q.firstDiscount } }, basePence: q.upToBasePence, aboutBasePence: q.aboutBasePence, opensDeal: false });
    } else if (step.kind === 'btl_report') {
      // Batch 28: priced exactly as its own path will charge it (the welcome price on a revealed deal).
      const q = await quoteBtlReport(m.userId, m.admin, { dealId: step.dealId }, now);
      planned.push({ step, row: base, basePence: q.basePence, aboutBasePence: null, opensDeal: false });
    } else if (step.kind === 'check_link') {
      const q = await quoteLinkCheck();
      planned.push({ step, row: { ...base, target_label: step.source, params: { url: step.url, aboutBasePence: q.aboutBasePence } }, basePence: q.maxBasePence, aboutBasePence: q.aboutBasePence, opensDeal: false });
    }
  }

  // One instruction at a time: while another one is counting down or running, nothing charged is started.
  const charged = planned.filter((p) => CHARGED_KINDS.has(p.step.kind));
  const busy = Boolean(live) && charged.length > 0;
  const runCharged = busy ? [] : charged;
  for (const p of busy ? charged : []) dropped.push(dropRow(p.step.kind, p.row.target_label, 'busy'));
  const kept = planned.filter((p) => !CHARGED_KINDS.has(p.step.kind) || runCharged.includes(p));

  // ── What it spends, and whether the eye asks first ──
  const [quoter, balance, auto] = await Promise.all([
    quoterFor(m.payerId, m.admin),
    m.admin ? Promise.resolve(null) : getBalance(m.payerId).catch(() => null),
    m.admin ? Promise.resolve(null) : admin.from('profiles').select('auto_topup_amount_pence').eq('id', m.payerId).maybeSingle(),
  ]);
  const quoteFace = (b: number) => (m.admin ? 0 : quoter.quote(b).facePence);
  const faceOf = faces(quoteFace, runCharged.map((p) => p.basePence));
  const priced: PricedStep[] = runCharged.map((p, i) => ({
    index: i,
    kind: p.step.kind,
    basePence: m.admin ? 0 : p.basePence,
    facePence: faceOf[i],
    opensDeal: p.opensDeal,
    aboutFacePence: p.aboutBasePence === null ? null : m.admin ? 0 : Math.round(quoteFace(p.aboutBasePence) * 100) / 100,
  }));
  // The question's hold is base pence: what it takes off the balance is its face (top-up credit at its rate).
  const balanceFace = Math.max(0, (balance?.totalPence ?? 0) - quoteFace(Math.max(0, input.holdPence)));
  const decision = decideSpend({
    steps: priced,
    spendableBasePence: m.admin ? Number.POSITIVE_INFINITY : (balance?.spendableBasePence ?? 0),
    balanceFacePence: balanceFace,
    capFacePence: config.instructionCapPence,
    lowCreditPence: config.lowCreditPence,
    autoTopupOn: Boolean((auto?.data as { auto_topup_amount_pence?: number | null } | null)?.auto_topup_amount_pence),
    admin: m.admin,
  });
  const later = new Set(decision.kind === 'run' || decision.kind === 'confirm' ? decision.later : []);
  const nowSteps = priced.filter((s) => !later.has(s.index));
  const laterSteps = priced.filter((s) => later.has(s.index));
  const line = decision.kind === 'free' || decision.kind === 'insufficient' ? null : spendLine(nowSteps.length > 0 ? nowSteps : laterSteps);

  // ── Recorded, still "proposed": nothing runs until the answer is delivered ──
  const rows: NewStep[] = [];
  let seq = 0;
  for (const p of kept) {
    const ci = runCharged.indexOf(p);
    const isLater = ci >= 0 && later.has(ci);
    rows.push({
      ...p.row,
      seq: seq++,
      part: isLater ? 'later' : 'now',
      status: isLater ? 'deferred' : 'queued',
      quote_base_pence: ci >= 0 ? priced[ci].basePence : 0,
      quote_face_pence: ci >= 0 ? priced[ci].facePence : 0,
      params: { ...p.row.params, ...(ci >= 0 && p.opensDeal ? { opensDeal: true } : {}), ...(ci >= 0 && priced[ci].aboutFacePence != null ? { aboutFacePence: priced[ci].aboutFacePence } : {}) },
    });
  }
  for (const d of dropped) rows.push({ ...d, seq: seq++ });
  // A proposal of one of the eight kinds that was refused is kept (for the member's card and the admin page); anything else isn't a step at all.
  for (const d of checked.dropped) if (isStepKind(d.action)) rows.push({ ...dropRow(d.action, d.target, d.reason), seq: seq++ });
  const droppedNotes = [...checked.dropped.map((d) => ({ target: d.target, why: DROP_REASONS[d.reason] })), ...dropped.map((d) => ({ target: d.target_label, why: d.drop_reason ? DROP_REASONS[d.drop_reason as keyof typeof DROP_REASONS] : null }))];

  const nowBase = decision.kind === 'run' || decision.kind === 'confirm' ? decision.nowBasePence : 0;
  const nowFace = decision.kind === 'run' || decision.kind === 'confirm' ? decision.nowFacePence : decision.kind === 'insufficient' ? decision.requiredFacePence : 0;
  const inserted = await insertInstruction(
    admin,
    {
      id: input.turnId,
      user_id: m.userId,
      payer_id: m.payerId,
      status: 'proposed',
      decision: decision.kind,
      confirm_kind: decision.kind === 'confirm' ? decision.reason : null,
      quoted_base_pence: nowBase,
      quoted_face_pence: nowFace,
      later_face_pence: decision.kind === 'run' || decision.kind === 'confirm' ? decision.laterFacePence : 0,
      balance_before_pence: m.admin ? null : balanceFace,
      spend_line: line,
      conversation_id: null,
    },
    rows,
  );
  if (!inserted) return { ok: false, note: 'Only one plan per answer: the first one stands.' };

  // ── What the model may say ──
  const will = kept.filter((p) => !CHARGED_KINDS.has(p.step.kind)).map((p) => {
    if (p.step.kind === 'change_criteria') {
      const a = p.row.after as { label?: string; countBefore?: number | null; countAfter?: number | null } | undefined;
      return a?.countBefore != null && a?.countAfter != null ? `${a.label} (matches ${a.countBefore} now, about ${a.countAfter} after)` : (a?.label ?? 'a profile change');
    }
    const verb = p.step.kind === 'keep' ? 'Keep' : p.step.kind === 'pass' ? 'Pass' : `Move to ${String((p.row.params as { stage?: string }).stage)}`;
    return `${verb}: the ${p.row.target_label}`;
  });
  return {
    ok: true,
    free_changes: will,
    spend_line: line,
    asks_first:
      decision.kind === 'confirm'
        ? decision.reason === 'low_balance'
          ? `Nothing charged runs until they say yes: it would leave ${formatPence(Math.max(0, decision.balanceAfterFacePence))} in credit. A confirm card with a top-up button shows under your answer.`
          : `Nothing charged runs until they say yes: it is more than ${formatPence(config.instructionCapPence)} in one go. A confirm card shows under your answer.`
        : decision.kind === 'run' && decision.later.length > 0
          ? `Up to ${formatPence(config.instructionCapPence)} runs now (${formatPence(decision.nowFacePence)}); the other ${decision.later.length} (${formatPence(decision.laterFacePence)}) wait for their yes.`
          : null,
    not_enough_credit: decision.kind === 'insufficient' ? `It needs ${formatPence(decision.requiredFacePence)} and they don't have enough credit, so nothing that costs anything will run. A top-up offer shows under your answer.` : null,
    stop: decision.kind === 'run' ? `It starts after a ${config.stopGraceSeconds}-second countdown; they can tap Stop until then.` : null,
    // Only when something was: an empty list had the eye telling the member "Nothing was dropped" (preview test, 16 Oct).
    ...(droppedNotes.some((d) => d.why) ? { dropped: droppedNotes.filter((d) => d.why) } : {}),
    how_to_answer: 'In one or two short sentences, say what you are doing (quote the spend line\'s price exactly when there is one) and, only if the dropped list is here, what was left out and why (never say that nothing was dropped). Don\'t list buttons: the card under your answer shows the countdown, Stop, the progress and Undo.',
  };
}
