/**
 * "We've paused your daily deals while you're away" (Batch 20, Part C): the
 * one letter a member gets when their daily picks pause for inactivity. It
 * goes in the day's daily slot, like the out-of-credit letter, and carries
 * that day's changes on deals they track. One per pause
 * (profiles.picks_paused_inactive_email_at).
 *
 * Pure: no network, no database, no server-only.
 */
import { escapeHtml as esc } from '../email/escape.ts';
import { manageNotificationsUrl } from '../url.ts';

export interface AwayLetterInput {
  siteUrl: string;
  firstName?: string | null;
  /** A team member's picks are paid by their team: "your team's credit". */
  team?: boolean;
  /** The day's changes on deals they track, already rendered (src/lib/notify). */
  extra?: { text: string; html: string; subjectSuffix?: string | null } | null;
}

export function awayLetter(input: AwayLetterInput): { subject: string; text: string; html: string } {
  const base = input.siteUrl.replace(/\/$/, '');
  const today = `${base}/today`;
  const manage = manageNotificationsUrl(base);
  const baseSubject = 'We’ve paused your daily deals while you’re away';
  const subject = input.extra?.subjectSuffix ? `${baseSubject} · ${input.extra.subjectSuffix}` : baseSubject;
  const hi = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const body = `We’ve paused your daily deals while you’re away, so nothing more comes out of ${input.team ? 'your team’s' : 'your'} credit. Sign in to start them again: they restart with the next morning’s run.`;
  const text = [hi, '', body, '', `Start my daily deals: ${today}`, '', ...(input.extra ? [input.extra.text, ''] : []), `Manage notifications: ${manage}`].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:560px">
      <p style="margin:0 0 14px">${esc(hi)}</p>
      <p style="margin:0 0 18px">${esc(body)}</p>
      <p style="margin:0 0 18px"><a href="${esc(today)}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">Start my daily deals</a></p>
      ${input.extra ? `<div style="margin:0 0 18px">${input.extra.html}</div>` : ''}
      <p style="margin:0;color:#7a8274;font-size:12px">Stayful Intelligence · <a href="${esc(manage)}" style="color:#7a8274">Manage notifications</a></p>
    </div>`.trim();
  return { subject, text, html };
}
