import 'server-only';

/**
 * Batch 18's one way in for a member's report, shared by the feedback form's
 * route (/api/feedback) and, from Batch 27, Stayful Intelligence filing one
 * for the member (a bug they described in the chat, a feature request they
 * sent from its card, or an action that failed on our side). The checks,
 * the save (submitReport: the retry key and the daily limit in one step),
 * the member's activity and the email to the admin address all happen here,
 * so the two ways in can never drift apart.
 *
 * The member is always the caller's session member; nothing in the input
 * names anyone else. The screenshots, when there are any, were checked by
 * the caller (the form's route reads them from the request).
 */
import { after } from 'next/server';
import { logActivity } from '../activity/log';
import { isReportKind, type FeedbackSettings, type ReportKind } from './config';
import { activityKey, cleanClientContext, cleanText, type ScreenshotType } from './rules';
import { feedbackSettings } from './settings-server';
import { sendAdminReportEmail, submitReport } from './server';

/** The retry key's shape: the form's own id, or Stayful Intelligence's (si-…). */
export const REPORT_KEY = /^[A-Za-z0-9-]{8,64}$/;

export interface MemberReportInput {
  userId: string;
  email: string | null;
  kind: unknown;
  text: unknown;
  /** The send's own id: a retry with the same key comes back as the same report. */
  key: unknown;
  /** Where it was sent from, checked field by field (the form's captureContext). */
  context: unknown;
  userAgent: string | null;
  files?: { bytes: Uint8Array; type: ScreenshotType }[];
  settings?: FeedbackSettings;
  /**
   * The member sent it themselves (the form, a card's Send, asking the eye
   * to report something): recorded as their `feedback_sent`. A report the
   * eye files on its own when an action fails is not their action: no event
   * (it would count them as active when they did nothing; Zac, 11 Oct).
   */
  memberAction: boolean;
}

export type MemberReportOutcome =
  | { ok: true; id: string; ref: number; attached: number; failed: number; duplicate: boolean }
  | { ok: false; error: 'kind' | 'empty' | 'too_long' | 'bad_key' | 'limit' | 'unavailable' | 'failed'; limit?: number };

export async function sendMemberReport(input: MemberReportInput): Promise<MemberReportOutcome> {
  if (!isReportKind(input.kind)) return { ok: false, error: 'kind' };
  const kind: ReportKind = input.kind;
  const text = cleanText(input.text);
  if (!text.ok) return { ok: false, error: text.reason === 'empty' ? 'empty' : 'too_long' };
  const key = String(input.key ?? '');
  if (!REPORT_KEY.test(key)) return { ok: false, error: 'bad_key' };
  const settings = input.settings ?? (await feedbackSettings());
  const outcome = await submitReport({
    userId: input.userId,
    email: input.email,
    kind,
    body: text.text,
    clientKey: key,
    client: cleanClientContext(input.context ?? null),
    userAgent: input.userAgent,
    files: input.files ?? [],
    settings,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.limit !== undefined ? { limit: outcome.limit } : {}) };
  if (!outcome.duplicate) {
    if (input.memberAction) logActivity(input.userId, 'feedback_sent', { dedupeKey: activityKey.sent(outcome.id), extras: { kind, screenshots: outcome.attached } });
    const { id, failed } = outcome;
    after(async () => {
      const res = await sendAdminReportEmail(id, { failedImages: failed });
      if (!res.sent) console.warn(`[feedback] admin email for ${id} not sent (${res.reason ?? 'unknown'}); the daily run will retry it`);
    });
  }
  return { ok: true, id: outcome.id, ref: outcome.ref, attached: outcome.attached, failed: outcome.failed, duplicate: outcome.duplicate };
}
