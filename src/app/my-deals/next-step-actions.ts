'use server';

/**
 * Batch 7: the next-step slot's actions. Moving a deal goes through Batch 5's
 * setStageForMember, so every stage rule (an unopened deal can only be Kept or
 * Passed) is theirs and applies unchanged. Ticks and usage events are written
 * with the service role after checking the input; a failed usage event never
 * stops what the member did.
 */
import { isPipelineStatus } from '@/lib/listing/pipeline';
import { setStageForMember } from '@/lib/listing/stage-server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { currentMember, isItemKey, ownsItem, TICKS_TABLE } from '@/lib/pipeline/server';
import { recordStepEvent } from '@/lib/pipeline/events';
import { NEXT_STEPS } from '@/lib/pipeline/next-steps';
import { NEXT_MOVE } from '@/lib/pipeline/view';
import type { StepKind } from '@/lib/pipeline/types';
import { managementEnquiryAction, type EnquiryState } from '@/app/markets/actions';

export type MoveResult = { ok: true } | { ok: false; error: 'signed_out' | 'missing' | 'gone' | 'failed' | 'needs_open' };

function isKind(v: unknown): v is StepKind {
  return v === 'purchase' || v === 'rent-to-rent';
}

const CHECKLIST_IDS = new Set(
  (['viewing', 'secured'] as const).flatMap((s) => [...NEXT_STEPS.stages[s].purchase.checklist!, ...NEXT_STEPS.stages[s].rentToRent.checklist!]).map((i) => i.id),
);
const MESSAGE_IDS = new Set(
  (['kept', 'contacted', 'offer'] as const).flatMap((s) => [NEXT_STEPS.stages[s].purchase.message!.id, NEXT_STEPS.stages[s].rentToRent.message!.id]),
);

/** The stage button: moves the deal one step on from `from` (Passed goes back to Kept). */
export async function moveFromNextStepAction(itemKey: unknown, from: unknown, kind: unknown): Promise<MoveResult> {
  if (!isItemKey(itemKey) || !isPipelineStatus(from) || !isKind(kind)) return { ok: false, error: 'failed' };
  const to = NEXT_MOVE[from];
  if (!to) return { ok: false, error: 'failed' };
  const me = await currentMember();
  if (!me) return { ok: false, error: 'signed_out' };
  const res = await setStageForMember({ userId: me.id, adminUser: me.adminUser, key: itemKey, stage: to });
  if (!res.ok) return { ok: false, error: res.code };
  await recordStepEvent({ userId: me.id, itemKey, stage: from, kind, action: 'advance', itemId: to });
  return { ok: true };
}

/** Ticks or unticks one checklist item on one of the member's own deals. */
export async function setChecklistItemAction(itemKey: unknown, stage: unknown, kind: unknown, itemId: unknown, ticked: unknown): Promise<{ ok: boolean }> {
  if (!isItemKey(itemKey) || (stage !== 'viewing' && stage !== 'secured') || !isKind(kind) || typeof itemId !== 'string' || !CHECKLIST_IDS.has(itemId) || typeof ticked !== 'boolean') return { ok: false };
  const me = await currentMember();
  if (!me || !hasServiceRole()) return { ok: false };
  if (!(await ownsItem(me.id, me.adminUser, itemKey))) return { ok: false };
  const table = createAdminClient().from(TICKS_TABLE);
  const { error } = ticked
    ? await table.upsert({ user_id: me.id, item_key: itemKey, item_id: itemId, ticked_at: new Date().toISOString() }, { onConflict: 'user_id,item_key,item_id' })
    : await table.delete().eq('user_id', me.id).eq('item_key', itemKey).eq('item_id', itemId);
  if (error) {
    console.error('[next-step] tick not saved:', error.message);
    return { ok: false };
  }
  await recordStepEvent({ userId: me.id, itemKey, stage, kind, action: ticked ? 'tick' : 'untick', itemId });
  return { ok: true };
}

/** Records a copy or an "Open in email" of one of the messages. */
export async function trackStepAction(itemKey: unknown, stage: unknown, kind: unknown, action: unknown, itemId: unknown): Promise<void> {
  if (!isItemKey(itemKey) || !isPipelineStatus(stage) || !isKind(kind) || (action !== 'copy' && action !== 'email') || typeof itemId !== 'string' || !MESSAGE_IDS.has(itemId)) return;
  const me = await currentMember();
  if (!me) return;
  await recordStepEvent({ userId: me.id, itemKey, stage, kind, action, itemId });
}

/** The Secured stage's "Talk to us": the Market Explorer's enquiry, labelled as from My deals, and recorded. */
export async function nextStepEnquiryAction(prev: EnquiryState, formData: FormData): Promise<EnquiryState> {
  formData.set('source', 'my-deals');
  const res = await managementEnquiryAction(prev, formData);
  const itemKey = formData.get('itemKey');
  const kind = formData.get('kind');
  if (res.sent && isItemKey(itemKey) && isKind(kind)) {
    const me = await currentMember();
    if (me) await recordStepEvent({ userId: me.id, itemKey, stage: 'secured', kind, action: 'enquiry', itemId: null });
  }
  return res;
}
