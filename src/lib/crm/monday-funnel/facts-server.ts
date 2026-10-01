import 'server-only';

import type { createAdminClient } from '../../supabase/admin';
import { isAdminEmail } from '../../admin';
import { ACCESS_COLUMNS, accountStatus, hasEverPaid, isPaused, type AccessProfile } from '../../access';
import { normaliseMobile } from '../../credit/abuse';
import { getBillingSettings } from '../../credit/unit-costs';
import { getPlans } from '../../credit/plans';
import { isPackAccount } from '../../lifecycle/settings';
import { payersForStrict } from '../../team';
import { parseAboutYou } from '../../profile/about';
import { contactCanReceive } from '../../sms/choose';
import { isStaffEmail } from '../../inactivity/rules';
import { monthlyValuePence, totalPaidPence } from '../../payments/rules';
import { adSourceText, earliest, emailOkFor, legacyPayments, weeksSinceSignup, type MemberFacts } from './facts';

/**
 * The Monday funnel's view of members (Batch 20, Part F): one MemberFacts
 * each, from batched reads (profiles, the Batch 20 columns in a read of their
 * own, member stats and balances from the Batch 20 functions, SMS contacts,
 * Batch 19's attribution). Admins, Stayful accounts, team members and, Batch
 * 21 (E8, Q10), accounts the admin excluded from the metrics are left out:
 * they never have funnel rows, and a row they already have is left alone.
 */

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const ID_CHUNK = 300;

type ProfileRow = AccessProfile & {
  id: string;
  email: string | null;
  full_name: string | null;
  mobile: string | null;
  mobile_key: string | null;
  created_at: string | null;
  monday_item_id: string | null;
  hit_zero_at: string | null;
  last_topup_at: string | null;
  subscription_started_at: string | null;
  subscription_ended_at: string | null;
  sourcing_alerts: boolean | null;
  alert_missed: boolean | null;
  about_you: unknown;
  /** Batch 21 (D4): the first sign-in; null for an unconfirmed sign-up, which is not OK to email. */
  welcome_checked_at: string | null;
};

type Stats = { u: string; last_day: string | null; days: number; weeks: number; paid: number; refunded: number; first_paid: string | null; topups: number; last_topup: string | null; pack_at: string | null };

const PROFILE_COLUMNS = `id, email, full_name, mobile, mobile_key, created_at, monday_item_id, hit_zero_at, last_topup_at, subscription_started_at, subscription_ended_at, sourcing_alerts, alert_missed, about_you, welcome_checked_at, ${ACCESS_COLUMNS}`;

export type LeftReason = 'admin' | 'staff' | 'team_member' | 'no_email' | 'excluded';

