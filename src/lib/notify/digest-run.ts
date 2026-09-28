import 'server-only';

/**
 * The 08:10 daily digest: the daily email for everyone who has not had one
 * today. It runs after the three picks passes (07:00–07:40) and the
 * picks-paused letter (08:00), so it only ever fills the day's one slot
 * when nothing else did:
 *
 *   picks on, no pick today   Today's 5 without a pick: the rest of the
 *                             member's Today, plus any changes. Not charged
 *                             before billing_settings.new_pricing_from; from
 *                             it, one day of daily deals (Batch 10), and a
 *                             member whose payer cannot cover it gets the
 *                             changes only. (A paused subscription gets the
 *                             changes only.)
 *   picks off                 "Changes on your deals", only on a day with changes.
 *
 * "Changes" follow the "Changes on deals I'm tracking" switch; the teasers
 * follow Daily picks. Nothing goes to anyone whose slot is used, and nothing
 * with no content goes at all. Nothing else here is charged.
 *
 * Saved profiles (Batch 13): the teasers come in a part for each running
 * profile (active first), each its own Today and its own day's charge. When
 * the credit runs out part-way, the later profiles are left out and named;
 * a member whose profiles are all paused gets their changes only.
 *
 * Entry point: /api/internal/daily-digest (the cron, secret-gated, ?dry=1).
 */
