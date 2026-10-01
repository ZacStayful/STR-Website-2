import 'server-only';

/**
 * Batch 23, Part B: the intro call, within minutes of a member turning calls
 * on (inside outbound hours; otherwise at the next opening). Once per member,
 * ever — the unique index on intro rows stops a second, so turning calls off
 * and on again places nothing. Members who said yes before Batch 23 went live
 * are picked up by the cron (run.ts backfillIntros).
 */
import { enqueueCall, placeCall } from './queue-server';

export async function onCallsSwitchedOn(userId: string, now: Date = new Date()): Promise<void> {
  try {
    const r = await enqueueCall({ userId, type: 'intro', now });
    if (r.outcome === 'queued' && (!r.call.not_before || Date.parse(r.call.not_before) <= now.getTime())) {
      await placeCall(r.call, { apply: true, now });
    }
  } catch (err) {
    console.error('[voice] intro trigger failed:', err);
  }
}
