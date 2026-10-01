import 'server-only';

/**
 * The 08:10 daily digest: the daily email for everyone who has not had one
 * today. It runs after the four picks passes (07:00–07:50), so it only ever
 * fills the day's one slot when they did not; the picks-paused letter (08:20)
 * comes after it (Batch 21, Q2), so a member at £0 gets this email (their
 * Today's 5, uncharged, with the pack or the £5 decision at its top) and the
 * letter only when there was nothing to send them:
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
import { tailoringForSeats } from '../tailoring/server';
import type { TailoringProfile } from '../tailoring/profile';
import { wantsActFast } from '../tailoring/about-prompts';
import { sendParts } from '../tailoring/email-answers';
import { memberFinance } from '../marketplace/most-you-can-pay';
import { sendEmail, isEmailConfigured } from '../email/send';
import { siteUrl } from '../url';
import { buildDaily } from './message';
import { renderEmail } from './render-email';
import { abandonSend, claimSlot, finishSend, markSending, releaseClaim, slotsInUse } from './sends';
import { capDay, newSendToken, sendKey } from './cap';
import { dayChargeDue, freeTeasersFor } from './daily-charge';
import { pendingChanges, trackedAlertsOn } from './alerts-server';
import { closingIds } from './alerts';
import { mapLimit, planKey, teasersFrom, todayPlans } from './daily-server';
import { getBalance } from '../credit/ledger';
import { dailyDealsMode, PayerPurse } from '../listing/daily-deals';
import { chargeDailyDeals, payersForCharging } from '../listing/daily-deals-server';
import { rangeLineFor } from '../project/display';
import { profileNudgesFor } from '../profile/server';
import { mandatoryIncompleteFor } from '../profile/mandatory-server';
import { lowCreditNoticesFor, markLowCreditTold, sendLowCreditAlone } from '../credit/low-credit-server';
import { lowCreditSection } from '../credit/low-credit';
import { inactivePausedIds } from '../inactivity/server';
import { allProfilesFor } from '../profiles/server';
import { labelFor, profileLinks, seatsFor, type Seat } from '../profiles/rules';
import { GOALS_EDITOR_HREF } from '../nav';
import type { ProfileDeals } from './message';
import type { MarketGoals } from '../market/goals';

const TIME_BUDGET_MS = 50_000;
const PAGE = 1000;
const ID_CHUNK = 150;
/** Batch 21 (D2): Resend allows two requests a second; four senders at once drew 429s. */
const SEND_CONCURRENCY = 2;

/**
 * Batch 21 (D3): a member's place in today's order, a stable hash of id and
 * day (as deal-alerts rotates), so the members cut when the run is out of
 * time are different ones each day, never the same highest-sorting ids.
 */