import { createAdminClient } from '../supabase/admin';
import { isPaused, hasEverPaid, PAID_TIER_COLUMNS, type PaidTierAccount } from '../access';
import { isAdminEmail } from '../admin';
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
import { closingIds } from './alerts';
import { mapLimit, planKey, teasersFrom, todayPlans } from './daily-server';
import { getBalance } from '../credit/ledger';
import { dailyDealsMode, PayerPurse } from '../listing/daily-deals';
import { chargeDailyDeals, payersForCharging } from '../listing/daily-deals-server';
import { cardRangeLine } from '../marketplace/profit-range';
import { profileNudgesFor } from '../profile/server';
import { allProfilesFor } from '../profiles/server';
import { labelFor, profileLinks, seatsFor, type Seat } from '../profiles/rules';
import { GOALS_EDITOR_HREF } from '../nav';
import type { ProfileDeals } from './message';
import type { MarketGoals } from '../market/goals';

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
  const summary = { dry: opts.dry, considered: ids.length, emails: 0, emailFailures: 0, todays5: 0, changesOnly: 0, ranOutOfTime: false, chargeMode: 'per_pick' as 'per_pick' | 'per_day', chargedBasePence: 0, noCreditForTodays5: 0 };
  const perUser: { user: string; sent: boolean; kind?: string; teasers?: number; changes?: number; reason?: string }[] = [];
  if (ids.length === 0) return { status: 200, body: { ...summary, members: perUser } };

  // ── Whose day is already spent, whose changes are on, what tier each is ──
  const [slots, alertsOn, pending, payers, settings] = await Promise.all([slotsInUse(admin, ids, 'daily', now), trackedAlertsOn(admin, ids), pendingChanges(admin, ids, now), payersForCharging(ids), getBillingSettings()]);
  if (slots === null && !opts.dry) return { status: 503, body: { error: 'notification_sends unreadable (schema behind?); nothing sent' } };
  // Unknown who pays for whom: a team member would be charged on their own balance and a paused seat sent to.
  if (payers === null) return { status: 503, body: { error: 'Team lookup failed; nothing sent or charged' } };
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

  // A team seat the owner has not paid for gets no daily email, as it gets no pick.
  const seatSuspended = (p: ProfileRow) => payers.get(p.id)?.suspended === true;
  // Who gets teasers: picks on, signed in once, not paused, day not spent.
  const open = [...byId.values()].filter((p) => p.email && !(slots?.has(p.id)) && !seatSuspended(p));
  for (const p of byId.values()) {
    if (!p.email) perUser.push({ user: p.id, sent: false, reason: 'no_email' });
    else if (slots?.has(p.id)) perUser.push({ user: p.id, sent: false, reason: 'slot_used' });
    else if (seatSuspended(p)) perUser.push({ user: p.id, sent: false, reason: 'seat_suspended' });
  }
  const wantsTeasers = (p: ProfileRow) => p.sourcing_alerts === true && p.welcome_checked_at !== null && !isPaused(p);
  // A seat for each running profile (Batch 13); unreadable profiles (schema
  // not run): every member is one seat, as before.
  const profileRows = await allProfilesFor(admin, open.map((p) => p.id));
  const savedAreas = new Map<string, string[]>();
  // Saved areas feed Today's choice exactly as the page reads them (a seat with no profile).
  const needAreas = open.filter((p) => wantsTeasers(p) && !profileRows?.get(p.id)?.length).map((p) => p.id);
  for (let i = 0; i < needAreas.length; i += ID_CHUNK) {
    const { data } = await admin.from('saved_areas').select('user_id, postcode_area').in('user_id', needAreas.slice(i, i + ID_CHUNK));
    for (const r of (data ?? []) as { user_id: string; postcode_area: string }[]) savedAreas.set(r.user_id, [...(savedAreas.get(r.user_id) ?? []), r.postcode_area.toUpperCase()]);
  }
  type DigestSeat = Seat & { context: MemberContext; goals: MarketGoals | null };
  const seatsOf = new Map<string, DigestSeat[]>();
  for (const p of open.filter(wantsTeasers)) {
    const payerId = payers.get(p.id)?.payerId ?? p.id;
    const visibility = paidOf(p) ? PAID_VISIBILITY : freeVisibility;
    seatsOf.set(
      p.id,
      seatsFor(p.id, profileRows?.get(p.id)).seats.map((seat) => {
        const goals = seat.profile ? seat.profile.goals : parseMarketGoals(p.market_goals);
        return { ...seat, goals, context: { userId: p.id, payerId, goals, savedAreas: seat.profile ? seat.profile.areas : savedAreas.get(p.id) ?? [], visibility, profileId: seat.profile?.id ?? null, profileActive: seat.profile?.isActive ?? false } };
      }),
    );
  }
  const contexts: MemberContext[] = [...seatsOf.values()].flatMap((list) => list.map((x) => x.context));
  const plans = await todayPlans(admin, contexts, now, { create: !opts.dry, concurrency: 6 });
  const base = siteUrl();

  // ── From the new pricing date Today's 5 is charged by the day (Batch 10) ──
  // Only members whose payer can cover the day get it; each payer's balance
  // is spent in order across everyone it pays for, so a team cannot between
  // them overdraw its owner. The rest get their changes only.
  const mode = dailyDealsMode(settings.dealPricing, now);
  const dailyPence = settings.dealPricing.todays5DailyPence;
  summary.chargeMode = mode;
  const isAdmin = (p: ProfileRow) => Boolean(p.email && isAdminEmail(p.email));
  // Each seat's teasers, decided before any send so the purse can be spent in
  // order: a member's profiles in charge order, the ones the credit cannot
  // cover left out (and named in the email).
  const teasersOf = new Map<string, ReturnType<typeof teasersFrom>>();
  for (const p of open) {
    const visibility = paidOf(p) ? PAID_VISIBILITY : freeVisibility;
    for (const seat of seatsOf.get(p.id) ?? []) {
      const plan = plans.get(planKey(seat.context)) ?? null;
      teasersOf.set(seat.key, plan ? teasersFrom(plan, null, visibility) : []);
    }
  }
  const noCredit = new Set<string>();
  if (mode === 'per_day') {
    const wanting = open.filter((p) => !isAdmin(p) && (seatsOf.get(p.id) ?? []).some((seat) => (teasersOf.get(seat.key)?.length ?? 0) > 0));
    const payerIds = [...new Set(wanting.map((p) => payers.get(p.id)?.payerId ?? p.id))];
    const spendable = new Map<string, number | null>();
    for (let i = 0; i < payerIds.length; i += 10) {
      const some = payerIds.slice(i, i + 10);
      const balances = await Promise.all(some.map((id) => getBalance(id).catch(() => null)));
      some.forEach((id, j) => spendable.set(id, balances[j]?.spendableBasePence ?? null));
    }
    const purse = new PayerPurse(spendable);
    for (const p of wanting) {
      for (const seat of seatsOf.get(p.id) ?? []) {
        if ((teasersOf.get(seat.key)?.length ?? 0) === 0) continue;
        if (!purse.take(payers.get(p.id)?.payerId ?? p.id, dailyPence)) noCredit.add(seat.key);
      }
    }
    summary.noCreditForTodays5 = noCredit.size;
  }
  const wouldEmail: Record<string, unknown>[] = [];
  // Batch 12: "Your profile is 60% done" for anyone whose profile is not
  // complete. Team members are never asked, so never nudged.
  const nudges = await profileNudgesFor(admin, open.filter((p) => (payers.get(p.id)?.payerId ?? p.id) === p.id).map((p) => p.id));
  const profileUrl = `${base.replace(/\/$/, '')}/profile`;

  await mapLimit(open, 4, async (p) => {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      perUser.push({ user: p.id, sent: false, reason: 'out_of_time' });
      return;
    }
    const paid = paidOf(p);
    const seats = wantsTeasers(p) ? seatsOf.get(p.id) ?? [] : [];
    const parts: { seat: DigestSeat; deals: ProfileDeals }[] = [];
    const unfunded: string[] = [];
    for (const seat of seats) {
      const teasers = teasersOf.get(seat.key) ?? [];
      if (teasers.length === 0) continue;
      if (noCredit.has(seat.key)) {
        if (seat.heading) unfunded.push(seat.heading);
        continue;
      }
      const plan = plans.get(planKey(seat.context)) ?? null;
      parts.push({
        seat,
        deals: {
          heading: seat.heading,
          pick: null,
          teasers,
          advice: plan?.nearMiss ? plan.advice : null,
          todayUrl: seat.profile ? profileLinks(base, seat.profile, GOALS_EDITOR_HREF).today : undefined,
          // Batch 10: each deal's profit as a range at this profile's finance.
          figureFor: (c) => cardRangeLine(c, seat.goals?.finance ?? null, settings.dealPricing.profitRangePct),
        },
      });
    }
    // Each change names its profile once the member has two.
    const changes = (alertsOn.has(p.id) ? pending.get(p.id)?.changes ?? [] : []).map((c) => ({ ...c, profileName: labelFor(profileRows?.get(p.id), c.profileId) }));
    const token = newSendToken();
    const unsubscribeUrl = `${base.replace(/\/$/, '')}/api/notify/unsubscribe/${token}`;
    const built = buildDaily({
      siteUrl: base,
      now,
      pick: null,
      teasers: [],
      profiles: parts.map((x) => x.deals),
      unfunded,
      changes,
      freeCutoffIso: paid ? null : freeVisibility.cutoffIso,
      // The label is settled below, from what the email turned out to be.
      unsubscribe: { label: 'Stop these emails', url: unsubscribeUrl, oneClickUrl: unsubscribeUrl },
      profileNudge: nudges.has(p.id) ? { percent: nudges.get(p.id)!, url: profileUrl, pence: settings.profileCompletePence } : null,
    });
    // Named for what the email IS, after the early-access backstop has had its
    // say: a Today's 5 whose teasers were all dropped is a changes email, and
    // its link turns off the changes, so it must not say "Stop daily picks".
    if (built?.message.unsubscribe) built.message.unsubscribe = { ...built.message.unsubscribe, label: built.message.kind === 'todays_5' ? 'Stop daily picks' : 'Stop these emails' };
    // A day of daily deals is charged only for a profile's Today's 5 itself, never for changes alone.
    const chargeFor = (i: number) => mode === 'per_day' && !isAdmin(p) && (built?.teasersByPart[i]?.length ?? 0) > 0;
    if (!built) {
      perUser.push({ user: p.id, sent: false, reason: 'nothing_to_say' });
      return;
    }
    const sendSummary = { teasers: built.teaserIds, alerts: built.changeIds, droppedTeasers: built.droppedTeasers, subject: built.message.subject };
    if (opts.dry) {
      wouldEmail.push({
        user: p.id,
        email: p.email,
        kind: built.message.kind,
        tier: paid ? 'paid' : 'free',
        ...sendSummary,
        today: !wantsTeasers(p) ? 'not_wanted' : seats.length === 0 ? 'profiles_paused' : parts.length > 0 ? 'stored' : unfunded.length > 0 ? 'no_credit' : 'chosen_at_send',
        profiles: parts.map((x, i) => ({ profile: x.seat.profile?.id ?? null, teasers: built.teasersByPart[i]?.length ?? 0, wouldCharge: chargeFor(i) ? dailyPence : 0 })),
        unfunded: unfunded.length,
        payer: payers.get(p.id)?.payerId ?? p.id,
      });
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
    // Sent: close what it told, what it would not tell and what settling dismissed. Failed: close nothing.
    await finishSend(admin, claim.id, res.sent, sendSummary, res.sent ? closingIds(built, alertsOn.has(p.id) ? pending.get(p.id) : null) : []);
    if (!res.sent) {
      summary.emailFailures += 1;
      perUser.push({ user: p.id, sent: false, reason: res.reason });
      return;
    }
    summary.emails += 1;
    if (built.message.kind === 'todays_5') summary.todays5 += 1;
    else summary.changesOnly += 1;
    for (const [i, part] of parts.entries()) {
      if (!chargeFor(i)) continue;
      const payer = payers.get(p.id);
      const profile = part.seat.profile;
      const day = await chargeDailyDeals(admin, { userId: p.id, payerId: payer?.payerId ?? p.id, memberId: payer?.memberId ?? null, day: claim.day, pence: dailyPence, run: 'digest', sendRef: token, profile: profile ? { id: profile.id, active: profile.isActive } : null });
      if (day.charged) summary.chargedBasePence += dailyPence;
    }
    perUser.push({ user: p.id, sent: true, kind: built.message.kind, teasers: built.teaserIds.length, changes: built.changeIds.length });
  });

  const body = { ...summary, ms: elapsed(), members: perUser, ...(opts.dry ? { wouldEmail } : {}) };
  console.log('[digest] run', JSON.stringify({ ...summary, ms: elapsed() }));
  return { status: 200, body };
}
