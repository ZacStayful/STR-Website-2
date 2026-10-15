import 'server-only';

/**
 * Batch 23, Part B: the intro call, a few minutes after a member turns calls
 * on (INTRO_DELAY_MS; inside outbound hours, otherwise at the next opening).
 * It is queued here and placed by the calls cron (run.ts), never from the
 * screen the member is on: when they say yes they are usually still
 * answering the sign-up on the same phone (R3-23, R2-98). Once per member,
 * ever — the unique index on intro rows stops a second, so turning calls off
 * and on again places nothing. Members who said yes before Batch 23 went live
 * are picked up by the cron (run.ts backfillIntros).
 */
import { INTRO_DELAY_MS } from './config';
import { enqueueCall } from './queue-server';

export async function onCallsSwitchedOn(userId: string, now: Date = new Date()): Promise<void> {
  try {
    const r = await enqueueCall({ userId, type: 'intro', now, delayMs: INTRO_DELAY_MS });
    if (r.outcome === 'queued') console.log(`[voice] intro call queued for ${r.call.not_before ?? 'now'}`);
  } catch (err) {
    console.error('[voice] intro trigger failed:', err);
  }
}
