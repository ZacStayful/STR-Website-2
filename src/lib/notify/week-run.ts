import 'server-only';

/**
 * "Your week" (Monday 08:00, /api/internal/alerts): the run. What each
 * section says is decided in ./week.ts; this reads, claims the weekly slot,
 * sends, and records.
 *
 * Kept from the area digest it replaces:
 *   - the first run after saving an area only records a baseline (no email),
 *   - an area's state is recorded only when the member was told (the email
 *     went) or there was nothing to tell; a failed send records nothing, so
 *     the change is told next week instead of being lost.
 * New:
 *   - "since" is the member's last SENT Your week (at most 14 days back), so
 *     a Monday that failed is covered by the next one, not skipped.
 *   - the email takes the Monday "weekly" slot (src/lib/notify/cap.ts); a
 *     second run the same day finds it taken and sends nothing.
 *   - each section follows its own switch; all off or nothing to say = no email.
 * Saved profiles (Batch 13):
 *   - "Deals you missed" is one part per running profile, each deal counted
 *     once (under the first profile it matched, active first);
 *   - recap lines name the profile a deal is tracked under, once the member
 *     has two; "Your areas" stays the active profile's (saved_areas).
 */
import { createAdminClient } from '../supabase/admin';
import { getAreaCards } from '../market/cached';
import { areaTrend, type AreaTrend } from '../market/trend';
import { digestChanges, type SavedAreaState } from '../market/alerts';
import { parseMarketGoals } from '../market/goals';
import { hasEverPaid, PAID_TIER_COLUMNS, type PaidTierAccount } from '../access';
import { isAdminEmail } from '../admin';
import { getBillingSettings } from '../credit/unit-costs';
import { filtersForType } from '../today/type-filters';
import { typesShown } from '../profile/deal-types';
import { parseAboutYou } from '../profile/about';
import { isMissingProjectColumn } from '../marketplace/queries';
import type { MarketGoals } from '../market/goals';
import { parseHistory } from '../listing/recheck';
import { sendEmail, isEmailConfigured } from '../email/send';
import { siteUrl } from '../url';
import { renderEmail } from './render-email';
import { claimSlot, finishSend, markSending, releaseClaim } from './sends';
import { newSendToken, sendKey, slotAllowed } from './cap';
import { mapLimit, payersForAll } from './daily-server';
import { trackedLink, trackedPlace, trackingFor } from './tracked-read';
import { buildYourWeek, missedByProfile, missedFor, missedTotal, recapItems, WENT_REASONS, type ProfileMissed, type RecapSource, type WentDeal } from './week';
import { allProfilesFor } from '../profiles/server';
import { labelFor, labelsShown, profileLinks, seatsFor, type SavedProfile } from '../profiles/rules';
import { profileTagsFor } from '../profiles/deal-tags';
import { GOALS_EDITOR_HREF } from '../nav';
import { cardRangeLine } from '../marketplace/profit-range';
import { memberFinance } from '../marketplace/most-you-can-pay';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 14 * DAY_MS;
const DEFAULT_WINDOW_MS = 7 * DAY_MS;
const TIME_BUDGET_MS = 50_000;
const ID_CHUNK = 150;
const PAGE = 1000;

type ProfileRow = PaidTierAccount & {
  id: string;
  email: string | null;
  market_goals: unknown;
  /** Batch 17: the roles ticked, for a profile not yet on deal types. */
  about_you?: unknown;
  alert_weekly: boolean | null;
  alert_missed?: boolean | null;
  alert_tracked?: boolean | null;
};

type SavedRow = SavedAreaState & { user_id: string };

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
}