function rotation(id: string, day: string): number {
  let h = 2166136261;
  for (const ch of `${day}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

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
  const summary = { dry: opts.dry, considered: ids.length, emails: 0, emailFailures: 0, todays5: 0, changesOnly: 0, ranOutOfTime: false, outOfTime: 0, chargeMode: 'per_pick' as 'per_pick' | 'per_day', chargedBasePence: 0, noCreditForTodays5: 0, freeTodays5: 0, profileIncomplete: 0 };
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
  // Batch 21 (D3): in today's rotation, not id order, so a run out of time cuts different members each day.
  const day = capDay(now);
  open.sort((a, b) => rotation(a.id, day) - rotation(b.id, day));
  for (const p of byId.values()) {
    if (!p.email) perUser.push({ user: p.id, sent: false, reason: 'no_email' });
    else if (slots?.has(p.id)) perUser.push({ user: p.id, sent: false, reason: 'slot_used' });
    else if (seatSuspended(p)) perUser.push({ user: p.id, sent: false, reason: 'seat_suspended' });
  }
  // Batch 20, Part C: a member whose picks are paused for inactivity gets no Today's 5 (it would send, and
  // charge for, the very deals the pause stopped); their changes on tracked deals still go.
  const inactive = await inactivePausedIds(admin);
  const wantsTeasers = (p: ProfileRow) => p.sourcing_alerts === true && p.welcome_checked_at !== null && !isPaused(p) && !inactive.has(p.id);
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
  // Each seat's tailoring (Batch 14), from the loader the Today page uses. A
  // failed read leaves every seat untailored: chosen exactly as before.
  const tailoringBySeat = await tailoringForSeats(
    admin,
    [...seatsOf.values()].flatMap((list) => list.map((x) => ({ userId: x.userId, profile: x.profile, goals: x.goals, savedAreas: x.context.savedAreas }))),
    now,
  ).catch((err) => {
    console.error('[digest] tailoring read failed:', (err as Error)?.message ?? err);
    return new Map<string, TailoringProfile>();
  });
  for (const list of seatsOf.values()) for (const x of list) x.context.tailoring = tailoringBySeat.get(x.key) ?? null;
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
  // Batch 21 (B49, Q16): a member who has not answered the mandatory questions
  // is not charged for a day of deals they have not described: their email
  // goes uncharged, with the profile line, until they do. Only members who pay
  // for themselves (a team member is never asked). Unreadable: nobody is held.
  const incomplete = (await mandatoryIncompleteFor(admin, open.filter((p) => (payers.get(p.id)?.payerId ?? p.id) === p.id).map((p) => p.id))) ?? new Set<string>();
  summary.profileIncomplete = incomplete.size;
  const noCredit = new Set<string>();
  // Batch 21 (B6, Q2): a member none of whose profiles the payer could fund
  // still gets their Today's 5, uncharged (the teasers carry no address), with
  // the pack or the £5 decision at its top when that is due; the day is
  // charged only when the credit is there. A member funded in part keeps the
  // funded profiles and is told which were left out, as before.
  const freeTeasers = new Set<string>();
  if (mode === 'per_day') {
    const wanting = open.filter((p) => !isAdmin(p) && !incomplete.has(p.id) && (seatsOf.get(p.id) ?? []).some((seat) => (teasersOf.get(seat.key)?.length ?? 0) > 0));
    const payerIds = [...new Set(wanting.map((p) => payers.get(p.id)?.payerId ?? p.id))];
    const spendable = new Map<string, number | null>();
    for (let i = 0; i < payerIds.length; i += 10) {
      const some = payerIds.slice(i, i + 10);
      const balances = await Promise.all(some.map((id) => getBalance(id).catch(() => null)));
      some.forEach((id, j) => spendable.set(id, balances[j]?.spendableBasePence ?? null));
    }
    const purse = new PayerPurse(spendable);
    for (const p of wanting) {
      const seats = (seatsOf.get(p.id) ?? []).filter((seat) => (teasersOf.get(seat.key)?.length ?? 0) > 0);
      for (const seat of seats) if (!purse.take(payers.get(p.id)?.payerId ?? p.id, dailyPence)) noCredit.add(seat.key);
      if (freeTeasersFor(seats.map((seat) => ({ funded: !noCredit.has(seat.key) })))) freeTeasers.add(p.id);
    }
    summary.noCreditForTodays5 = noCredit.size;
    summary.freeTodays5 = freeTeasers.size;
  }
  const wouldEmail: Record<string, unknown>[] = [];
  // Batch 12: "Your profile is 60% done" for anyone whose profile is not
  // complete. Team members are never asked, so never nudged.
  const nudges = await profileNudgesFor(admin, open.filter((p) => (payers.get(p.id)?.payerId ?? p.id) === p.id).map((p) => p.id));
  const profileUrl = `${base.replace(/\/$/, '')}/profile`;
  // Batch 20, Part B: the £5 low-credit decision, for anyone due it who pays
  // for themselves: at the top of their email, or alone when there is nothing else.
  // Batch 21 (D22): a dry run reads no card from Stripe for them.
  const lowNotices = await lowCreditNoticesFor(admin, open.filter((p) => (payers.get(p.id)?.payerId ?? p.id) === p.id).map((p) => p.id), now, { preview: opts.dry });

  await mapLimit(open, SEND_CONCURRENCY, async (p) => {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      summary.outOfTime += 1;
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
      if (noCredit.has(seat.key) && !freeTeasers.has(p.id)) {
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
          // A near miss's advice, or a tailored day's "only N met your must-haves" (Batch 14).
          advice: plan?.advice ?? null,
          todayUrl: seat.profile ? profileLinks(base, seat.profile, GOALS_EDITOR_HREF).today : undefined,
          // Batch 10: each deal's profit as a range at this profile's finance.
          figureFor: (c) => rangeLineFor(c, memberFinance(seat.goals), settings.dealPricing.profitRangePct),
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
      lowCredit: lowNotices.has(p.id) ? lowCreditSection(lowNotices.get(p.id)!, base) : null,
      // Batch 14: "Yes, more like this" / "Not for me" under each teaser, on this send's own token (Part F),
      // and "Act fast · new today" for a member whose next deal is this month (Part E; About you is the member's, so any seat's).
      answerToken: token,
      actFast: seats.some((seat) => wantsActFast(seat.context.tailoring)),
    });
    // Named for what the email IS, after the early-access backstop has had its
    // say: a Today's 5 whose teasers were all dropped is a changes email, and
    // its link turns off the changes, so it must not say "Stop daily picks".
    if (built?.message.unsubscribe) built.message.unsubscribe = { ...built.message.unsubscribe, label: built.message.kind === 'todays_5' ? 'Stop daily picks' : 'Stop these emails' };
    // A day of daily deals is charged only for a profile's Today's 5 itself, never for changes alone.
    const chargeFor = (i: number) => dayChargeDue({ mode, admin: isAdmin(p), teasers: built?.teasersByPart[i]?.length ?? 0, funded: !noCredit.has(parts[i]?.seat.key ?? ''), mandatoryDone: !incomplete.has(p.id) });
    if (!built) {
      // Batch 20: nothing else today, but the low-credit decision is due: it goes alone, in the same slot.
      const notice = lowNotices.get(p.id);
      if (notice) {
        if (opts.dry) {
          wouldEmail.push({ user: p.id, email: p.email, kind: 'low_credit', lowCredit: notice.kind });
          perUser.push({ user: p.id, sent: false, kind: 'low_credit', reason: 'would_send' });
          return;
        }
        const r = await sendLowCreditAlone(admin, { userId: p.id, email: p.email!, notice, now });
        if (r === 'sent') summary.emails += 1;
        else if (r === 'failed') summary.emailFailures += 1;
        perUser.push({ user: p.id, sent: r === 'sent', kind: 'low_credit', ...(r === 'sent' ? {} : { reason: r }) });
        return;
      }
      perUser.push({ user: p.id, sent: false, reason: 'nothing_to_say' });
      return;
    }
    // `parts` (Batch 14): which profile each teaser was sent for, so an answer from the email lands on it.
    const sendSummary = { teasers: built.teaserIds, parts: sendParts(parts.map((x) => x.seat.profile?.id ?? null), built.teasersByPart), alerts: built.changeIds, droppedTeasers: built.droppedTeasers, subject: built.message.subject };
    if (opts.dry) {
      wouldEmail.push({
        user: p.id,
        email: p.email,
        kind: built.message.kind,
        tier: paid ? 'paid' : 'free',
        ...sendSummary,
        today: !wantsTeasers(p) ? 'not_wanted' : seats.length === 0 ? 'profiles_paused' : parts.length > 0 ? 'stored' : unfunded.length > 0 ? 'no_credit' : 'chosen_at_send',
        profiles: parts.map((x, i) => ({ profile: x.seat.profile?.id ?? null, teasers: built.teasersByPart[i]?.length ?? 0, advice: x.deals.advice ?? null, wouldCharge: chargeFor(i) ? dailyPence : 0 })),
        // Batch 14: every teaser carries "Yes, more like this" / "Not for me" on this send's token; "Act fast" titles.
        answerLinks: built.teaserIds.length,
        actFast: seats.some((seat) => wantsActFast(seat.context.tailoring)),
        unfunded: unfunded.length,
        // Batch 21: why the day is not charged, when it is not.
        free: freeTeasers.has(p.id) ? 'no_credit' : incomplete.has(p.id) ? 'profile_incomplete' : null,
        payer: payers.get(p.id)?.payerId ?? p.id,
        lowCredit: lowNotices.get(p.id)?.kind ?? null,
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
    if (!res.sent) {
      // Batch 21 (D5, D15): the slot goes back, so a later send today can still use it under the same key.
      await abandonSend(admin, claim.id);
      summary.emailFailures += 1;
      perUser.push({ user: p.id, sent: false, reason: res.reason });
      return;
    }
    // Sent: close what it told, what it would not tell and what settling dismissed.
    await finishSend(admin, claim.id, true, sendSummary, closingIds(built, alertsOn.has(p.id) ? pending.get(p.id) : null));
    summary.emails += 1;
    // Batch 20: the low-credit decision went with it: once a cycle.
    if (lowNotices.has(p.id)) await markLowCreditTold(admin, p.id, now);
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
  // Batch 21 (D3): a run that cut members is said so in the log, with how many.
  if (summary.ranOutOfTime) console.warn(`[digest] out of time: ${summary.outOfTime} of ${open.length} members not reached`);
  console.log('[digest] run', JSON.stringify({ ...summary, ms: elapsed() }));
  return { status: 200, body };
}
