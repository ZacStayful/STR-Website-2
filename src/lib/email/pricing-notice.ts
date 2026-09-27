/**
 * The one-off notice to members about Batch 10's prices, terms and privacy
 * policy, sent from /admin/billing at least 14 days before the new pricing
 * date (billing_settings.new_pricing_from), after a dry run. Every price in
 * it comes from the settings, so it says what the buttons will charge.
 *
 * Pure: the runner (src/lib/credit/pricing-notice-run.ts) sends it.
 */
import { escapeHtml as esc } from './escape.ts';
import { dailyDealsMonthly, formatPence, planCreditFor, type DealPricing } from '../credit/deal-pricing.ts';

export interface NoticeEmail {
  subject: string;
  text: string;
  html: string;
}

export interface NoticePlan {
  code: string;
  name: string;
  interval: 'month' | 'year';
  /** billing_plans.monthly_credit_pence: the credit before the new pricing. */
  monthlyCreditPence: number;
}

export interface NoticeInput {
  siteUrl: string;
  firstName: string | null;
  /** The new pricing date, YYYY-MM-DD. */
  date: string;
  pricing: Pick<DealPricing, 'fullAnalysisPence' | 'pmiAddonPence' | 'todays5DailyPence' | 'planCreditPence' | 'newPricingFrom'>;
  ladderText: string;
  /** The top-up rate now, and the one it replaces. */
  topupRate: number;
  previousTopupRate: number;
  /** The member's own plan, when they pay for one; null for pay as you go. */
  plan: NoticePlan | null;
  /** The member's current period end (their next renewal), when on a plan. */
  periodEnd: string | null;
  /** A team member: their owner pays and manages the plan. */
  teamMember: boolean;
}

const MONTH_MS = 31 * 24 * 60 * 60 * 1000;

export function longDate(isoOrDay: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? `${isoOrDay}T12:00:00Z` : isoOrDay);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : isoOrDay;
}

/**
 * The first renewal on or after the pricing date: monthly plans step a month
 * at a time from the current period end, annual plans a year at a time.
 */
export function firstRenewalOnOrAfter(periodEnd: string | null, date: string, interval: 'month' | 'year'): string | null {
  if (!periodEnd) return null;
  const at = new Date(periodEnd);
  const from = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(from.getTime())) return null;
  for (let i = 0; i < 40 && at.getTime() < from.getTime(); i += 1) {
    if (interval === 'year') at.setUTCFullYear(at.getUTCFullYear() + 1);
    else at.setUTCMonth(at.getUTCMonth() + 1);
  }
  return at.getTime() - from.getTime() > 13 * MONTH_MS ? null : at.toISOString();
}

const gbp = (p: number) => formatPence(p);

/** The one line about the member's own plan. */
export function planLine(input: Pick<NoticeInput, 'plan' | 'periodEnd' | 'date' | 'pricing' | 'teamMember'>): string {
  if (input.teamMember) return 'Your team’s plan is managed by its owner, who gets this email too.';
  if (!input.plan) return 'Your top-up credit now goes further.';
  const p = input.plan;
  const next = planCreditFor(p, new Date(`${input.date}T00:00:00Z`), { ...input.pricing, newPricingFrom: input.date });
  const now = p.monthlyCreditPence;
  const label = p.interval === 'year' ? `annual ${p.name.replace(/\s*\(annual\)\s*/i, '')}` : p.name;
  if (next === now) return `Your ${label} plan: no change, still ${gbp(now)} of credit a month.`;
  const renewal = firstRenewalOnOrAfter(input.periodEnd, input.date, p.interval);
  const when = renewal ? `from your ${p.interval === 'year' ? 'annual ' : ''}renewal on ${longDate(renewal)}` : `from your first ${p.interval === 'year' ? 'annual ' : ''}renewal on or after ${longDate(input.date)}`;
  return `Your ${label} plan: ${gbp(next)} of credit a month, ${when} (it’s ${gbp(now)} ${p.interval === 'year' ? 'a month ' : ''}today).`;
}

