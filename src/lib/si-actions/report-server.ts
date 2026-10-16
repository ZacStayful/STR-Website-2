import 'server-only';

/**
 * Batch 27: bug reports and feature requests from Stayful Intelligence,
 * through Batch 18's own way in (src/lib/feedback/send-server.ts): the same
 * table, the same daily limit, the same email to the admin address and the
 * same "Your feedback" list and status emails for the member.
 *
 *   fileMemberBug   the member told the eye something is wrong (or asked it
 *                   to report something): filed at once for them (Zac, 29
 *                   Sep: "report that directly for the user"), counted as
 *                   their feedback_sent
 *   fileAutoBug     an action failed on our side: filed for the member by the
 *                   eye, once per error and action per member per UK day, with
 *                   no activity (they did nothing)
 * Feature requests are never filed by the eye: it opens the member's own
 * form, filled in, and the member sends it (FeedbackDialog).
 *
 * The body is the member's own words, the eye's one-line summary and a
 * technical line (the question, instruction and step ids, the error code):
 * never anything about another member, and never a deal's address.
 */
import { ukDay } from '../activity/week';
import { sendMemberReport, type MemberReportOutcome } from '../feedback/send-server';

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export interface BugInput {
  userId: string;
  email: string | null;
  /** The question's id: the report's retry key, so a retry never files twice. */
  turnId: string;
  /** What the member said, in their words. */
  memberWords: string;
  /** The eye's one line. */
  summary: string;
  page: string;
  userAgent: string | null;
}

export async function fileMemberBug(b: BugInput): Promise<MemberReportOutcome> {
  const body = [clip(b.memberWords.trim(), 1200), '', `Stayful Intelligence: ${clip(b.summary.trim(), 300)}`, '', `Technical: chat question ${b.turnId}.`].join('\n');
  return sendMemberReport({ userId: b.userId, email: b.email, kind: 'bug', text: body, key: `si-${b.turnId}`, context: { page: b.page }, userAgent: b.userAgent, memberAction: true });
}

export interface AutoBugInput {
  userId: string;
  email: string | null;
  instructionId: string;
  stepId: string;
  action: string;
  code: string;
  /** What went wrong, in a few words (no member data). */
  detail: string;
  now?: Date;
}

/** An action that failed on our side, reported for the member once a UK day per error and action. */
export async function fileAutoBug(b: AutoBugInput): Promise<MemberReportOutcome> {
  const day = ukDay(b.now ?? new Date());
  const code = b.code.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'error';
  const action = b.action.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'step';
  const body = [
    `Stayful Intelligence tried to do this for me and it failed on your side: ${action} (${code}).`,
    clip(b.detail, 300),
    '',
    `Technical: instruction ${b.instructionId}, step ${b.stepId}. Reported automatically; nothing was charged for it.`,
  ].join('\n');
  return sendMemberReport({ userId: b.userId, email: b.email, kind: 'bug', text: body, key: `si-auto-${day}-${action}-${code}`.slice(0, 64), context: { page: '/intelligence' }, userAgent: null, memberAction: false });
}

/** The codes that mean "this went wrong on our side", rather than a rule (no credit, price changed, gone, a cap). */
export function unexpectedFailure(code: string | null | undefined): boolean {
  return code === 'failed' || code === 'threw' || code === 'error' || code === 'unavailable';
}
