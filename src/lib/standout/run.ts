import 'server-only';

/**
 * Batch 25, Part A: the standout pass (/api/internal/standout, hourly at :35
 * after the recheck, and 06:58 after the morning sweeps and before the 07:00
 * Today lists). Each pass:
 *
 *   1. takes the deals that went live since the last pass (paying members)
 *      and those whose free delay ended since then (free members; a free
 *      member's own search finds count at once), plus any decision waiting
 *      on a live check;
 *   2. judges each against each account owner's PRIMARY profile, for the
 *      deal types it chose, with Today's own judging (rules.ts) — never a
 *      second scoring path;
 *   3. keeps only deals new to the member, confirmed live within the hours
 *      setting (rechecking a few itself), better than anything already shown
 *      or saved to them, and the best of the day;
 *   4. saves each standout to My deals (a Keep marked saved_by
 *      'stayful_intelligence'), once, however often it runs;
 *   5. then tells the member — a call, a text and email, or the next daily
 *      email's "Saved for you" (notify-server.ts) — and sends any
 *      slower-spender nudge that is due (nudge-server.ts).
 *
 * One decision row per (member, deal) that reaches the member's pool, with
 * its reason; one row a day per member-level reason. ?dry=1 (apply false)
 * reads everything, writes nothing, sends nothing and lists every decision.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { allProfilesFor } from '../profiles/server';
import { primaryOf, type SavedProfile } from '../profiles/rules';
import { tailoringForSeats } from '../tailoring/server';
import { judgeRow } from '../tailoring/today';
import { wantsFor } from '../tailoring/criteria';
import { dealTypesFor } from '../profile/deal-types';
import { serverFetchEnabled } from '../listing/fetch';
import { londonDay, londonParts } from '../sms/uk-time';
import { seatKey } from '../profiles/rules';
import type { TailoringProfile } from '../tailoring/profile';
import { judgeStandout, memberSkip, matchPctOf, bestFirst, beatsBest, liveConfirmed, inWindow, savesLeftToday, type StandoutJudgement } from './rules';
import { reasonLabel, type StandoutReason } from './reasons';
import { recheckDeal, requestCheck } from './recheck';
import {
  dealRowsByIds,
  decisionKey,
  existingDecisions,
  lastRun,
  liveDealsInWindow,
  loadMembers,
  ownFindsFor,
  purgeOldDecisions,
  recordRun,
  retryDecisions,
  revealTopsFor,
  saveStandout,
  savesFor,
  seenDealsFor,
  shownDealIdsFor,
  writeDealDecisions,
  writeMemberDecisions,
  type DecisionRow,
  type StandoutDealRow,
  type StandoutMember,
} from './server';
import { processNotifications, type NotifyResult } from './notify-server';
import { processNudges, type NudgeRunResult } from './nudge-server';

/** Each pass starts this far before the last one ended: a recheck committing late is never missed (decisions are unique). */
const OVERLAP_MS = 15 * 60_000;
/** With no pass recorded yet, look back this far (never a backlog of old deals). */
const FIRST_LOOKBACK_MS = 2 * 60 * 60_000;
/** Stop starting live rechecks after this long (the route's limit is 120 s). */
const RECHECK_BUDGET_MS = 60_000;

export function standoutEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STANDOUT_ENABLED === 'true';
}

export interface DecisionView {
  userId: string;
  email: string | null;
  dealId: string | null;
  dealType: string | null;
  tier: 'paid' | 'free';
  outcome: DecisionRow['outcome'];
  reason: string;
  reasonText: string;
  matchPct: number | null;
  checked: number | null;
  profitLow: number | null;
  profitBar: number | null;
  minProfit: number | null;
  basis: string | null;
  saved?: 'saved' | 'already_saved' | 'answered' | 'error' | 'would_save';
}

export interface StandoutRunResult {
  dry: boolean;
  enabled: boolean;
  schemaMissing: boolean;
  window: { paidFrom: string; paidTo: string; freeFrom: string; freeTo: string };
  deals: number;
  members: number;
  judged: number;
  standouts: number;
  saved: number;
  waiting: number;
  rechecked: number;
  memberSkips: Record<string, number>;
  decisions: DecisionView[];
  notifications: NotifyResult | null;
  nudges: NudgeRunResult | null;
  purged: number | null;
  errors: string[];
  ms: number;
}

