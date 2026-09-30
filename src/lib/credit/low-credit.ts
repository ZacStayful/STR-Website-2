/**
 * The £5 low-credit decision (Batch 20, Part B): what a member with no plan
 * is told when their credit reaches billing_settings.low_credit_pence (£5)
 * or less, and when.
 *
 * Who: a member who pays for themselves, with no live, trialling, past-due or
 * paused plan (free, or lapsed), with the "Picks paused / out of credit"
 * switch on. Once a cycle: 30 days, profiles.last_low_balance_email_at.
 * Members on a plan keep the 80% rule and its email (src/lib/email/billing.ts).
 *
 * What: Starter at its monthly price, or a £10 top-up. Each button opens
 * /account/billing/choose, which asks once more before anything is charged
 * (an email link must never charge: mail scanners open links). A new member
 * who can still buy the starter pack is offered that instead.
 *
 * How it goes: inside the day's daily email when there is one (the picks run
 * or the 08:10 digest), else alone in the day's daily slot (the capped kind
 * `low_credit`, src/lib/notify/cap.ts). Never a second email in a day.
 *
 * Pure: no network, no database, no server-only.
 */
import { formatGbp } from './pricing.ts';
import { manageNotificationsUrl } from '../url.ts';
import type { Link, Message, Section, Unsubscribe } from '../notify/message.ts';

/** How often the notice may go with no plan: the cycle the 80% email used for accounts without one. */
export const LOW_CREDIT_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

export interface LowCreditNotice {
  /** Face value of every kind of credit left (what the header shows). */
  balancePence: number;
  /** 'decision': Starter or a top-up. 'pack': a new member who can still buy the starter pack. */
  kind: 'decision' | 'pack';
  starter: { code: string; name: string; pricePence: number; creditPence: number } | null;
  topupPence: number;
  /** The saved card, when there is one: "on your card ending 4242". */
  card: { brand: string; last4: string } | null;
  /** The pack's words (src/lib/starter-pack/rules.ts packCopy), for kind 'pack'. */
  pack: { body: string; cta: string } | null;
}

/** Low under the £5 rule: something left to spend (else it is "out"), and £5 or less of it. */
export function lowUnderRule(input: { balancePence: number; spendableBasePence: number; lowCreditPence: number }): boolean {
  return input.lowCreditPence > 0 && input.spendableBasePence > 0.5 && input.balancePence <= input.lowCreditPence;
}

/** Is the notice due for this member now? */
export function lowCreditDue(input: {
  noPlan: boolean;
  balancePence: number;
  spendableBasePence: number;
  lowCreditPence: number;
  lastToldAt: string | null;
  alertsOn: boolean;
  hasEmail: boolean;
  admin: boolean;
  now: Date;
}): boolean {
  if (!input.noPlan || !input.alertsOn || !input.hasEmail || input.admin) return false;
  if (!lowUnderRule(input)) return false;
  const last = input.lastToldAt ? Date.parse(input.lastToldAt) : Number.NaN;
  return !(Number.isFinite(last) && input.now.getTime() - last < LOW_CREDIT_CYCLE_MS);
}

/** "£19", "£12.50". */
function money(pence: number): string {
  return pence % 100 === 0 ? `£${Math.round(pence / 100)}` : formatGbp(pence);
}

/** The confirm page each email button opens: nothing is charged until they confirm there. */
export function choosePath(pick: 'starter' | 'topup'): string {
  return `/account/billing/choose?pick=${pick}`;
}

export interface LowCreditCopy {
  subject: string;
  heading: string;
  lines: string[];
  buttons: Link[];
}

export function lowCreditCopy(n: LowCreditNotice, siteUrl: string): LowCreditCopy {
  const base = siteUrl.replace(/\/$/, '');
  const left = formatGbp(Math.max(0, n.balancePence));
  const subject = `You have ${left} of Stayful credit left`;
  const heading = 'You’re nearly out of credit';
  const first = `You have ${left} of credit left. When it runs out, your daily deals and reports pause.`;
  if (n.kind === 'pack' && n.pack) {
    return { subject, heading, lines: [first, n.pack.body], buttons: [{ label: n.pack.cta, url: `${base}/today?offer=pack`, primary: true }] };
  }
  const lines = [first];
  const buttons: Link[] = [];
  if (n.starter) {
    lines.push(`${n.starter.name}: ${money(n.starter.pricePence)} a month gets you ${money(n.starter.creditPence)} of credit every month, and plan credit goes further than top-ups. Cancel any time.`);
    buttons.push({ label: `Start ${n.starter.name}`, url: `${base}${choosePath('starter')}`, primary: true });
  }
  lines.push(`${n.starter ? 'Or top up' : 'Top up'} ${money(n.topupPence)}: credit that never expires.`);
  buttons.push({ label: `Top up ${money(n.topupPence)}`, url: `${base}${choosePath('topup')}`, primary: !n.starter });
  if (n.card) lines.push(`${n.starter ? 'Either goes' : 'It goes'} on your card ending ${n.card.last4}, once you confirm.`);
  return { subject, heading, lines, buttons };
}

/** The notice as a block at the top of the day's daily email. */
export function lowCreditSection(n: LowCreditNotice, siteUrl: string): Section {
  const c = lowCreditCopy(n, siteUrl);
  return {
    key: 'notice',
    title: null,
    blocks: [{ type: 'text', text: c.heading, tone: 'strong' }, ...c.lines.map((text) => ({ type: 'text' as const, text, tone: 'callout' as const })), { type: 'buttons', links: c.buttons }],
  };
}

/** The notice alone, in the day's daily slot, when no daily email went. */
export function lowCreditMessage(n: LowCreditNotice, siteUrl: string, unsubscribe: Unsubscribe | null): Message {
  const c = lowCreditCopy(n, siteUrl);
  return {
    kind: 'low_credit',
    subject: c.subject,
    eyebrow: 'Stayful · Your credit',
    sections: [{ key: 'notice', title: c.heading, blocks: [...c.lines.map((text) => ({ type: 'text' as const, text })), { type: 'buttons', links: c.buttons }] }],
    reason: 'You get this because “Picks paused / out of credit” is on.',
    manageUrl: manageNotificationsUrl(siteUrl.replace(/\/$/, '')),
    unsubscribe,
  };
}
