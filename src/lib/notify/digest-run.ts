import 'server-only';

/**
 * The 08:10 daily digest: the daily email for everyone who has not had one
 * today. It runs after the three picks passes (07:00–07:40) and the
 * picks-paused letter (08:00), so it only ever fills the day's one slot
 * when nothing else did:
 *
 *   picks on, no pick today   Today's 5 without a pick: the rest of the
 *                             member's Today, plus any changes. Not charged.
 *                             (A paused subscription gets the changes only.)
 *   picks off                 "Changes on your deals", only on a day with changes.
 *
 * "Changes" follow the "Changes on deals I'm tracking" switch; the teasers
 * follow Daily picks. Nothing goes to anyone whose slot is used, and nothing
 * with no content goes at all. Nothing here is charged.
 *
 * Entry point: /api/internal/daily-digest (the cron, secret-gated, ?dry=1).
 */
import { createAdminClient } from '../supabase/admin';
import { isPaused, hasEverPaid, PAID_TIER_COLUMNS, type PaidTierAccount } from '../access';
import { isAdminEmail } from '../admin';
import { payersFor } from '../team';
import { getBillingSettings } from '../credit/unit-costs';
import { parseMarketGoals } from '../market/goals';
import { dealVisibility, PAID_VISIBILITY } from '../marketplace/visibility';
import type { MemberContext } from '../today/selection';
import { sendEmail, isEmailConfigured } from '../email/send';
import { siteUrl } from '../url';
import { buildDaily } from './message';
import { renderEmail } from './render-email';
import { claimSlot, finishSend, markSending, releaseClaim, slotsInUse } from './sends';
import { newSendToken, sendKey } from './cap';
import { pendingChanges, trackedAlertsOn } from './alerts-server';
import { mapLimit, teasersFrom, todayPlans } from './daily-server';

const TIME_BUDGET_MS = 50_000;
const PAGE = 1000;
const ID_CHUNK = 150;

type ProfileRow = PaidTierAccount & {
  id: string;
  email: string | null;
  market_goals: unknown;
  sourcing_alerts: boolean | null;
  welcome_checked_at: string | null;
  subscription_paused_from: string | null;
  subscription_paused_until: string | null;
};

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
}

