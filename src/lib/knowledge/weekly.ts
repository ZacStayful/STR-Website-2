/**
 * Batch 24: the Monday email to the admin address (billing_settings
 * feedback_admin_email): last week's new gaps, the most asked ones, the
 * drafts waiting for approval, and the share answered from approved
 * knowledge against the week before, with a link to Gaps.
 *
 * Gap labels are written by a model from members' questions: they are
 * redacted again, escaped, and never put in the subject.
 *
 * Pure: the sender is weekly-server.ts.
 */
import { escapeHtml as esc } from '../email/escape.ts';
import { addDays } from '../activity/week.ts';
import { redactQuestion } from './gap/prompts.ts';
import { knowledgeShare, percent, shareChange, type Tally } from './coverage.ts';

export interface WeeklyGapInput {
  /** The Monday of the week reported on. */
  week: string;
  newGaps: number;
  topGaps: readonly { label: string; asked: number; status: string }[];
  waitingDrafts: number;
  lastWeek: Tally | null;
  weekBefore: Tally | null;
  gapsUrl: string;
  coverageUrl: string;
}

export interface WeeklyEmail {
  subject: string;
  text: string;
  html: string;
}

const STATUS_WORDS: Record<string, string> = { open: 'waiting for a draft', drafted: 'draft waiting for you', covered: 'answered', rejected: 'rejected', failed: "couldn't be drafted", dismissed: 'dismissed' };

/** "21–27 September 2026" (the week's Monday to Sunday). */
export function weekLabel(monday: string): string {
  const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return sameMonth ? `${fmt(monday, { day: 'numeric' })}–${fmt(sunday, { day: 'numeric', month: 'long', year: 'numeric' })}` : `${fmt(monday, { day: 'numeric', month: 'long' })} – ${fmt(sunday, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const WRAP = `${FONT};font-size:15px;line-height:1.6;color:#2e3d2b;max-width:600px;margin:0 auto;padding:24px`;
const BUTTON = 'display:inline-block;background:#2e3d2b;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600';

export function weeklyGapEmail(i: WeeklyGapInput): WeeklyEmail {
  const range = weekLabel(i.week);
  const now = knowledgeShare(i.lastWeek);
  const before = knowledgeShare(i.weekBefore);
  const change = shareChange(now, before);
  const coverageLine =
    i.lastWeek && i.lastWeek.asked > 0
      ? `Answered from approved knowledge: ${percent(now)} of ${i.lastWeek.asked} question${i.lastWeek.asked === 1 ? '' : 's'}${change ? ` (${change} on the week before, ${percent(before)})` : ''}.`
      : 'No questions were logged last week.';
  const gapsLine = `New gaps: ${i.newGaps}. Drafts waiting for your approval: ${i.waitingDrafts}.`;
  const top = i.topGaps.map((g) => ({ label: redactQuestion(g.label), asked: g.asked, status: STATUS_WORDS[g.status] ?? g.status }));
  const subject = `Stayful Intelligence gaps: week of ${range}`;

  const text = [
    `Stayful Intelligence, week of ${range}`,
    '',
    coverageLine,
    gapsLine,
    '',
    top.length ? 'Most asked gaps:' : 'No gaps were asked about last week.',
    ...top.map((g, n) => `${n + 1}. ${g.label} (asked ${g.asked} time${g.asked === 1 ? '' : 's'}; ${g.status})`),
    '',
    `Review them: ${i.gapsUrl}`,
    `Coverage by week: ${i.coverageUrl}`,
  ].join('\n');

  const html = `<div style="${WRAP}">
<h1 style="font-size:20px;margin:0 0 12px">Stayful Intelligence, week of ${esc(range)}</h1>
<p style="margin:0 0 8px">${esc(coverageLine)}</p>
<p style="margin:0 0 16px">${esc(gapsLine)}</p>
${
  top.length
    ? `<p style="margin:0 0 4px;font-weight:600">Most asked gaps</p>
<ol style="margin:0 0 16px;padding-left:20px">${top.map((g) => `<li style="margin:0 0 4px">${esc(g.label)} <span style="color:#6b7280">(asked ${g.asked} time${g.asked === 1 ? '' : 's'}; ${esc(g.status)})</span></li>`).join('')}</ol>`
    : '<p style="margin:0 0 16px">No gaps were asked about last week.</p>'
}
<p style="margin:20px 0 0"><a href="${esc(i.gapsUrl)}" style="${BUTTON}">Review the gaps</a></p>
<p style="font-size:12px;color:#6b7280;margin:24px 0 0"><a href="${esc(i.coverageUrl)}" style="color:#6b7280">Coverage by week</a> · sent every Monday to the admin address</p>
</div>`;

  return { subject, text, html };
}
