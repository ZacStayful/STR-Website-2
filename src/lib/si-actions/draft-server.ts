import 'server-only';

/**
 * Batch 27: "Write my enquiry for the Leeds 2-bed", "Offer £140k on it".
 *
 * The message is the next-step slot's own (src/lib/pipeline: nextStepFor,
 * the templates in next-steps.ts, the offer range), filled with the deal's
 * real facts by the same rules: a fact that is missing drops out, the
 * template syntax never reaches the page. Only for a deal in the member's My
 * deals that their team has opened (the slot's own rule: the address is in
 * it). The eye never sends it: the member copies it and sends it
 * themselves. Then it offers the move the slot offers ("Move to Contacted"),
 * which runs only on the member's tap.
 *
 * What goes back to the model is never the message (it holds the address):
 * only that it was drafted, for which deal, and the offer range's words.
 */
import { loadTrackedDeals } from '../listing/tracked-server';
import { nextStepFor } from '../pipeline/server';
import { factsFromTracked } from '../pipeline/slot-facts';
import { withOfferAmount, OFFER_SLOT } from '../pipeline/offer-amount';
import { PIPELINE_STATUSES, type PipelineStatus } from '../listing/pipeline';
import { describeType } from '../marketplace/grid';
import { DRAFT_KINDS, type DraftKind } from './config';
import type { DraftView } from './view';
import { instructionFor, updateStep, type Admin } from './store-server';
import { runStageStep, type ActingMember } from './steps-server';

export { DRAFT_KINDS, type DraftKind, type DraftView };

/** Which stage's template each message is. */
const STAGE_OF: Record<DraftKind, PipelineStatus> = { enquiry: 'watching', follow_up: 'contacted', offer: 'offer' };

export type DraftResult = { ok: true; draft: DraftView; forModel: Record<string, unknown> } | { ok: false; note: string };

const stageLabel = (s: PipelineStatus) => PIPELINE_STATUSES.find((x) => x.key === s)?.label ?? s;

export async function draftMessage(m: ActingMember, input: { dealId: string; kind: DraftKind | null; offerAmount: number | null }): Promise<DraftResult> {
  const load = await loadTrackedDeals(m.userId, { scope: 'own', adminUser: m.admin });
  const item = load.view.find((d) => d.dealId === input.dealId);
  if (!item) return { ok: false, note: "That deal isn't in their My deals yet: it needs a Keep first. Nothing was drafted." };
  if (!item.opened) return { ok: false, note: 'That deal needs opening before a message can be written (the message has its address). Offer the Open deal button (offer_action open_deal). Nothing was drafted.' };
  if (!item.mine) return { ok: false, note: "That deal is a teammate's: they can't send messages for it from here. Nothing was drafted." };
  const card = load.cards.get(input.dealId) ?? null;
  const kind: DraftKind = input.kind ?? (item.stage === 'offer' || item.stage === 'viewing' ? 'offer' : item.stage === 'contacted' ? 'follow_up' : 'enquiry');
  const stage = STAGE_OF[kind];
  const facts = factsFromTracked(item, card, load.addresses.get(input.dealId) ?? null);
  const view = await nextStepFor({ itemKey: item.key, stage, facts });
  const msg = view?.message ?? null;
  if (!view || !msg) return { ok: false, note: 'There is no message of that kind for this deal (its kind has no next step). Nothing was drafted.' };
  const amount = kind === 'offer' && input.offerAmount !== null && input.offerAmount > 0 ? Math.round(input.offerAmount) : null;
  const subject = msg.withAmount ? withOfferAmount({ withAmount: msg.withAmount.subject, without: msg.subject }, amount) : msg.subject;
  const body = msg.withAmount ? withOfferAmount({ withAmount: msg.withAmount.body, without: msg.body }, amount) : msg.body;
  // The slot's own move after sending: to the stage this message belongs to (an enquiry → Contacted).
  const target = kind === 'enquiry' ? 'contacted' : kind === 'follow_up' ? 'viewing' : 'offer';
  const order = PIPELINE_STATUSES.map((s) => s.key);
  const ahead = item.stage === 'passed' || order.indexOf(item.stage) < order.indexOf(target);
  const label = card ? `${describeType(card) || 'deal'}${card.outcode ? ` in ${card.outcode}` : ''}` : 'deal';
  const draft: DraftView = {
    dealId: input.dealId,
    dealLabel: label,
    subject: subject.split(OFFER_SLOT).join(''),
    body: body.split(OFFER_SLOT).join(''),
    offerRange: kind === 'offer' ? (view.offer?.figure ?? null) : null,
    offerNote: kind === 'offer' ? (view.offer?.working ?? null) : null,
    move: ahead ? { to: target, label: `Move to ${stageLabel(target)}` } : null,
  };
  return {
    ok: true,
    draft,
    forModel: {
      drafted: true,
      deal: label,
      message: kind === 'enquiry' ? 'the enquiry' : kind === 'follow_up' ? 'the follow-up' : 'the offer',
      offer_amount_used: amount !== null,
      offer_range: draft.offerRange,
      move_offered: draft.move?.label ?? null,
      how_to_answer: "In one short sentence say it's drafted below with a Copy button, that they send it themselves, and (when there is one) that the button moves the deal once they have. Never write the message out yourself, and never advise on the amount.",
    },
  };
}