export function pricingNoticeEmail(input: NoticeInput): NoticeEmail {
  const base = input.siteUrl.replace(/\/$/, '');
  const day = longDate(input.date);
  const hi = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const p = input.pricing;
  const links = { terms: `${base}/terms`, privacy: `${base}/privacy`, usage: `${base}/account/usage`, pricing: `${base}/pricing`, notifications: `${base}/account/notifications`, account: `${base}/account` };
  const today = [
    `Quick look at a deal: unchanged, ${input.ladderText} depending on the deal.`,
    `Full analysis of a deal: a flat ${gbp(p.fullAnalysisPence)} on a plan, instead of a price that varied by property. If you’ve already had a quick look, what you paid comes off the ${gbp(p.fullAnalysisPence)}.`,
    `Second opinion from Property Market Intel: optional, +${gbp(p.pmiAddonPence)}, when you run a full analysis or later from the finished report.`,
    `Top-up credit: now spent at ${input.topupRate}× the plan rate, down from ${input.previousTopupRate}×.`,
  ];
  const later = [
    `Daily deals (Today’s 5): ${gbp(p.todays5DailyPence)} a day, ${dailyDealsMonthly(p.todays5DailyPence)}, charged only on days we send them. This replaces the charge per pick. You can switch daily deals off any time in Account → Notifications.`,
    `Plan credit becomes £1 of credit for every £1 you pay, from your first renewal on or after ${day}. ${planLine(input)}`,
  ];
  const terms = `We’ve updated our terms of service (${links.terms}) to cover these prices, and published a privacy policy (${links.privacy}) explaining what we collect and why. The changes to daily deals and plan credit apply from ${day}.`;
  const close = `Your new Usage page shows where your credit goes: ${links.usage}. Full details are on our pricing page: ${links.pricing}. If you’d rather not carry on, you can cancel any time from Account (${links.account}) before ${day}.`;
  const subject = `Changes to Stayful prices from ${day}`;
  const text = [
    hi,
    '',
    'We’re making Stayful’s prices simpler. Here is what changes and when.',
    '',
    'FROM TODAY',
    ...today.map((l) => `• ${l}`),
    '',
    `FROM ${day.toUpperCase()}`,
    ...later.map((l) => `• ${l}`),
    '',
    'OUR TERMS AND A NEW PRIVACY POLICY',
    terms,
    '',
    close,
    '',
    'Thanks,',
    'The Stayful team',
  ].join('\n');
  const li = (l: string) => `<li style="margin:6px 0">${esc(l)}</li>`;
  const h = (t: string) => `<p style="margin:20px 0 6px;font-weight:700">${esc(t)}</p>`;
  const a = (href: string, label: string) => `<a href="${esc(href)}" style="color:#2e3d2b">${esc(label)}</a>`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:560px;margin:0 auto;padding:24px">
  <p style="margin:0 0 14px">${esc(hi)}</p>
  <p style="margin:0 0 14px">We’re making Stayful’s prices simpler. Here is what changes and when.</p>
  ${h('From today')}
  <ul style="margin:0;padding-left:18px">${today.map(li).join('')}</ul>
  ${h(`From ${day}`)}
  <ul style="margin:0;padding-left:18px">${later.map(li).join('')}</ul>
  ${h('Our terms and a new privacy policy')}
  <p style="margin:0 0 14px">We’ve updated our ${a(links.terms, 'terms of service')} to cover these prices, and published a ${a(links.privacy, 'privacy policy')} explaining what we collect and why. The changes to daily deals and plan credit apply from ${esc(day)}.</p>
  <p style="margin:0 0 14px">Your new ${a(links.usage, 'Usage page')} shows where your credit goes. Full details are on our ${a(links.pricing, 'pricing page')}. If you’d rather not carry on, you can cancel any time from ${a(links.account, 'Account')} before ${esc(day)}.</p>
  <p style="margin:0">Thanks,<br>The Stayful team</p>
  <p style="margin:24px 0 0;font-size:12px;color:#7a8274">A service notice about your Stayful Intelligence account. ${a(links.notifications, 'Manage notifications')}</p>
</div>`;
  return { subject, text, html };
}