export interface ForceOptions {
  userId: string;
  dealId: string;
}

const randomToken = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

export async function runStandout(o: { apply: boolean; now?: Date; onlyUserId?: string | null; kind?: 'cron' | 'admin'; force?: ForceOptions | null }): Promise<StandoutRunResult> {
  const started = Date.now();
  const now = o.now ?? new Date();
  const enabled = standoutEnabled();
  const out: StandoutRunResult = {
    dry: !o.apply,
    enabled,
    schemaMissing: false,
    window: { paidFrom: '', paidTo: '', freeFrom: '', freeTo: '' },
    deals: 0,
    members: 0,
    judged: 0,
    standouts: 0,
    saved: 0,
    waiting: 0,
    rechecked: 0,
    memberSkips: {},
    decisions: [],
    notifications: null,
    nudges: null,
    purged: null,
    errors: [],
    ms: 0,
  };
  if (!hasServiceRole()) {
    out.errors.push('service role not configured');
    return out;
  }
  // Switched off: a dry run still reports what it would do; nothing is written.
  const apply = o.apply && (enabled || Boolean(o.force));
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const s = settings.standout;
  const delayMs = Math.max(0, settings.freeDealDelayHours) * 3_600_000;
  const ukDay = londonDay(now);

  const last = await lastRun(admin);
  if (!last) {
    out.schemaMissing = true;
    out.errors.push('standout_runs unreadable: run the "Batch 25: standout-deal calls" section of supabase/schema.sql');
    return out;
  }
  const paidTo = now.toISOString();
  const freeTo = new Date(now.getTime() - delayMs).toISOString();
  const paidFrom = new Date((last.paidThrough ? Date.parse(last.paidThrough) : now.getTime() - FIRST_LOOKBACK_MS) - OVERLAP_MS).toISOString();
  const freeFrom = new Date((last.freeThrough ? Date.parse(last.freeThrough) : Date.parse(freeTo) - FIRST_LOOKBACK_MS) - OVERLAP_MS).toISOString();
  out.window = { paidFrom, paidTo, freeFrom, freeTo };
  const paidWindow = { from: paidFrom, to: paidTo };
  const freeWindow = { from: freeFrom, to: freeTo };

  // ── 1. The deals ──
  const byId = new Map<string, StandoutDealRow>();
  const retry = o.force ? [] : await retryDecisions(admin, now);
  if (o.force) {
    for (const r of await dealRowsByIds(admin, [o.force.dealId], { liveOnly: true })) byId.set(r.id, r);
  } else {
    const [paid, free, retried] = await Promise.all([
      liveDealsInWindow(admin, paidFrom, paidTo),
      liveDealsInWindow(admin, freeFrom, freeTo),
      dealRowsByIds(admin, retry.map((r) => r.dealId), { liveOnly: true }),
    ]);
    for (const r of [...paid, ...free, ...retried]) byId.set(r.id, r);
  }
  out.deals = byId.size;

  if (byId.size > 0) {
    try {
      await judgeAndSave({ admin, apply, now, ukDay, o, out, byId, retry, paidWindow, freeWindow, settings: s, delayMs, startedMs: started });
    } catch (err) {
      console.error('[standout] pass failed:', err);
      out.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // ── 5. Tell members, and the slower-spender nudges ──
  if (!o.force) {
    try {
      out.notifications = await processNotifications({ apply, now, onlyUserId: o.onlyUserId ?? null });
    } catch (err) {
      console.error('[standout] notifications failed:', err);
      out.errors.push(`notifications: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      out.nudges = await processNudges({ apply: o.apply && enabled, now, onlyUserId: o.onlyUserId ?? null });
    } catch (err) {
      console.error('[standout] nudges failed:', err);
      out.errors.push(`nudges: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    out.notifications = await processNotifications({ apply, now, onlyUserId: o.force.userId });
  }

  // Once a UK day (the 03:35 pass): not-standout decisions past the keep window go.
  if (apply && !o.force && londonParts(now).hour === 3) out.purged = await purgeOldDecisions(admin, s.keepDays, now);

  if (apply && !o.force && !o.onlyUserId) {
    await recordRun(admin, {
      kind: o.kind ?? 'cron',
      startedAt: now,
      paidThrough: paidTo,
      freeThrough: freeTo,
      summary: { deals: out.deals, members: out.members, judged: out.judged, standouts: out.standouts, saved: out.saved, waiting: out.waiting, rechecked: out.rechecked, memberSkips: out.memberSkips, errors: out.errors.slice(0, 5) },
    });
  }
  out.ms = Date.now() - started;
  // An applied pass lists only what mattered; a dry run lists everything.
  if (o.apply) out.decisions = out.decisions.filter((d) => d.outcome !== 'not_standout');
  return out;
}

interface Ctx {
  admin: ReturnType<typeof createAdminClient>;
  apply: boolean;
  now: Date;
  ukDay: string;
  o: Parameters<typeof runStandout>[0];
  out: StandoutRunResult;
  byId: Map<string, StandoutDealRow>;
  retry: { userId: string; dealId: string }[];
  paidWindow: { from: string; to: string };
  freeWindow: { from: string; to: string };
  settings: Awaited<ReturnType<typeof getBillingSettings>>['standout'];
  delayMs: number;
  startedMs: number;
}

interface Judged {
  member: StandoutMember;
  profileId: string;
  row: StandoutDealRow;
  j: StandoutJudgement;
  tailoring: TailoringProfile;
  liveConfirmedAt: string | null;
  revealPct: number | null;
}

async function judgeAndSave(c: Ctx): Promise<void> {
  const { admin, now, out, settings: s } = c;
  const members = (await loadMembers(admin, c.o.force?.userId ?? c.o.onlyUserId ?? null)).filter((m) => !c.o.onlyUserId || m.id === c.o.onlyUserId);
  out.members = members.length;
  if (members.length === 0) return;
  const dealIds = [...c.byId.keys()];
  const existing = await existingDecisions(admin, dealIds);
  if (!existing) {
    out.schemaMissing = true;
    return;
  }
  const retryKeys = new Set(c.retry.map((r) => decisionKey(r.userId, r.dealId)));
  const freeIds = members.filter((m) => !m.paid).map((m) => m.id);
  const ownFinds = freeIds.length > 0 ? await ownFindsFor(admin, freeIds, dealIds) : new Map<string, Set<string>>();

  // Which deals each member is judged on this pass.
  const dealsFor = new Map<string, StandoutDealRow[]>();
  for (const m of members) {
    const list: StandoutDealRow[] = [];
    for (const row of c.byId.values()) {
      const key = decisionKey(m.id, row.id);
      const prev = existing.get(key);
      const retrying = retryKeys.has(key);
      // A forced test may re-decide a deal not saved yet; nothing else is ever judged twice.
      if (prev && !retrying && !(c.o.force && !prev.savedAt)) continue;
      const inPaid = inWindow(row.live_since ?? null, c.paidWindow);
      const inFree = inWindow(row.live_since ?? null, c.freeWindow);
      const own = ownFinds.get(m.id)?.has(row.id) ?? false;
      // Nothing about a deal reaches a free member inside the free delay (their own finds excepted), forced or not.
      const visibleNow = m.paid || own || (row.live_since ? Date.parse(row.live_since) <= now.getTime() - c.delayMs : false);
      if (!visibleNow) continue;
      if (c.o.force) {
        list.push(row);
        continue;
      }
      if (retrying || (m.paid ? inPaid : inFree || (own && inPaid))) list.push(row);
    }
    if (list.length > 0) dealsFor.set(m.id, list);
  }
  const judgedMembers = members.filter((m) => dealsFor.has(m.id));
  if (judgedMembers.length === 0) return;

  // ── 2. Primary profiles and their tailoring ──
  const profiles = await allProfilesFor(admin, judgedMembers.map((m) => m.id));
  const primaryOfMember = new Map<string, SavedProfile | null>();
  for (const m of judgedMembers) {
    const rows = profiles?.get(m.id) ?? [];
    const id = primaryOf(rows);
    primaryOfMember.set(m.id, rows.find((p) => p.id === id) ?? null);
  }
  const seats = judgedMembers.flatMap((m) => {
    const p = primaryOfMember.get(m.id);
    return p && !m.isTeamMember ? [{ userId: m.id, profile: p, goals: p.goals, savedAreas: p.areas }] : [];
  });
  const tailoring = await tailoringForSeats(admin, seats, now);

  const memberRows: DecisionRow[] = [];
  const able = new Map<string, { profile: SavedProfile; t: TailoringProfile; types: ReturnType<typeof dealTypesFor> }>();
  for (const m of judgedMembers) {
    const p = primaryOfMember.get(m.id) ?? null;
    const t = p ? tailoring.get(seatKey(m.id, p.id)) ?? null : null;
    const types = p && t ? dealTypesFor({ goals: p.goals, about: t.about }) : [];
    const skip = memberSkip({ isTeamMember: m.isTeamMember, primary: p, chosenTypes: types, wants: t ? wantsFor(t) : null });
    if (skip) {
      out.memberSkips[skip] = (out.memberSkips[skip] ?? 0) + 1;
      memberRows.push({ user_id: m.id, profile_id: p?.id ?? null, deal_id: null, deal_type: null, uk_day: c.ukDay, tier: m.paid ? 'paid' : 'free', outcome: 'skipped', reason: skip });
      out.decisions.push(view(m, null, 'skipped', skip));
      continue;
    }
    able.set(m.id, { profile: p!, t: t!, types });
  }

  // The signup reveal's #1, judged now as its card is (no reveal, or gone: the floor alone).
  const revealPct = new Map<string, number>();
  const tops = await revealTopsFor(admin, [...able.keys()]);
  if (tops.size > 0) {
    const topRows = new Map((await dealRowsByIds(admin, [...tops.values()], { liveOnly: true })).map((r) => [r.id, r]));
    for (const [userId, dealId] of tops) {
      const a = able.get(userId);
      const row = topRows.get(dealId);
      if (!a || !row) continue;
      const pct = matchPctOf(judgeRow(row, a.t, wantsFor(a.t), now).judgement);
      if (pct !== null) revealPct.set(userId, pct);
    }
  }

  // ── Judge ──
  const rows: DecisionRow[] = [];
  const candidates: Judged[] = [];
  for (const m of judgedMembers) {
    const a = able.get(m.id);
    if (!a) continue;
    const wants = wantsFor(a.t);
    for (const row of dealsFor.get(m.id) ?? []) {
      const judged = judgeRow(row, a.t, wants, now);
      const j = judgeStandout({ judgement: judged.judgement, facts: judged.facts, figures: judged.figures, wants, chosenTypes: a.types, revealPct: revealPct.get(m.id) ?? null, settings: s, forced: Boolean(c.o.force) });
      out.judged += 1;
      if (!j.inPool) {
        if (c.o.force) out.decisions.push(viewOf(m, row.id, 'not_standout', j));
        continue;
      }
      if (j.outcome === 'standout') candidates.push({ member: m, profileId: a.profile.id, row, j, tailoring: a.t, liveConfirmedAt: null, revealPct: revealPct.get(m.id) ?? null });
      else rows.push(decisionRow(m, a.profile.id, row.id, 'not_standout', j.reason, j, revealPct.get(m.id) ?? null, null, c.ukDay));
    }
  }

  // ── 3. New to the member ──
  let live = candidates;
  if (live.length > 0) {
    const seen = await seenDealsFor(admin, [...new Set(live.map((x) => x.member.id))], [...new Set(live.map((x) => x.row.id))], now);
    if (seen === null) {
      // Unreadable: nothing is saved on a guess, and nothing is written off either — the next pass tries again.
      out.errors.push('"already seen" reads failed: standouts wait for the next pass');
      for (const x of live) rows.push(decisionRow(x.member, x.profileId, x.row.id, 'waiting', 'retry_later', x.j, x.revealPct, null, c.ukDay));
      out.waiting += live.length;
      live = [];
    } else {
      live = live.filter((x) => {
        const isSeen = seen.get(x.member.id)?.has(x.row.id) ?? false;
        if (isSeen) rows.push(decisionRow(x.member, x.profileId, x.row.id, 'not_standout', 'not_new', x.j, x.revealPct, null, c.ukDay));
        return !isSeen;
      });
    }
  }

  // ── 3. Confirmed live recently (a few rechecked here; the rest wait for the hourly recheck) ──
  const rechecked = new Map<string, Awaited<ReturnType<typeof recheckDeal>>>();
  const confirmed: Judged[] = [];
  for (const x of bestFirst(live.map((y) => ({ ...y, matchPct: y.j.matchPct, profitLow: y.j.profitLow })))) {
    const row = x.row;
    const fetchable = serverFetchEnabled(row.source);
    if (liveConfirmed({ fetchable, lastCheckedLiveAt: row.last_checked_live_at, lastConfirmedAt: row.last_confirmed_at }, now, s.liveConfirmHours)) {
      confirmed.push({ ...x, liveConfirmedAt: (fetchable ? row.last_checked_live_at : row.last_confirmed_at ?? row.last_checked_live_at) ?? null });
      continue;
    }
    let r = rechecked.get(row.id);
    if (!r && c.apply && fetchable && out.rechecked < s.rechecksPerRun && Date.now() - c.startedMs < RECHECK_BUDGET_MS) {
      r = await recheckDeal(admin, row.id, now);
      rechecked.set(row.id, r);
      out.rechecked += 1;
    }
    if (r?.result === 'live') confirmed.push({ ...x, liveConfirmedAt: r.confirmedAt });
    else if (r?.result === 'gone') rows.push(decisionRow(x.member, x.profileId, row.id, 'not_standout', 'gone', x.j, x.revealPct, null, c.ukDay));
    else {
      out.waiting += 1;
      rows.push(decisionRow(x.member, x.profileId, row.id, 'waiting', 'needs_recheck', x.j, x.revealPct, null, c.ukDay));
      if (c.apply) await requestCheck(admin, row.id, now);
    }
  }

  // ── 3. Better than anything already shown or saved, and the best of the day ──
  const byMember = new Map<string, Judged[]>();
  for (const x of confirmed) byMember.set(x.member.id, [...(byMember.get(x.member.id) ?? []), x]);
  const saves = await savesFor(admin, [...byMember.keys()], s.beatBestDays, c.ukDay, now);
  const winners: Judged[] = [];
  for (const [userId, list] of byMember) {
    const m = saves.get(userId) ?? { saved: [], today: 0 };
    let left = c.o.force ? Number.POSITIVE_INFINITY : savesLeftToday(m.today, s.maxPerDay);
    const known: { matchPct: number | null; profitLow: number | null }[] = [...m.saved];
    if (!c.o.force && s.beatBestDays > 0) {
      const a = able.get(userId)!;
      const shown = await shownDealIdsFor(admin, userId, s.beatBestDays, now);
      const shownRows = await dealRowsByIds(admin, shown);
      const wants = wantsFor(a.t);
      for (const row of shownRows) {
        const jr = judgeRow(row, a.t, wants, now);
        known.push({ matchPct: matchPctOf(jr.judgement), profitLow: jr.figures.range?.lowPcm ?? null });
      }
    }
    for (const x of bestFirst(list.map((y) => ({ ...y, matchPct: y.j.matchPct, profitLow: y.j.profitLow })))) {
      const best = c.o.force || s.beatBestDays <= 0 ? null : bestAtLeast(known, x.j.matchPct);
      if (x.j.profitLow !== null && !beatsBest(x.j.profitLow, best)) {
        rows.push(decisionRow(x.member, x.profileId, x.row.id, 'not_standout', 'not_beating_best', x.j, x.revealPct, x.liveConfirmedAt, c.ukDay));
        continue;
      }
      if (left <= 0) {
        rows.push(decisionRow(x.member, x.profileId, x.row.id, 'not_standout', 'daily_limit', x.j, x.revealPct, x.liveConfirmedAt, c.ukDay));
        continue;
      }
      left -= 1;
      known.push({ matchPct: x.j.matchPct, profitLow: x.j.profitLow });
      winners.push(x);
      rows.push({ ...decisionRow(x.member, x.profileId, x.row.id, 'standout', x.j.reason, x.j, x.revealPct, x.liveConfirmedAt, c.ukDay), forced: Boolean(c.o.force) });
    }
  }
  out.standouts = winners.length;

  // ── 4. Write, then save ──
  const memberById = new Map(judgedMembers.map((m) => [m.id, m]));
  for (const r of rows) {
    const m = memberById.get(r.user_id)!;
    const v: DecisionView = { ...view(m, r.deal_id, r.outcome, r.reason as StandoutReason), dealType: r.deal_type, matchPct: r.match_pct ?? null, checked: r.checked ?? null, profitLow: r.profit_low_pcm ?? null, minProfit: r.min_profit_pcm ?? null, profitBar: null, basis: r.profit_basis ?? null };
    if (r.outcome === 'standout') v.saved = c.apply ? undefined : 'would_save';
    out.decisions.push(v);
  }
  if (!c.apply) return;
  await writeMemberDecisions(admin, memberRows);
  const ids = await writeDealDecisions(admin, rows, existing);
  for (const x of winners) {
    const id = ids.get(decisionKey(x.member.id, x.row.id));
    const v = out.decisions.find((d) => d.userId === x.member.id && d.dealId === x.row.id);
    if (!id) {
      if (v) v.saved = 'error';
      continue;
    }
    const r = await saveStandout(admin, { decisionId: id, userId: x.member.id, dealId: x.row.id, profileId: x.profileId, token: randomToken(), now });
    if (v) v.saved = r;
    if (r === 'saved') out.saved += 1;
  }
}

/** The best low-end profit among what the member already had at this match or better. */
function bestAtLeast(known: readonly { matchPct: number | null; profitLow: number | null }[], matchPct: number | null): number | null {
  let best: number | null = null;
  for (const k of known) {
    if (k.profitLow === null || k.matchPct === null || matchPct === null || k.matchPct < matchPct) continue;
    best = best === null ? k.profitLow : Math.max(best, k.profitLow);
  }
  return best;
}

function decisionRow(m: StandoutMember, profileId: string, dealId: string, outcome: DecisionRow['outcome'], reason: string, j: StandoutJudgement, revealPct: number | null, liveConfirmedAt: string | null, ukDay: string): DecisionRow {
  return {
    user_id: m.id,
    profile_id: profileId,
    deal_id: dealId,
    deal_type: j.dealType,
    uk_day: ukDay,
    tier: m.paid ? 'paid' : 'free',
    outcome,
    reason,
    match_pct: j.matchPct,
    met: j.met,
    checked: j.checked,
    reveal_pct: revealPct,
    profit_low_pcm: j.profitLow === null ? null : Math.round(j.profitLow),
    profit_high_pcm: j.profitHigh === null ? null : Math.round(j.profitHigh),
    profit_basis: j.profitBasis,
    min_profit_pcm: j.minProfit === null ? null : Math.round(j.minProfit),
    live_confirmed_at: liveConfirmedAt,
  };
}

function view(m: StandoutMember, dealId: string | null, outcome: DecisionRow['outcome'], reason: StandoutReason): DecisionView {
  return { userId: m.id, email: m.email, dealId, dealType: null, tier: m.paid ? 'paid' : 'free', outcome, reason, reasonText: reasonLabel(reason), matchPct: null, checked: null, profitLow: null, profitBar: null, minProfit: null, basis: null };
}

function viewOf(m: StandoutMember, dealId: string, outcome: DecisionRow['outcome'], j: StandoutJudgement): DecisionView {
  return { ...view(m, dealId, outcome, j.reason), dealType: j.dealType, matchPct: j.matchPct, checked: j.checked, profitLow: j.profitLow, profitBar: j.profitBar, minProfit: j.minProfit, basis: j.profitBasis };
}
