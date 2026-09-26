'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { isPipelineStatus, type PipelineStatus } from '@/lib/listing/pipeline';
import { setStageForMember } from '@/lib/listing/stage-server';

export type StageActionResult =
  | { ok: true; stage: PipelineStatus }
  | { ok: false; error: 'signed_out' | 'missing' | 'gone' | 'failed' }
  | { ok: false; error: 'needs_open'; openPence: number };

/**
 * Moves one My deals item (or the deal on its own page) to `stage`. Called
 * from the stage dropdown, so it answers rather than redirects. Free. A stage
 * past Kept on a deal nobody on the team has opened is refused here with the
 * open price, whatever the dropdown showed.
 */
export async function setDealStageAction(key: unknown, stage: unknown): Promise<StageActionResult> {
  if (typeof key !== 'string' || key.length > 40 || !isPipelineStatus(stage)) return { ok: false, error: 'failed' };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'signed_out' };
  const res = await setStageForMember({ userId: user.id, adminUser: isAdminEmail(user.email), key, stage });
  if (res.ok) return { ok: true, stage: res.stage };
  if (res.code === 'needs_open') return { ok: false, error: 'needs_open', openPence: res.openPence };
  return { ok: false, error: res.code };
}