/** The draft's "Move to …", on the member's tap: only the move the slot offers, for their own opened deal, as a step of the question. */
export async function moveAfterDraft(admin: Admin, m: ActingMember, turnId: string, dealId: string, to: PipelineStatus): Promise<{ ok: boolean; note: string }> {
  const load = await loadTrackedDeals(m.userId, { scope: 'own', adminUser: m.admin });
  const item = load.view.find((d) => d.dealId === dealId);
  if (!item || !item.opened || !item.mine) return { ok: false, note: 'That deal can’t be moved from here.' };
  // Only the move a draft offers: forward to Contacted, Viewing or Offer from a stage before it (or from Passed).
  const order = PIPELINE_STATUSES.map((s) => s.key);
  const forward = item.stage === 'passed' || order.indexOf(item.stage) < order.indexOf(to);
  if (!(['contacted', 'viewing', 'offer'] as PipelineStatus[]).includes(to) || !forward) return { ok: false, note: 'That move isn’t the next step for this deal.' };
  // The question's instruction (made now if the question only drafted), so the move has its own step and Undo.
  const { error } = await admin.from('si_instructions').insert({ id: turnId, user_id: m.userId, payer_id: m.payerId, status: 'done', decision: 'free', finished_at: new Date().toISOString() });
  if (error && error.code !== '23505') return { ok: false, note: 'That didn’t save. Please try again.' };
  const loaded = await instructionFor(admin, m.userId, turnId);
  if (!loaded) return { ok: false, note: 'That didn’t save. Please try again.' };
  if (loaded.steps.some((s) => s.deal_id === dealId && s.action === 'stage_move' && s.params.stage === to && s.status === 'done')) return { ok: true, note: `Moved to ${stageLabel(to)}.` };
  const seq = loaded.steps.reduce((a, s) => Math.max(a, s.seq), -1) + 1;
  const label = (() => {
    const c = load.cards.get(dealId);
    return c ? `${describeType(c) || 'deal'}${c.outcode ? ` in ${c.outcode}` : ''}` : 'deal';
  })();
  const { data: inserted, error: insErr } = await admin.from('si_action_steps').insert({ instruction_id: turnId, user_id: m.userId, seq, action: 'stage_move', deal_id: dealId, target_label: label, params: { stage: to, from: item.stage, via: 'draft' }, part: 'now', status: 'running', started_at: new Date().toISOString() }).select('id').single();
  if (insErr || !inserted) return { ok: false, note: 'That didn’t save. Please try again.' };
  const r = await runStageStep(m, turnId, { action: 'stage_move', dealId, stage: to });
  if (r.ok) await updateStep(admin, String(inserted.id), { status: 'done', before: r.before, after: r.after, finished_at: new Date().toISOString() });
  else await updateStep(admin, String(inserted.id), { status: 'failed', error_code: r.code, finished_at: new Date().toISOString() });
  return r.ok ? { ok: true, note: `Moved to ${stageLabel(to)}. You can undo it.` } : { ok: false, note: 'That didn’t move. Please try again from My deals.' };
}
