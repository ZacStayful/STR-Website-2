import 'server-only';

/**
 * Batch 23: calls override the one-message-a-day cap (src/lib/notify/cap.ts).
 * A call, or its missed-call email, takes the day's daily slot when it is
 * free — so the day's later capped emails (deal alerts, the low-credit notice
 * sent alone) find it used and go tomorrow — and goes anyway when it is not.
 * The morning picks and digest (07:00 / 08:10 UTC) normally send before 9am
 * calls, so on most call days there is nothing left to move.
 */
import { createAdminClient } from '../supabase/admin';
import { claimSlot, finishSend, markSending } from '../notify/sends';

export async function claimCallSlot(userId: string, now: Date = new Date()): Promise<void> {
  try {
    const admin = createAdminClient();
    const claim = await claimSlot(admin, userId, 'si_call', now);
    if (!claim.ok) return; // already used today: the call goes anyway
    if (await markSending(admin, claim.id, { si_call: true }, null)) await finishSend(admin, claim.id, true, { si_call: true }, []);
  } catch (err) {
    console.error('[voice] cap claim failed:', err);
  }
}
