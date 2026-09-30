import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';

/**
 * Batch 20, Part C: coming back. Called by src/lib/activity/log.ts after a
 * new engaging action is written (Batch 9's weekly-active kinds, or engaging
 * by email or text: ./rules.ts): the member leaves Re-engage and their daily
 * picks restart with the next run. Kept on its own, with nothing but the
 * database and the Monday queue, so the activity log imports nothing heavier.
 */

// One warning a minute, so a missing column (schema not run) does not fill the logs.
let warnedAt = 0;

/**
 * An engaging action: out of Re-engage and daily picks back on, at once.
 * One guarded update (it writes only a member who was marked), then Monday
 * hears within ten minutes. Never throws.
 */
export async function cameBack(userId: string): Promise<void> {
  try {
    const { data, error } = await createAdminClient()
      .from('profiles')
      .update({ reengage_since: null, picks_paused_inactive_at: null, picks_paused_inactive_email_at: null })
      .eq('id', userId)
      .or('reengage_since.not.is.null,picks_paused_inactive_at.not.is.null')
      .select('id');
    if (error) {
      if (Date.now() - warnedAt > 60_000) {
        warnedAt = Date.now();
        console.warn('[inactivity] came-back clear failed (schema not run?):', error.message);
      }
      return;
    }
    if ((data?.length ?? 0) > 0) await queueFunnelSync(userId, 'came_back');
  } catch {
    /* never in the way of the action itself */
  }
}
