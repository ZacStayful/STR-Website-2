import 'server-only';

/**
 * The one-off notice of Batch 10's prices, terms and privacy policy
 * (src/lib/email/pricing-notice.ts). Pressed by hand on /admin/billing, dry
 * run first; nothing here runs on deploy.
 *
 * Audience: every account with an email that has signed in at least once,
 * team members included (decided: Q15b), not yet sent it. It is a service
 * notice, so it goes outside the one-email-a-day cap (Q15a): it takes no
 * daily slot, and carries its own idempotency key, so no retry sends it twice.
 * Each profile is stamped (pricing_notice_sent_at) after its send, and a
 * press that runs out of time leaves the rest for the next press.
 *
 * It refuses to send unless a new pricing date is saved and is at least 14
 * days away. The first send records the date it announces
 * (billing_settings.pricing_notice_date): only then does that date take
 * effect (effectivePricingDate).
 */
import { createAdminClient } from '../supabase/admin';
import { sendEmail, isEmailConfigured } from '../email/send';
import { pricingNoticeEmail, type NoticePlan } from '../email/pricing-notice';
import { siteUrl } from '../url';
import { getBillingSettings, updateBillingSetting } from './unit-costs';
import { getPlans } from './plans';
import { PRICING_NOTICE_DAYS } from './deal-pricing';
import { ladderRangeText } from '../marketplace/ladder';
import { payersForAll } from '../notify/daily-server';

const TIME_BUDGET_MS = 45_000;
const PAGE = 1000;
const MAX_AUDIENCE = 50_000;
const SAMPLE = 10;
/** The top-up rate these prices replace, for "down from 1.5×". */
const PREVIOUS_TOPUP_RATE = 1.5;
const LIVE = new Set(['active', 'trialing', 'past_due']);

type Row = { id: string; email: string | null; full_name: string | null; plan_code: string | null; stripe_subscription_status: string | null; current_period_end: string | null };

export interface NoticeRunResult {
  status: number;
  body: Record<string, unknown>;
}

function firstNameOf(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

/** Whether the notice may go now, and the date it announces. */
export function noticeAllowed(planned: string | null, now: Date = new Date()): { ok: true; date: string } | { ok: false; reason: string } {
  if (!planned) return { ok: false, reason: 'No new pricing date is saved. Set one under Deal prices first.' };
  const at = Date.parse(planned);
  if (!Number.isFinite(at)) return { ok: false, reason: 'The saved date is not a date.' };
  const days = (at - now.getTime()) / (24 * 60 * 60 * 1000);
  if (days < PRICING_NOTICE_DAYS) return { ok: false, reason: `The new pricing date is ${planned.slice(0, 10)}, less than ${PRICING_NOTICE_DAYS} days away. Move it later before sending the notice.` };
  return { ok: true, date: planned.slice(0, 10) };
}

export async function runPricingNotice(opts: { dry: boolean }): Promise<NoticeRunResult> {
  const started = Date.now();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const settings = await getBillingSettings();
  const allowed = noticeAllowed(settings.dealPricing.newPricingPlanned);

  const rows: Row[] = [];
  for (let from = 0; from < MAX_AUDIENCE; from += PAGE) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, email, full_name, plan_code, stripe_subscription_status, current_period_end')
      .not('email', 'is', null)
      .not('welcome_checked_at', 'is', null)
      .is('pricing_notice_sent_at', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { status: 500, body: { error: `profiles read failed (schema.sql not run?): ${error.message}` } };
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const [plans, payers] = await Promise.all([getPlans(), payersForAll(rows.map((r) => r.id))]);
  const planByCode = new Map(plans.map((p) => [p.code, p]));
  const planOf = (r: Row): NoticePlan | null => {
    const p = r.plan_code && LIVE.has(String(r.stripe_subscription_status ?? '')) ? planByCode.get(r.plan_code) : null;
    return p ? { code: p.code, name: p.name, interval: p.interval === 'year' ? 'year' : 'month', monthlyCreditPence: p.monthlyCreditPence } : null;
  };
  const byPlan: Record<string, number> = {};
  for (const r of rows) {
    const key = payers.get(r.id)?.memberId ? 'team_member' : (planOf(r)?.code ?? 'pay_as_you_go');
    byPlan[key] = (byPlan[key] ?? 0) + 1;
  }
  const build = (r: Row, date: string) =>
    pricingNoticeEmail({
      siteUrl: siteUrl(),
      firstName: firstNameOf(r.full_name),
      date,
      pricing: settings.dealPricing,
      ladderText: ladderRangeText(settings.dealOpenLadder),
      topupRate: settings.spendRates.topup,
      previousTopupRate: PREVIOUS_TOPUP_RATE,
      plan: payers.get(r.id)?.memberId ? null : planOf(r),
      periodEnd: r.current_period_end,
      teamMember: Boolean(payers.get(r.id)?.memberId),
    });

  if (opts.dry) {
    const sample = rows[0] && allowed.ok ? build(rows[0], allowed.date) : null;
    return {
      status: 200,
      body: {
        dry: true,
        audience: rows.length,
        byPlan,
        sample: rows.slice(0, SAMPLE).map((r) => r.email),
        canSend: allowed.ok,
        ...(allowed.ok ? { announces: allowed.date, subject: sample?.subject ?? null, preview: sample?.text.slice(0, 1200) ?? null } : { reason: allowed.reason }),
        ms: Date.now() - started,
      },
    };
  }
  if (!allowed.ok) return { status: 409, body: { dry: false, error: allowed.reason, audience: rows.length } };
  if (!isEmailConfigured()) return { status: 200, body: { dry: false, audience: rows.length, sent: 0, failed: 0, remaining: rows.length, error: 'email_not_configured' } };

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];
  let i = 0;
  let announced = settings.dealPricing.pricingNoticeFor?.slice(0, 10) === allowed.date;
  for (; i < rows.length; i += 1) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const r = rows[i];
    if (!r.email) continue;
    const mail = build(r, allowed.date);
    const res = await sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `pricing-notice:${r.id}:${allowed.date}` });
    if (!res.sent) {
      failed += 1;
      if (failures.length < SAMPLE) failures.push(`${r.email} (${res.reason ?? 'failed'})`);
      continue;
    }
    // Stamped after the send: a send that was accepted but not recorded would
    // repeat, but under the same idempotency key, so the provider refuses it.
    const { error: stampErr } = await admin.from('profiles').update({ pricing_notice_sent_at: new Date().toISOString() }).eq('id', r.id);
    if (stampErr) console.error('[pricing-notice] stamp failed:', stampErr.message);
    sent += 1;
    // The first notice out announces the date: from now it can take effect.
    if (!announced) {
      try {
        await updateBillingSetting('pricing_notice_date', allowed.date);
        announced = true;
      } catch (err) {
        // Tried again with the next send; until it sticks the date does not take effect.
        console.error('[pricing-notice] announcing the date failed:', (err as Error)?.message ?? err);
      }
    }
  }
  const remaining = rows.length - i + failed;
  return { status: 200, body: { dry: false, audience: rows.length, announces: allowed.date, sent, failed, failures, remaining, ranOutOfTime: i < rows.length, ms: Date.now() - started } };
}