export type FactsResult = { ok: true; facts: MemberFacts[]; left: { userId: string; reason: LeftReason }[] } | { ok: false; error: string };

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Facts for these members, or for everyone. */
export async function loadFacts(admin: Admin, opts: { userIds?: readonly string[]; now?: Date } = {}): Promise<FactsResult> {
  const now = opts.now ?? new Date();
  const profiles: ProfileRow[] = [];
  if (opts.userIds) {
    for (const some of chunks(opts.userIds, ID_CHUNK)) {
      const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).in('id', some);
      if (error) return { ok: false, error: `profiles read failed: ${error.message}` };
      profiles.push(...((data ?? []) as unknown as ProfileRow[]));
    }
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) return { ok: false, error: `profiles read failed: ${error.message}` };
      profiles.push(...((data ?? []) as unknown as ProfileRow[]));
      if ((data?.length ?? 0) < PAGE) break;
    }
  }

  const left: { userId: string; reason: LeftReason }[] = [];
  // Never guessed: a failed team lookup would give every team member a row.
  const payers = await payersForStrict(profiles.map((p) => p.id));
  if (!payers) return { ok: false, error: 'team lookup failed' };
  // Batch 21 (E8, Q10): the admin's "Exclude from metrics" switch. Unreadable: nobody is given a row by mistake.
  const excluded = new Set<string>();
  {
    const { data, error } = await admin.from('activity_excluded_accounts').select('user_id');
    if (error) return { ok: false, error: `excluded accounts unreadable: ${error.message}` };
    for (const r of (data ?? []) as { user_id: string }[]) excluded.add(r.user_id);
  }
  const members = profiles.filter((p) => {
    const reason: LeftReason | null = !p.email ? 'no_email' : isAdminEmail(p.email) ? 'admin' : isStaffEmail(p.email) ? 'staff' : payers.get(p.id)?.memberId ? 'team_member' : excluded.has(p.id) ? 'excluded' : null;
    if (reason) left.push({ userId: p.id, reason });
    return reason === null;
  });
  const ids = members.map((p) => p.id);
  if (ids.length === 0) return { ok: true, facts: [], left };

  // The Batch 20 columns, and the stats, balances, texts and attribution, each in reads of their own.
  const marks = new Map<string, { reengage_since: string | null; starter_pack_bought_at: string | null }>();
  const stats = new Map<string, Stats>();
  const balances = new Map<string, { total: number; spendable: number }>();
  const sms = new Map<string, boolean>();
  const attribution = new Map<string, { utm_source: string | null; utm_campaign: string | null; utm_content: string | null }>();
  for (const some of chunks(ids, ID_CHUNK)) {
    const [m, s, b, t, a] = await Promise.all([
      admin.from('profiles').select('id, reengage_since, starter_pack_bought_at').in('id', some),
      admin.rpc('lifecycle_member_stats', { p: { users: some } }),
      admin.rpc('lifecycle_balances', { p: { users: some } }),
      admin.from('sms_contacts').select('user_id, phone_e164, verified_at, enabled, stopped_at').in('user_id', some),
      admin.from('member_attribution').select('user_id, utm_source, utm_campaign, utm_content').in('user_id', some),
    ]);
    if (m.error) return { ok: false, error: `Batch 20 columns unreadable (schema not run?): ${m.error.message}` };
    if (s.error) return { ok: false, error: `member stats unreadable: ${s.error.message}` };
    if (b.error) return { ok: false, error: `balances unreadable: ${b.error.message}` };
    for (const r of (m.data ?? []) as { id: string; reengage_since: string | null; starter_pack_bought_at: string | null }[]) marks.set(r.id, r);
    for (const r of (s.data ?? []) as Stats[]) stats.set(r.u, r);
    for (const r of (b.data ?? []) as { u: string; total: number | string; spendable: number | string }[]) balances.set(r.u, { total: Number(r.total) || 0, spendable: Number(r.spendable) || 0 });
    // SMS OK and the ad source degrade to "no" and "direct / unknown" when their tables cannot be read.
    if (t.error) console.warn('[monday-funnel] sms contacts unreadable:', t.error.message);
    for (const r of (t.data ?? []) as { user_id: string; phone_e164: string | null; verified_at: string | null; enabled: boolean; stopped_at: string | null }[]) sms.set(r.user_id, contactCanReceive(r));
    if (a.error) console.warn('[monday-funnel] attribution unreadable:', a.error.message);
    for (const r of (a.data ?? []) as { user_id: string; utm_source: string | null; utm_campaign: string | null; utm_content: string | null }[]) attribution.set(r.user_id, r);
  }

  const settings = await getBillingSettings();
  const plans = new Map((await getPlans()).map((p) => [p.code, p]));
  const facts: MemberFacts[] = members.map((p) => {
    const st = stats.get(p.id);
    const bal = balances.get(p.id) ?? { total: 0, spendable: 0 };
    const mark = marks.get(p.id);
    const status = accountStatus(p, now.getTime());
    const endedAt = p.subscription_ended_at ?? null;
    const ended = time(endedAt);
    const lastTopup = time(p.last_topup_at);
    const plan = p.plan_code ? plans.get(p.plan_code) ?? null : null;
    const packAt = mark?.starter_pack_bought_at ?? st?.pack_at ?? null;
    const legacy = legacyPayments(p, { recordedTopups: Number(st?.topups ?? 0), packAt });
    return {
      userId: p.id,
      email: p.email,
      name: p.full_name,
      mobile: p.mobile,
      mobileKey: p.mobile_key || normaliseMobile(p.mobile),
      createdAt: p.created_at,
      mondayItemId: p.monday_item_id,
      planStatus: status,
      subscriptionStatus: p.stripe_subscription_status ?? null,
      planCode: p.plan_code ?? null,
      manualNoTier: p.plan === 'pro' && p.plan_source === 'manual' && !p.plan_code,
      paused: isPaused(p, now.getTime()),
      cancelAt: p.subscription_cancel_at ?? null,
      endedAt,
      paidSinceEnd: ended !== null && lastTopup !== null && lastTopup > ended,
      balancePence: bal.total,
      spendableBasePence: bal.spendable,
      totalPaidPence: totalPaidPence(Number(st?.paid ?? 0), Number(st?.refunded ?? 0)),
      paidEver: hasEverPaid(p) || Number(st?.paid ?? 0) > 0,
      monthlyValuePence: monthlyValuePence({ status: p.stripe_subscription_status ?? null, paused: isPaused(p, now.getTime()), plan: plan ? { pricePence: plan.pricePence, interval: plan.interval } : null }),
      firstPaidAt: earliest(st?.first_paid ?? null, legacy.firstPaidAt),
      topups: Number(st?.topups ?? 0) + (legacy.topupAt ? 1 : 0),
      lastTopupAt: st?.last_topup ?? legacy.topupAt,
      packBoughtAt: packAt,
      hitZeroAt: p.hit_zero_at,
      lastActiveDay: st?.last_day ?? null,
      activeDays: Number(st?.days ?? 0),
      activeWeeks: Number(st?.weeks ?? 0),
      weeksSinceSignup: weeksSinceSignup(p.created_at, now),
      reengageSince: mark?.reengage_since ?? null,
      emailOk: emailOkFor(p),
      smsOk: sms.get(p.id) ?? false,
      nextDeal: parseAboutYou(p.about_you)?.nextDeal ?? null,
      adSource: adSourceText(attribution.get(p.id)),
      packAccount: isPackAccount(p.created_at, settings.lifecycle),
    };
  });
  return { ok: true, facts, left };
}
