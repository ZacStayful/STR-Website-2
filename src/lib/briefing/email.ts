import 'server-only';

/**
 * Batch 23b: the briefing as the daily email shows it. The picks passes and
 * the 08:10 digest each make ONE call here for the members they are about to
 * email, and pass the result to buildDaily (src/lib/notify/message.ts).
 *
 *   a ready row     the writer's opener, subject and nudges (charged)
 *   not ready yet   the template opener the pass saved with the facts, and
 *                   the email's own subject (never charged)
 *   no row          no briefing: £0, picks off, or a member the pass never
 *                   reached; the email is exactly as it was
 *
 * The feedback links are signed, expiring and land on a page that asks for
 * one press (a POST), so a link scanner cannot vote.
 */
import type { BriefingInput } from '../notify/message';
import { expiringPayload, signPayload } from '../crypto/sign';
import { ukDay } from '../activity/week';
import { briefingsFor, type StoredBriefing } from './store';

/** Feedback links stay valid this long. */
const FEEDBACK_DAYS = 14;

export function feedbackPayloadId(briefingId: string): string {
  return `briefing-${briefingId}`;
}

/** Signed links to /briefing/feedback, or null when signing is not configured. */
export function feedbackLinks(siteUrl: string, briefingId: string, now: Date): BriefingInput['feedback'] {
  const exp = Math.floor(now.getTime() / 1000) + FEEDBACK_DAYS * 86_400;
  const sig = signPayload(expiringPayload(feedbackPayloadId(briefingId), exp));
  if (!sig) return null;
  const base = siteUrl.replace(/\/$/, '');
  const url = (a: string) => `${base}/briefing/feedback?b=${encodeURIComponent(briefingId)}&e=${exp}&s=${encodeURIComponent(sig)}&a=${a}`;
  return { useful: url('useful'), notForMe: url('not_for_me') };
}

export function emailBriefingOf(b: StoredBriefing, siteUrl: string, now: Date): BriefingInput {
  const base = siteUrl.replace(/\/$/, '');
  return {
    greeting: b.greeting,
    opener: b.opener,
    subject: b.subject,
    nudges: b.nudges.map((n) => ({ text: n.text, nextStep: n.nextStep, url: `${base}${n.path}` })),
    feedback: feedbackLinks(base, b.id, now),
  };
}

/** The briefings for the members about to be emailed, by user id. A failed read gives none: the emails go as they were. */
export async function emailBriefingsFor(siteUrl: string, userIds: readonly string[], now: Date = new Date()): Promise<Map<string, BriefingInput>> {
  const out = new Map<string, BriefingInput>();
  try {
    for (const [id, b] of await briefingsFor(userIds, ukDay(now))) out.set(id, emailBriefingOf(b, siteUrl, now));
  } catch (err) {
    console.warn('[briefing] email read failed; sending without:', (err as Error)?.message ?? err);
  }
  return out;
}
