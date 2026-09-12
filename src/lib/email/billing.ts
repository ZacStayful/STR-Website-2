import 'server-only';

import { sendEmail, isEmailConfigured } from './send';
import { escapeHtml } from './escape';
import { siteUrl } from '../url';
import { formatGbp } from '../credit/pricing';

/**
 * Billing emails (Resend). Each is a short, plain message with one link to
 * /account/billing. Sending never throws; callers fire these from after().
 */

function layout(title: string, paragraphs: string[], cta: { label: string; path: string }): { html: string; text: string } {
  const url = siteUrl(cta.path);
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f5f0;padding:24px;color:#1f2a1d">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e3da">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
<p style="margin:20px 0 0"><a href="${url}" style="display:inline-block;background:#2E3D2B;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(cta.label)}</a></p>
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">Stayful Intelligence · <a href="${siteUrl('/account/billing')}" style="color:#6b7280">Billing &amp; usage</a></p>
</div></body></html>`;
  const text = `${title}\n\n${paragraphs.join('\n\n')}\n\n${cta.label}: ${url}\n`;
  return { html, text };
}

async function send(to: string | null | undefined, subject: string, body: { html: string; text: string }): Promise<boolean> {
  if (!to || !isEmailConfigured()) return false;
  const res = await sendEmail({ to, subject, ...body });
  return res.sent;
}

export function lowBalanceEmail(to: string, opts: { remainingPence: number; planName: string | null }) {
  return send(to, "You're running low on Stayful credit", layout("You're running low on credit", [
    `You have ${formatGbp(opts.remainingPence)} of credit left${opts.planName ? ` on your ${opts.planName} plan this month` : ''}. When it runs out, reports and listing checks pause until you top up or upgrade.`,
    'Upgrading gives you monthly credit at the standard rate; top-up credit never expires but is spent at 1.5× the plan rate.',
  ], { label: 'Top up or upgrade', path: '/account/billing' }));
}

export function outOfCreditEmail(to: string, opts: { planName: string | null }) {
  return send(to, "You're out of Stayful credit", layout("You're out of credit", [
    `Your ${opts.planName ? `${opts.planName} plan` : 'welcome'} credit is used up, so reports and listing checks are paused.`,
    'Top up in one click or upgrade your plan to carry on. Upgrading is the better value if you run reports regularly.',
  ], { label: 'Top up or upgrade', path: '/account/billing#topup' }));
}

export function topupReceiptEmail(to: string, opts: { amountPence: number; balancePence: number }) {
  return send(to, `Receipt: ${formatGbp(opts.amountPence)} Stayful top-up`, layout('Top-up received', [
    `Thanks — ${formatGbp(opts.amountPence)} of credit has been added to your account. Your balance is now ${formatGbp(opts.balancePence)}.`,
    'Top-up credit never expires. Your Stripe receipt will arrive separately.',
  ], { label: 'View usage', path: '/account/billing' }));
}

export function planRenewedEmail(to: string, opts: { planName: string; creditPence: number; periodEnd: string | null }) {
  return send(to, `Your ${opts.planName} credit is ready`, layout(`${formatGbp(opts.creditPence)} of ${opts.planName} credit added`, [
    `Your ${opts.planName} plan has renewed and ${formatGbp(opts.creditPence)} of credit is on your account${opts.periodEnd ? `, valid until ${new Date(opts.periodEnd).toLocaleDateString('en-GB')}` : ''}.`,
    'Unused plan credit resets at the end of each billing month; top-up credit is kept.',
  ], { label: 'Run a report', path: '/estimate' }));
}

export function paymentFailedEmail(to: string, opts: { planName: string | null }) {
  return send(to, 'Action needed: your Stayful payment failed', layout('Your payment failed', [
    `We couldn't take payment for your ${opts.planName ?? 'Stayful'} subscription. Stripe will retry automatically over the next few days.`,
    'To avoid losing your monthly credit, update your card now.',
  ], { label: 'Update card', path: '/account/billing' }));
}

export function cardNeedsUpdateEmail(to: string) {
  return send(to, 'Your saved card needs updating', layout('Your saved card needs updating', [
    'A one-click top-up on your saved card was declined or needs authentication, so auto top-up has been switched off.',
    'Add a new card or top up manually to keep going.',
  ], { label: 'Update card', path: '/account/billing#topup' }));
}

export function subscriberTransitionEmail(to: string, opts: { firstName: string | null; creditPence: number; renewsAt: string | null }) {
  return send(to, 'A change to how your Stayful subscription works', layout(`${opts.firstName ? `${opts.firstName}, a` : 'A'} change to your subscription`, [
    "We're moving Stayful to usage-based credit. Your Pro subscription stays exactly the same price, and from your next renewal it gives you " + formatGbp(opts.creditPence) + ' of credit every month instead of unlimited reports.',
    'Every report shows what it will use before you run it (about £3.50 for a standard report, or £7.25 with the PMI second opinion), so you always know where you stand. If you ever need more, you can top up in one click or move to the Scale plan.',
    opts.renewsAt ? `Your next renewal is on ${new Date(opts.renewsAt).toLocaleDateString('en-GB')}. Until then nothing changes.` : 'Until your next renewal nothing changes.',
  ], { label: 'See your billing page', path: '/account/billing' }));
}