export async function runDailyDigest(opts: { dry: boolean; onlyUserIds?: string[] }): Promise<RunResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const now = new Date();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }

  // ── Who might be owed a daily email: picks on, or changes waiting ──
  const picksOn: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from('profiles')
      .select(`id, email, market_goals, sourcing_alerts, welcome_checked_at, subscription_paused_from, subscription_paused_until, ${PAID_TIER_COLUMNS}`)
      .eq('sourcing_alerts', true)
      .not('welcome_checked_at', 'is', null);
    if (opts.onlyUserIds) q = q.in('id', opts.onlyUserIds);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { status: 500, body: { error: `profiles read failed: ${error.message}` } };
    picksOn.push(...((data ?? []) as unknown as ProfileRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  // Members with alerts waiting, whatever their daily picks switch says.
  const waiting = new Set<string>();
  {
    const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    for (let from = 0; ; from += PAGE) {
      let q = admin.from('deal_alerts').select('user_id').is('notified_at', null).gte('created_at', since);
      if (opts.onlyUserIds) q = q.in('user_id', opts.onlyUserIds);
      const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) {
        console.warn('[digest] deal_alerts read failed (schema behind?):', error.message);
        break;
      }
      for (const r of (data ?? []) as { user_id: string }[]) waiting.add(r.user_id);
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  const byId = new Map(picksOn.map((p) => [p.id, p]));
  const extra = [...waiting].filter((id) => !byId.has(id));
  for (let i = 0; i < extra.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from('profiles')
      .select(`id, email, market_goals, sourcing_alerts, welcome_checked_at, subscription_paused_from, subscription_paused_until, ${PAID_TIER_COLUMNS}`)
      .in('id', extra.slice(i, i + ID_CHUNK));
    if (error) console.error('[digest] profiles read failed:', error.message);
    for (const p of (data ?? []) as unknown as ProfileRow[]) byId.set(p.id, p);
  }
  const ids = [...byId.keys()];
  const summary = { dry: opts.dry, considered: ids.length, emails: 0, emailFailures: 0, todays5: 0, changesOnly: 0, ranOutOfTime: false };
  const perUser: { user: string; sent: boolean; kind?: string; teasers?: number; changes?: number; reason?: string }[] = [];
  if (ids.length === 0) return { status: 200, body: { ...summary, members: perUser } };

  // ── Whose day is already spent, whose changes are on, what tier each is ──
  const [slots, alertsOn, pending, payers, settings] = await Promise.all([slotsInUse(admin, ids, 'daily', now), trackedAlertsOn(admin, ids), pendingChanges(admin, ids, now), payersFor(ids), getBillingSettings()]);
  if (slots === null && !opts.dry) return { status: 503, body: { error: 'notification_sends unreadable (schema behind?); nothing sent' } };
  const owners = new Map<string, PaidTierAccount>();
  const ownerIds = [...new Set([...payers.values()].map((p) => p.payerId))].filter((id) => !byId.has(id));
  for (let i = 0; i < ownerIds.length; i += ID_CHUNK) {
    const { data } = await admin.from('profiles').select(`id, ${PAID_TIER_COLUMNS}`).in('id', ownerIds.slice(i, i + ID_CHUNK));
    for (const r of (data ?? []) as unknown as (PaidTierAccount & { id: string })[]) owners.set(r.id, r);
  }
  const freeVisibility = dealVisibility('free', now, settings.freeDealDelayHours);
  const paidOf = (p: ProfileRow): boolean => {
    if (p.email && isAdminEmail(p.email)) return true;
    const payerId = payers.get(p.id)?.payerId ?? p.id;
    return hasEverPaid(byId.get(payerId) ?? owners.get(payerId) ?? null);
  };

  // Who gets teasers: picks on, signed in once, not paused, day not spent.
  const open = [...byId.values()].filter((p) => p.email && !(slots?.has(p.id)));
  for (const p of byId.values()) {
    if (!p.email) perUser.push({ user: p.id, sent: false, reason: 'no_email' });
    else if (slots?.has(p.id)) perUser.push({ user: p.id, sent: false, reason: 'slot_used' });
  }
  const wantsTeasers = (p: ProfileRow) => p.sourcing_alerts === true && p.welcome_checked_at !== null && !isPaused(p);
  const contexts: MemberContext[] = open.filter(wantsTeasers).map((p) => {
    const payerId = payers.get(p.id)?.payerId ?? p.id;
    return { userId: p.id, payerId, goals: parseMarketGoals(p.market_goals), savedAreas: [], visibility: paidOf(p) ? PAID_VISIBILITY : freeVisibility };
  });
  // Saved areas feed Today's choice exactly as the page reads them.
  for (let i = 0; i < contexts.length; i += ID_CHUNK) {
    const { data } = await admin.from('saved_areas').select('user_id, postcode_area').in('user_id', contexts.slice(i, i + ID_CHUNK).map((c) => c.userId));
    for (const r of (data ?? []) as { user_id: string; postcode_area: string }[]) contexts.find((c) => c.userId === r.user_id)?.savedAreas.push(r.postcode_area.toUpperCase());
  }
  const plans = await todayPlans(admin, contexts, now, { create: !opts.dry, concurrency: 6 });
  const base = siteUrl();
  const wouldEmail: Record<string, unknown>[] = [];

  await mapLimit(open, 4, async (p) => {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      perUser.push({ user: p.id, sent: false, reason: 'out_of_time' });
      return;
    }
    const paid = paidOf(p);
    const visibility = paid ? PAID_VISIBILITY : freeVisibility;
    const plan = wantsTeasers(p) ? plans.get(p.id) ?? null : null;
    const teasers = plan ? teasersFrom(plan, null, visibility) : [];
    const changes = alertsOn.has(p.id) ? pending.get(p.id)?.changes ?? [] : [];
    const kind = teasers.length > 0 ? 'todays_5' : 'deal_changes';
    const token = newSendToken();
    const unsubscribeUrl = `${base.replace(/\/$/, '')}/api/notify/unsubscribe/${token}`;
    const built = buildDaily({
      siteUrl: base,
      now,
      pick: null,
      teasers,
      advice: plan?.nearMiss ? plan.advice : null,
      changes,
      freeCutoffIso: paid ? null : freeVisibility.cutoffIso,
      unsubscribe: { label: kind === 'todays_5' ? 'Stop daily picks' : 'Stop these emails', url: unsubscribeUrl, oneClickUrl: unsubscribeUrl },
    });
    if (!built) {
      perUser.push({ user: p.id, sent: false, reason: 'nothing_to_say' });
      return;
    }
    const sendSummary = { teasers: built.teaserIds, alerts: built.changeIds, droppedTeasers: built.droppedTeasers, subject: built.message.subject };
    if (opts.dry) {
      wouldEmail.push({ user: p.id, email: p.email, kind: built.message.kind, tier: paid ? 'paid' : 'free', ...sendSummary, today: plan ? 'stored' : wantsTeasers(p) ? 'chosen_at_send' : 'not_wanted', wouldCharge: 0 });
      perUser.push({ user: p.id, sent: false, kind: built.message.kind, reason: 'would_send' });
      return;
    }
    if (!isEmailConfigured()) {
      perUser.push({ user: p.id, sent: false, reason: 'email_not_configured' });
      return;
    }
    const claim = await claimSlot(admin, p.id, built.message.kind === 'todays_5' ? 'todays_5' : 'deal_changes', now);
    if (!claim.ok) {
      perUser.push({ user: p.id, sent: false, reason: claim.reason });
      return;
    }
    if (!(await markSending(admin, claim.id, sendSummary, token))) {
      await releaseClaim(admin, claim.id);
      perUser.push({ user: p.id, sent: false, reason: 'slot_unwritable' });
      return;
    }
    const mail = renderEmail(built.message);
    const res = await sendEmail({ to: p.email!, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers, idempotencyKey: sendKey('daily', p.id, claim.day) });
    await finishSend(admin, claim.id, res.sent, sendSummary, res.sent ? built.changeIds : []);
    if (!res.sent) {
      summary.emailFailures += 1;
      perUser.push({ user: p.id, sent: false, reason: res.reason });
      return;
    }
    summary.emails += 1;
    if (built.message.kind === 'todays_5') summary.todays5 += 1;
    else summary.changesOnly += 1;
    perUser.push({ user: p.id, sent: true, kind: built.message.kind, teasers: built.teaserIds.length, changes: built.changeIds.length });
  });

  const body = { ...summary, ms: elapsed(), members: perUser, ...(opts.dry ? { wouldEmail } : {}) };
  console.log('[digest] run', JSON.stringify({ ...summary, ms: elapsed() }));
  return { status: 200, body };
}
