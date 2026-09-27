import 'server-only';

/**
 * Which next-step tools members use, one row per use, so it can be seen
 * later which steps people act on (pipeline_step_events, service role only).
 * Recording never throws and never blocks what the member did.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { StepKind } from './types';
import { logActivity } from '../activity/log';
import { dealIdOfItemKey } from '../activity/event';

export const EVENTS_TABLE = 'pipeline_step_events';

export const STEP_ACTIONS = ['copy', 'email', 'tick', 'untick', 'advance', 'enquiry'] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export function isStepAction(v: unknown): v is StepAction {
  return typeof v === 'string' && (STEP_ACTIONS as readonly string[]).includes(v);
}

export async function recordStepEvent(e: { userId: string; itemKey: string; stage: string; kind: StepKind; action: StepAction; itemId?: string | null }): Promise<void> {
  logActivity(e.userId, e.action === 'advance' ? 'stage_move' : 'next_step', { dealId: dealIdOfItemKey(e.itemKey), extras: e.action === 'advance' ? { from: e.stage, to: e.itemId ?? undefined, via: 'next_step', item: e.itemKey.startsWith('l-') ? e.itemKey : undefined } : { action: e.action, stage: e.stage, step: e.itemId ?? undefined, item: e.itemKey.startsWith('l-') ? e.itemKey : undefined } });
  if (!hasServiceRole()) return;
  try {
    const { error } = await createAdminClient()
      .from(EVENTS_TABLE)
      .insert({ user_id: e.userId, item_key: e.itemKey, stage: e.stage, deal_kind: e.kind, action: e.action, item_id: e.itemId ?? null });
    if (error) console.warn('[next-step] event not recorded:', error.message);
  } catch (err) {
    console.warn('[next-step] event not recorded:', err);
  }
}
