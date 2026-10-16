import 'server-only';

/**
 * Batch 27: Undo (Zac, 29 Sep): 24 hours, one tap from the chat line or My
 * deals, for Keep / Pass, stage moves, profile changes and the Keep of a
 * checked listing. Charges are never undone.
 *
 * Each step is put back through the same setters that made it, newest
 * first, and only when it is still as the step left it: a deal moved again
 * since, an answer changed since, or a profile change made while another
 * profile is active is left alone, and the eye says so. Each step is
 * claimed (undone_at) before it is put back, so a double tap can't undo
 * twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { stageRestore, stageUnchanged, sameValue, undoLine, undoOpen, type StageState } from './undo';
import { instructionFor, readActionConfig, updateStep } from './store-server';
import { applyCriteria, criteriaNow, restoreStage, stageStateOf, unkeepCheckedListing, type ActingMember } from './steps-server';
import { instructionView } from './run-server';
import type { ActionCardView } from './view';

const asStage = (v: unknown): StageState | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { stage: (o.stage ?? null) as StageState['stage'], reaction: (o.reaction ?? null) as StageState['reaction'], checkedListingId: typeof o.checkedListingId === 'string' ? o.checkedListingId : null };
};

export async function undoInstruction(m: ActingMember, supabase: SupabaseClient, id: unknown, now: Date = new Date()): Promise<ActionCardView | null> {
  const admin = createAdminClient();
  const loaded = await instructionFor(admin, m.userId, id);
  if (!loaded) return null;
  const config = await readActionConfig(admin);
  const windowMs = config.undoHours * 60 * 60 * 1000;
  const i = loaded.instruction;
  let undone = 0;
  let changed = 0;
  let failed = 0;
  const touched: string[] = [];

  // Newest first, so a later step is put back before an earlier one on the same thing.
  for (const s of [...loaded.steps].sort((a, b) => b.seq - a.seq)) {
    const linkKeep = s.action === 'check_link' && s.status === 'done' && typeof s.after?.checkedListingId === 'string' && !s.undone_at;
    const keptAt = linkKeep ? Date.parse(String(s.after?.keptAt ?? s.finished_at ?? '')) : Number.NaN;
    const open = linkKeep ? Number.isFinite(keptAt) && now.getTime() - keptAt <= windowMs : undoOpen({ kind: s.action, status: s.status, finishedAt: s.finished_at, undoneAt: s.undone_at, before: s.before }, now, config.undoHours);
    if (!open) continue;
    // Claim it first: one tap undoes it once.
    const { data: claimed } = await admin.from('si_action_steps').update({ undone_at: now.toISOString() }).eq('id', s.id).eq('user_id', m.userId).is('undone_at', null).select('id');
    if ((claimed ?? []).length === 0) continue;
    touched.push(s.id);
    let result: 'undone' | 'changed' | 'failed' = 'failed';
    try {
      if (linkKeep) {
        const listingId = String(s.after?.checkedListingId);
        const { data: row } = await admin.from('checked_listings').select('status').eq('id', listingId).eq('user_id', m.userId).maybeSingle();
        if (!row) result = 'changed';
        else if ((row as { status: string }).status !== 'watching') result = 'changed';
        else result = (await unkeepCheckedListing(m, i.id, supabase, listingId)) ? 'undone' : 'failed';
      } else if (s.action === 'keep' || s.action === 'pass' || s.action === 'stage_move') {
        const before = asStage(s.before);
        const after = asStage(s.after);
        const current = s.deal_id ? await stageStateOf(admin, m.userId, s.deal_id) : null;
        if (!before || !after || !current || !s.deal_id) result = 'failed';
        else if (!stageUnchanged(current, after)) result = 'changed';
        else {
          const how = stageRestore(before, after);
          result = (await restoreStage(m, i.id, s.deal_id, before, how, after.checkedListingId, supabase)) ? 'undone' : 'failed';
        }
      } else if (s.action === 'change_criteria') {
        const savedAs = String(s.params.savedAs ?? '');
        const now2 = await criteriaNow(m.userId, savedAs);
        const beforeValue = (s.before as { value?: unknown } | null)?.value;
        if (!now2 || beforeValue === undefined || beforeValue === null) result = 'failed';
        else if (s.profile_id && now2.profileId !== s.profile_id) result = 'changed';
        else if (!sameValue(now2.value, (s.after as { value?: unknown } | null)?.value)) result = 'changed';
        else result = (await applyCriteria(m, supabase, savedAs, beforeValue)).ok ? 'undone' : 'failed';
      }
    } catch (err) {
      console.error('[si-actions] undo step failed:', (err as Error)?.message ?? err);
      result = 'failed';
    }
    if (result === 'undone') undone += 1;
    else {
      // Not put back: the claim is given back (a passing failure can be tried again; a change since stays as it is).
      await updateStep(admin, s.id, { undone_at: null });
      if (result === 'changed') changed += 1;
      else failed += 1;
    }
  }
  const note = undoLine({ undone, changed, failed });
  for (const stepId of touched) await updateStep(admin, stepId, { undo_note: note });
  return instructionView(m, i.id, now);
}
