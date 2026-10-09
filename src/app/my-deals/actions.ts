'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { isPipelineStatus, type PipelineStatus } from '@/lib/listing/pipeline';
import { setStageForMember } from '@/lib/listing/stage-server';
import { logActivity } from '@/lib/activity/log';
import { dealIdOfItemKey } from '@/lib/activity/event';
import { payerFor } from '@/lib/team';
import { quoterFor } from '@/lib/credit/quote-server';
import { priceText } from '@/lib/credit/deal-pricing';
import { labelledSaves, noteMemberActed, undoNotForMe } from '@/lib/standout/saved-server';

export type StageActionResult =
  | { ok: true; stage: PipelineStatus }
  | { ok: false; error: 'signed_out' | 'missing' | 'gone' | 'failed' }
  | { ok: false; error: 'needs_open'; openPence: number; openLabel: string };

/**
 * Moves one My deals item (or the deal on its own page) to `stage`. Called
 * from the stage dropdown, so it answers rather than redirects. Free. A stage
 * past Kept on a deal nobody on the team has opened is refused here with the
 * open price, whatever the dropdown showed. `from` is the stage the dropdown
 * was showing, for the activity log only.
 */
export async function setDealStageAction(key: unknown, stage: unknown, from?: unknown): Promise<StageActionResult> {
  if (typeof key !== 'string' || key.length > 40 || !isPipelineStatus(stage)) return { ok: false, error: 'failed' };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'signed_out' };
  const res = await setStageForMember({ userId: user.id, adminUser: isAdminEmail(user.email), key, stage });
  if (res.ok) logActivity(user.id, 'stage_move', { dealId: dealIdOfItemKey(key), extras: { from: isPipelineStatus(from) ? from : undefined, to: res.stage, item: key.startsWith('l-') ? key : undefined } });
  if (res.ok) return { ok: true, stage: res.stage };
  if (res.code === 'needs_open') {
    // What THIS member pays for the open, from their own credit (Batch 10).
    const admin = isAdminEmail(user.email);
    const quoter = await quoterFor((await payerFor(user.id)).payerId, admin);
    return { ok: false, error: 'needs_open', openPence: res.openPence, openLabel: priceText(quoter.label(admin ? 0 : res.openPence)) };
  }
  return { ok: false, error: res.code };
}

export type NotForMeResult = { ok: true } | { ok: false; error: 'signed_out' | 'missing' | 'failed' };

/**
 * Batch 25: "Not for me" on a deal Stayful Intelligence saved. One tap, no
 * confirm: the deal goes to Passed as the member's own Pass (tailoring and
 * the picks learn from it, and it counts towards weekly active), and the
 * label comes off. Undo within a few seconds puts the save back.
 */
export async function notForMeAction(dealId: unknown): Promise<NotForMeResult> {
  if (typeof dealId !== 'string' || !/^[0-9a-f-]{36}$/i.test(dealId)) return { ok: false, error: 'failed' };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'signed_out' };
  if (!(await labelledSaves(user.id)).has(dealId)) return { ok: false, error: 'missing' };
  const res = await setStageForMember({ userId: user.id, adminUser: isAdminEmail(user.email), key: `d-${dealId}`, stage: 'passed' });
  if (!res.ok) return { ok: false, error: res.code === 'missing' ? 'missing' : 'failed' };
  await noteMemberActed(user.id, dealId, 'not_for_me');
  logActivity(user.id, 'pass', { dealId, extras: { via: 'si_saved' } });
  return { ok: true };
}

/** Undo "Not for me" (the page offers it for five seconds; the server allows a minute). */
export async function undoNotForMeAction(dealId: unknown): Promise<NotForMeResult> {
  if (typeof dealId !== 'string' || !/^[0-9a-f-]{36}$/i.test(dealId)) return { ok: false, error: 'failed' };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'signed_out' };
  return (await undoNotForMe(user.id, dealId)) ? { ok: true } : { ok: false, error: 'failed' };
}