function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function runYourWeek(opts: { dry: boolean; onlyUserIds?: string[] }): Promise<RunResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const now = new Date();
  // A manual run on any other day sends nothing: the weekly slot is Monday's.
  if (!opts.dry && !slotAllowed('weekly', now)) return { status: 200, body: { skipped: 'not_monday', dry: false } };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }

  // ── Members: every profile with an email. The new switches read as off if the schema is behind. ──
  const profiles: ProfileRow[] = [];
  let newSwitches = true;
  for (let from = 0; ; from += PAGE) {
    const run = (cols: string) => {
      let q = admin.from('profiles').select(cols).not('email', 'is', null);
      if (opts.onlyUserIds) q = q.in('id', opts.onlyUserIds);
      return q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    };
    let res = await run(`id, email, market_goals, about_you, alert_weekly, alert_missed, alert_tracked, ${PAID_TIER_COLUMNS}`);
    if (res.error && newSwitches) {
      console.warn('[your-week] new switch columns unreadable (schema behind?); sections 1 and 2 off:', res.error.message);
      newSwitches = false;
      res = await run(`id, email, market_goals, about_you, alert_weekly, ${PAID_TIER_COLUMNS}`);
    }
    if (res.error) return { status: 500, body: { error: `profiles read failed: ${res.error.message}` } };
    profiles.push(...((res.data ?? []) as unknown as ProfileRow[]));
    if ((res.data?.length ?? 0) < PAGE) break;
  }
  const ids = profiles.map((p) => p.id);
  const on = (v: boolean | null | undefined) => v !== false;

  // ── Section 3's inputs: saved areas and the market snapshot ──
  const saved = new Map<string, SavedRow[]>();
  for (const some of chunks(ids)) {
    const { data, error } = await admin.from('saved_areas').select('user_id, postcode_area, last_alerted_direction, last_alerted_tier').in('user_id', some);
    if (error) console.error('[your-week] saved_areas read failed:', error.message);
    for (const r of (data ?? []) as SavedRow[]) saved.set(r.user_id, [...(saved.get(r.user_id) ?? []), r]);
  }
  const cards = await getAreaCards();
  // Without the snapshot an area's change cannot be judged: skip the areas
  // for everyone and record nothing, rather than a baseline of "insufficient".
  const areasReadable = cards.length > 0;
  const cardByCode = new Map(cards.map((c) => [c.code, c]));
  const trendByCode = new Map<string, AreaTrend | null>(cards.map((c) => [c.code, areaTrend(c.series)]));

  // ── Since when: each member's last sent Your week, at most 14 days back ──
  const lastSent = new Map<string, number>();
  for (const some of chunks(ids)) {
    const { data, error } = await admin.from('notification_sends').select('user_id, sent_at').in('user_id', some).eq('slot', 'weekly').eq('status', 'sent');
    if (error) {
      console.warn('[your-week] last sends unreadable (schema behind?):', error.message);
      break;
    }
    for (const r of (data ?? []) as { user_id: string; sent_at: string | null }[]) {
      const t = r.sent_at ? Date.parse(r.sent_at) : NaN;
      if (Number.isFinite(t) && t > (lastSent.get(r.user_id) ?? 0)) lastSent.set(r.user_id, t);
    }
  }
  const sinceOf = (userId: string) => new Date(Math.max(lastSent.get(userId) ?? now.getTime() - DEFAULT_WINDOW_MS, now.getTime() - MAX_WINDOW_MS)).toISOString();

  // ── Section 1's inputs: every deal that went in the window, and who has seen which ──
  const went: WentDeal[] = [];
  {
    const earliest = new Date(now.getTime() - MAX_WINDOW_MS).toISOString();
    // Batch 17: a Project deal's numbers tell its type; without the column yet, every sale is Short-let.
    let withProject = true;
    for (let from = 0; ; from += PAGE) {
      const read = () =>
        admin
          .from('marketplace_deals')
          .select(`id, kind, postcode_area, town, bedrooms, price_amount, price_period, raw_type, tenure, annual_profit, uplift_pct, listed_date, first_seen_at, live_since, retired_reason, retired_at, screening_gross:screening->grossRevenue->>value, screening_confidence:screening->>confidence${withProject ? ', project' : ''}`)
          .eq('status', 'retired')
          .in('retired_reason', [...WENT_REASONS])
          .gte('retired_at', earliest)
          .order('retired_at', { ascending: true })
          .range(from, from + PAGE - 1);
      let { data, error } = await read();
      if (error && withProject && isMissingProjectColumn(error)) {
        withProject = false;
        ({ data, error } = await read());
      }
      if (error) {
        console.error('[your-week] went deals read failed:', error.message);
        break;
      }
      went.push(...((data ?? []) as unknown as WentDeal[]));
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  const wentIds = went.map((d) => d.id);
  const payers = await payersForAll(ids);
  const seen = new Map<string, Set<string>>();
  const see = (userId: string, dealId: string) => seen.set(userId, new Set([...(seen.get(userId) ?? []), dealId]));
  if (wentIds.length > 0) {
    const payerIds = [...new Set(ids.map((id) => payers.get(id)?.payerId ?? id))];
    const membersOf = new Map<string, string[]>();
    for (const id of ids) {
      const payerId = payers.get(id)?.payerId ?? id;
      membersOf.set(payerId, [...(membersOf.get(payerId) ?? []), id]);
    }
    for (const dealSome of chunks(wentIds)) {
      for (const some of chunks(payerIds)) {
        // Opens are the team's (the owner paid): opened for one is opened for all.
        const { data } = await admin.from('deal_opens').select('user_id, deal_id').in('user_id', some).in('deal_id', dealSome).eq('status', 'open');
        for (const r of (data ?? []) as { user_id: string; deal_id: string }[]) for (const m of membersOf.get(r.user_id) ?? []) see(m, r.deal_id);
      }
      for (const some of chunks(ids)) {
        const [reactions, picks] = await Promise.all([
          admin.from('deal_reactions').select('user_id, deal_id').in('user_id', some).in('deal_id', dealSome),
          admin.from('sourcing_sent').select('user_id, deal_id').in('user_id', some).in('deal_id', dealSome),
        ]);
        for (const r of (reactions.data ?? []) as { user_id: string; deal_id: string }[]) see(r.user_id, r.deal_id);
        for (const r of (picks.data ?? []) as { user_id: string; deal_id: string }[]) see(r.user_id, r.deal_id);
      }
    }
  }

  // ── Tier: a team member takes the owner's ──
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const owners = new Map<string, PaidTierAccount>();
  const ownerIds = [...new Set([...payers.values()].map((p) => p.payerId))].filter((id) => !byId.has(id));
  for (const some of chunks(ownerIds)) {
    const { data } = await admin.from('profiles').select(`id, ${PAID_TIER_COLUMNS}`).in('id', some);
    for (const r of (data ?? []) as unknown as (PaidTierAccount & { id: string })[]) owners.set(r.id, r);
  }
  const settings = await getBillingSettings();
  const rangeWidths = settings.dealPricing.profitRangePct;
  const paidOf = (p: ProfileRow) => (p.email && isAdminEmail(p.email) ? true : hasEverPaid(byId.get(payers.get(p.id)?.payerId ?? p.id) ?? owners.get(payers.get(p.id)?.payerId ?? p.id) ?? null));

  // Every profile row (Batch 13); unreadable (schema not run): one profile each, as before.
  const profileRows = await allProfilesFor(admin, ids);

  // Batch 17: a profile's searches, one per deal type it is shown, each on its own money answer.
  const searchesFor = (goals: MarketGoals | null, areas: readonly string[], p: ProfileRow) => typesShown({ goals, about: parseAboutYou(p.about_you) }).map((t) => filtersForType(goals, areas, t));

  // ── Per member: decide each section ──
  type Plan = { p: ProfileRow; since: string; missed: ReturnType<typeof missedFor> | null; byProfile: ProfileMissed[] | null; profileOf: Map<string, SavedProfile>; areas: ReturnType<typeof digestChanges> | null; rows: SavedRow[]; free: number | null };
  const plans: Plan[] = profiles.map((p) => {
    const since = sinceOf(p.id);
    const rows = saved.get(p.id) ?? [];
    const free = paidOf(p) ? null : settings.freeDealDelayHours;
    const wantMissed = newSwitches && on(p.alert_missed);
    const seats = seatsFor(p.id, profileRows?.get(p.id)).seats;
    const profileOf = new Map<string, SavedProfile>();
    let missed: Plan['missed'] = null;
    let byProfile: Plan['byProfile'] = null;
    if (wantMissed && seats.some((s) => s.profile)) {
      // One part per running profile with answers; no answers, no honest "matching you" (Q10).
      const withGoals = seats.filter((s) => s.profile?.goals);
      for (const s of withGoals) if (s.heading) profileOf.set(s.heading, s.profile!);
      byProfile = missedByProfile(
        withGoals.map((s) => ({ heading: s.heading, filters: searchesFor(s.profile!.goals, s.profile!.areas, p), figureFor: (d: WentDeal) => cardRangeLine(d, memberFinance(s.profile!.goals), rangeWidths) })),
        { deals: went, seen: seen.get(p.id) ?? new Set(), since, freeDelayHours: free },
      );
      missed = missedTotal(byProfile);
    } else if (wantMissed && seats.length > 0) {
      const goals = parseMarketGoals(p.market_goals);
      // No goals, no honest "matching you" (Q10).
      missed = goals ? missedFor({ deals: went, filters: searchesFor(goals, rows.map((r) => r.postcode_area), p), seen: seen.get(p.id) ?? new Set(), since, freeDelayHours: free }) : null;
    }
    const areas = on(p.alert_weekly) && areasReadable && rows.length > 0 ? digestChanges(rows, cardByCode, trendByCode) : null;
    return { p, since, missed, byProfile, profileOf, areas, rows, free };
  });
  // The recap only rides along, so only members with another section need their tracked deals read.
  // Not for a suspended seat: the loop skips them, so reading their deals is wasted time.
  const needRecap = plans.filter((pl) => newSwitches && on(pl.p.alert_tracked) && !payers.get(pl.p.id)?.suspended && ((pl.missed?.total ?? 0) > 0 || (pl.areas?.length ?? 0) > 0));
  const tracking = await trackingFor(admin, needRecap.map((pl) => ({ id: pl.p.id, admin: Boolean(pl.p.email && isAdminEmail(pl.p.email)) })));
  // Which profile each tracked deal is under, only for members whose emails name profiles.
  const recapTags = new Map<string, Map<string, string>>();
  for (const pl of needRecap) {
    const t = tracking.get(pl.p.id);
    if (!t || !labelsShown(profileRows?.get(pl.p.id) ?? [])) continue;
    recapTags.set(pl.p.id, await profileTagsFor(pl.p.id, payers.get(pl.p.id)?.payerId ?? pl.p.id, t.load.view));
  }

  const base = siteUrl();
  const nowIso = now.toISOString();
  const summary = { dry: opts.dry, members: profiles.length, emails: 0, emailFailures: 0, recorded: 0, went: went.length, ranOutOfTime: false };
  const perUser: Record<string, unknown>[] = [];
  const toRecord: { user_id: string; postcode_area: string; last_alerted_direction: string; last_alerted_tier: string; last_alerted_at: string }[] = [];
  const record = (userId: string, rows: SavedRow[]) => {
    for (const r of rows) {
      const card = cardByCode.get(r.postcode_area);
      if (!card) continue;
      const dir = trendByCode.get(r.postcode_area)?.enquiries.direction ?? 'insufficient';
      // A direction that dropped to "insufficient" never overwrites a real one.
      const direction = dir === 'insufficient' && r.last_alerted_direction ? r.last_alerted_direction : dir;
      toRecord.push({ user_id: userId, postcode_area: r.postcode_area, last_alerted_direction: direction, last_alerted_tier: card.confidence.tier, last_alerted_at: nowIso });
    }
  };

  await mapLimit(plans, 4, async (pl) => {
    const { p } = pl;
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      perUser.push({ user: p.id, sent: false, reason: 'out_of_time' });
      return;
    }
    // A team seat the owner has not paid for gets no "Your week", as it gets no pick.
    if (payers.get(p.id)?.suspended) {
      perUser.push({ user: p.id, sent: false, reason: 'seat_suspended' });
      return;
    }
    const t = tracking.get(p.id);
    const recap = t
      ? recapItems(
          t.load.view.map((v): RecapSource => {
            const card = v.dealId ? t.load.cards.get(v.dealId) : undefined;
            return {
              place: trackedPlace(t, v),
              stage: v.stage,
              link: trackedLink(v, base),
              pipelineHistory: v.checkedListingId ? t.pipelineHistory.get(v.checkedListingId) ?? null : null,
              dealHistory: card ? parseHistory(card.price_history) : null,
              retired: card?.retired_reason && card.retired_at ? { reason: card.retired_reason, at: card.retired_at } : null,
              revivedAt: v.dealId ? t.revived.get(v.dealId)?.at ?? null : null,
              profileName: labelFor(profileRows?.get(p.id), recapTags.get(p.id)?.get(v.key)),
            };
          }),
          pl.since,
        )
      : null;
    const token = newSendToken();
    const unsubscribeUrl = `${base.replace(/\/$/, '')}/api/notify/unsubscribe/${token}`;
    const built = buildYourWeek({
      siteUrl: base,
      now,
      since: pl.since,
      missed: pl.missed,
      missedByProfile: pl.byProfile,
      // A profile's "Open Today" goes through the switch when it is not the active one.
      todayUrlFor: (heading) => {
        const profile = heading ? pl.profileOf.get(heading) : undefined;
        return profile ? profileLinks(base, profile, GOALS_EDITOR_HREF).today : undefined;
      },
      freeDelayHours: pl.free,
      recap,
      areas: pl.areas,
      unsubscribe: { label: 'Stop weekly emails', url: unsubscribeUrl, oneClickUrl: unsubscribeUrl },
      figureFor: (d) => cardRangeLine(d, parseMarketGoals(p.market_goals)?.finance ?? null, rangeWidths),
    });
    const areaChanges = pl.areas?.length ?? 0;
    if (!built) {
      // Nothing to say. The areas' state is recorded (the baseline, on a first run).
      if (!opts.dry && pl.areas) record(p.id, pl.rows);
      perUser.push({ user: p.id, sent: false, reason: 'nothing_to_say' });
      return;
    }
    const sendSummary = { since: pl.since, ...built.sections, subject: built.message.subject };
    if (opts.dry) {
      perUser.push({ user: p.id, email: p.email, sent: false, reason: 'would_send', tier: pl.free === null ? 'paid' : 'free', ...sendSummary });
      return;
    }
    if (!isEmailConfigured()) {
      perUser.push({ user: p.id, sent: false, reason: 'email_not_configured' });
      return;
    }
    const claim = await claimSlot(admin, p.id, 'your_week', now);
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
    const res = await sendEmail({ to: p.email!, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers, idempotencyKey: sendKey('weekly', p.id, claim.day) });
    await finishSend(admin, claim.id, res.sent, sendSummary, []);
    // Told, or nothing about the areas to tell: record. A failed send with area changes records nothing.
    if (pl.areas && (res.sent || areaChanges === 0)) record(p.id, pl.rows);
    if (!res.sent) {
      summary.emailFailures += 1;
      perUser.push({ user: p.id, sent: false, reason: res.reason });
      return;
    }
    summary.emails += 1;
    perUser.push({ user: p.id, sent: true, ...built.sections });
  });

  if (toRecord.length > 0) {
    const { error } = await admin.from('saved_areas').upsert(toRecord, { onConflict: 'user_id,postcode_area' });
    if (error) console.error('[your-week] recording state failed:', error.message);
    else summary.recorded = toRecord.length;
  }
  console.log('[your-week] run', JSON.stringify({ ...summary, ms: elapsed() }));
  return { status: 200, body: { ...summary, ms: elapsed(), members: perUser } };
}
