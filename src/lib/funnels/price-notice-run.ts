import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { sendEmail, isEmailConfigured } from '../email/send';
import { getBillingSettings } from '../credit/unit-costs';
import { funnelPriceNoticeEmail } from '../email/funnel-price-notice.ts';
import { siteUrl } from '../url';
import { tiersStartFor } from './tiers';
import { getFunnelTierSettings, invalidateFunnelTierCache } from './tiers-server';

/**
 * Batch 22f: sends the funnel owners' notice of volume-tier pricing, from
 * /admin/management, dry run first. The audience is every owner whose first
 * funnel predates tier pricing (billing_settings.funnel_tiers_from) and who
 * has not been told (profiles.funnel_price_notice_sent_at). Each owner's
 * tiers start funnel_notice_days after THEIR email, so the date in it is
 * true for them. Stamped after each send; the idempotency key stops a repeat.
 * Never touches the members' pricing notice.
 */

const TIME_BUDGET_MS = 45_000;
const SAMPLE = 10;

export interface FunnelNoticeResult {
  status: number;
  body: Record<string, unknown>;
}

type Owner = { id: string; email: string | null; full_name: string | null };

/** The first word of the name, unless it is a single letter (the daily notices' rule). */
function firstNameOf(fullName: string | null): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length > 1 ? first : null;
}

export async function runFunnelPriceNotice(opts: { dry: boolean; now?: Date }): Promise<FunnelNoticeResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  invalidateFunnelTierCache();
  const [tiers, settings] = await Promise.all([getFunnelTierSettings(), getBillingSettings()]);
  if (!tiers.tiersFrom) return { status: 409, body: { error: 'funnel_tiers_from is not set: run the Batch 22f schema section first.' } };

  const { data: funnels, error: fErr } = await admin.from('funnels').select('user_id, created_at').lt('created_at', tiers.tiersFrom.toISOString());
  if (fErr) return { status: 500, body: { error: `funnels read failed: ${fErr.message}` } };
  const ownerIds = [...new Set(((funnels ?? []) as { user_id: string }[]).map((f) => f.user_id))];
  let owners: Owner[] = [];
  if (ownerIds.length > 0) {
    const { data, error } = await admin.from('profiles').select('id, email, full_name').in('id', ownerIds).is('funnel_price_notice_sent_at', null).not('email', 'is', null);
    if (error) return { status: 500, body: { error: `profiles read failed (schema.sql not run?): ${error.message}` } };
    owners = (data ?? []) as Owner[];
  }
  const fromDate = tiersStartFor(now, tiers.noticeDays).toISOString().slice(0, 10);
  const build = (o: Owner) => funnelPriceNoticeEmail({ siteUrl: siteUrl(), firstName: firstNameOf(o.full_name), fromDate, tiers: tiers.tiers, enhancedExtraPence: tiers.enhancedExtraPence, topupRate: settings.spendRates.topup });

  if (opts.dry) {
    const sample = owners[0] ? build(owners[0]) : null;
    return {
      status: 200,
      body: {
        dry: true,
        audience: owners.length,
        sample: owners.slice(0, SAMPLE).map((o) => o.email),
        canSend: owners.length > 0,
        tiersFrom: fromDate,
        subject: sample?.subject ?? null,
        preview: sample?.text.slice(0, 1500) ?? null,
        ms: Date.now() - started,
      },
    };
  }
  if (!isEmailConfigured()) return { status: 200, body: { dry: false, audience: owners.length, sent: 0, failed: 0, remaining: owners.length, error: 'email_not_configured' } };

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];
  let i = 0;
  for (; i < owners.length; i += 1) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const o = owners[i];
    if (!o.email) continue;
    const mail = build(o);
    const res = await sendEmail({ to: o.email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `funnel-price-notice:${o.id}` });
    if (!res.sent) {
      failed += 1;
      if (failures.length < SAMPLE) failures.push(`${o.email} (${res.reason ?? 'failed'})`);
      continue;
    }
    const { error } = await admin.from('profiles').update({ funnel_price_notice_sent_at: now.toISOString() }).eq('id', o.id).is('funnel_price_notice_sent_at', null);
    if (error) console.error('[funnel-price-notice] stamp failed:', error.message);
    sent += 1;
  }
  return { status: 200, body: { dry: false, audience: owners.length, tiersFrom: fromDate, sent, failed, failures, remaining: owners.length - i + failed, ranOutOfTime: i < owners.length, ms: Date.now() - started } };
}
