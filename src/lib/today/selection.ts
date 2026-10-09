import 'server-only';

/**
 * The Today screen's list for one member for one day: chosen once, stored in
 * today_selections, read back on every visit so reloads and other devices
 * show the same deals until the day turns over at 07:00 UTC.
 *
 * Choosing ranks the marketplace pool through the shared ranking
 * (src/lib/listing/rank.ts), so the member's confirmed feedback shapes Today
 * exactly as it shapes their daily pick. Left out before ranking:
 *   - anything inside the early-access window for an account that has never
 *     paid (the grid's own visibility rule, in rankingPool)
 *   - anything they passed (rankingPool's pass filter), kept (already on
 *     their kept list) or opened (on My deals)
 *   - anything a previous day's Today already showed them
 * When nothing matches, the closest deal is stored instead, with the one
 * change that would help (relax.ts), or "widen your area" when it is their
 * area that holds nothing.
 *
 * Nothing here returns an address, a postcode or a listing URL: the ranking
 * reads them server-side, and only deal ids leave.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getAreaCardsWithin } from '../market/cached';
import type { MarketGoals } from '../market/goals';
import type { SourcedListing } from '../listing/sourcing';
import { formatListingPrice } from '../listing/format';
import { loadPicks } from '../listing/picks-server';
import { dealTypesByIds, rankingPool } from '../marketplace/queries';
import { typesShown, type DealType } from '../profile/deal-types';
import { readTodayMix } from '../project/settings-server';
import type { DealVisibility } from '../marketplace/visibility';
import { usesTailoring, type TailoringProfile } from '../tailoring/profile';
import type { TailoredOptions } from '../tailoring/today';
import { widenOptions, type WidenOption } from '../tailoring/widen';
import { chooseDay, type DayChoice } from './choose-day';
import { answersFingerprint, parseStoredChoice, poolTally, rechooseAllowed, type StoredChoice } from './choice';
import { refreshList } from './refresh';
import { TODAY_LIST_MAX, WHAT_IF_NEARBY_AREAS } from '../intelligence/config';
import { whatIfChanges, whatIfResults, type WhatIf, type WhatIfResult } from '../intelligence/what-if';
import { nearestAreas, referencePoint } from './candidates';
import { feedbackForMember } from './feedback';
import { latestRestartsFor } from '../profiles/server';
import { learningSince } from '../profiles/reset';
import { todayKey, todayStart } from './day';
import { siSavedDealIds } from '../standout/saved-server';

type Admin = ReturnType<typeof createAdminClient>;

/** How long the page waits for the market snapshot (area fit); without it the deal's own figures carry the fit. */
const AREA_WAIT_MS = 4_000;
const PAGE = 1000;
const ID_CHUNK = 150;

export interface TodaySelection {
  day: string;
  dealIds: string[];
  nearMiss: boolean;
  advice: string | null;
  /**
   * A tailored list (Batch 14): the deals in the member's pool that meet
   * every must-have when it was chosen, for "N deals match you". Null for an
   * untailored list, or before Batch 14's schema section has been run.
   */
  mustMatches: number | null;
  /** The pool read hit its limit when the count was taken: it is "at least". */
  mustCapped?: boolean;
  /** Batch 22: what the choice read ("I checked N live deals"); null before the column exists or for a legacy list. */
  choice?: StoredChoice | null;
}

export interface MemberContext {
  userId: string;
  /** Who pays: the team owner for a member. Opens are recorded against them. */
  payerId: string;
  goals: MarketGoals | null;
  savedAreas: string[];
  visibility: DealVisibility;
  /**
   * The saved profile this list is for (Batch 13): its own list, its own
   * feedback, and nothing already on another of the member's lists today.
   * Null before the Batch 13 schema: one list a member, as before.
   */
  profileId?: string | null;
  /**
   * The profile is the active one: a list chosen today for the member as one
   * (before their first profile row existed) is its list, not a reason to
   * choose a second one that differs from the morning's email.
   */
  profileActive?: boolean;
  /**
   * The profile's tailoring (Batch 14, src/lib/tailoring): its answers,
   * must-have / nice-to-have switches and what the member liked. Absent or
   * not tailored (usesTailoring): the list is chosen exactly as before.
   */
  tailoring?: TailoringProfile | null;
}

/** The day's list: the stored one, or a new one chosen and stored now. Null when it cannot be read (schema not run). */
export async function todaySelection(member: MemberContext, now: Date = new Date()): Promise<TodaySelection | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const day = todayKey(now);
  const profileId = member.profileId ?? null;
  const read = () => (profileId ? readProfileList(admin, profileId, day) : admin.from('today_selections').select('day, deal_ids, near_miss, advice').eq('user_id', member.userId).eq('day', day).maybeSingle());
  const first = await read();
  if (first.error) {
    console.error('[today] selection read failed (schema behind?):', first.error.message);
    return null;
  }
  if (first.data) return fromRow(first.data);
  if (profileId && member.profileActive) {
    const legacy = await admin.from('today_selections').select('day, deal_ids, near_miss, advice').eq('user_id', member.userId).eq('day', day).maybeSingle();
    if (!legacy.error && legacy.data) {
      const kept = fromRow(legacy.data);
      const { error: copyErr } = await admin
        .from('profile_today_lists')
        .upsert({ profile_id: profileId, user_id: member.userId, day, deal_ids: kept.dealIds, near_miss: kept.nearMiss, advice: kept.advice }, { onConflict: 'profile_id,day', ignoreDuplicates: true });
      if (copyErr) console.error('[today] adopting the morning list failed:', copyErr.message);
      const again = await read();
      return again.data ? fromRow(again.data) : kept;
    }
  }

  let chosen: DayChoice;
  let tally: Omit<StoredChoice, 'fp' | 'answeredAt' | 'finds'>;
  try {
    const exclude = await excludedFor(admin, member, day);
    ({ chosen, tally } = await chooseToday(admin, member, exclude, now));
  } catch (err) {
    // The page says the day's deals are not ready rather than failing.
    console.error('[today] choosing failed:', (err as Error)?.message ?? err);
    return null;
  }
  // An empty day is not stored: nothing to keep steady, and the next visit
  // may find something (a deal leaving the early-access window, a read that
  // failed this time).
  if (chosen.dealIds.length === 0) return { day, dealIds: [], nearMiss: chosen.nearMiss, advice: chosen.advice, mustMatches: chosen.mustMatches, mustCapped: chosen.capped };
  const { data: inserted, error } = profileId
    ? await admin
        .from('profile_today_lists')
        .upsert({ profile_id: profileId, user_id: member.userId, day, deal_ids: chosen.dealIds, near_miss: chosen.nearMiss, advice: chosen.advice }, { onConflict: 'profile_id,day', ignoreDuplicates: true })
        .select('day')
    : await admin
        .from('today_selections')
        .upsert({ user_id: member.userId, day, deal_ids: chosen.dealIds, near_miss: chosen.nearMiss, advice: chosen.advice }, { onConflict: 'user_id,day', ignoreDuplicates: true });
  if (error) console.error('[today] selection insert failed:', error.message);
  if (!error && profileId && chosen.mustMatches !== null) await storeTailoring(admin, profileId, day, chosen, []);
  // Batch 22: what this choice read, written only by the request whose list was stored (bug 9).
  if (!error && profileId && Array.isArray(inserted) && inserted.length > 0) {
    await storeChoice(admin, profileId, day, { ...tally, finds: 0, fp: fingerprintFor(member), answeredAt: null });
  }
  // Read back: when two devices chose at once, both show the one stored first.
  const again = await read();
  return again.data ? fromRow(again.data) : { day, dealIds: chosen.dealIds, nearMiss: chosen.nearMiss, advice: chosen.advice, mustMatches: chosen.mustMatches, mustCapped: chosen.capped };
}

/** The answers a list is chosen with (choice.ts answersFingerprint). */
function fingerprintFor(member: Pick<MemberContext, 'goals' | 'savedAreas' | 'tailoring'>): string {
  return answersFingerprint({ goals: member.goals, savedAreas: member.savedAreas, modes: member.tailoring?.modes ?? null, answers: member.tailoring?.about ?? null });
}

let warnedChoiceColumn = 0;
/** Batch 22's choice column; best effort (until the section is run, nothing else is lost). */
async function storeChoice(admin: Admin, profileId: string, day: string, choice: StoredChoice): Promise<void> {
  const { error } = await admin.from('profile_today_lists').update({ choice }).eq('profile_id', profileId).eq('day', day);
  if (error && Date.now() - warnedChoiceColumn > 60_000) {
    warnedChoiceColumn = Date.now();
    console.warn('[today] choice not stored (Batch 22 schema not run?):', error.message);
  }
}

/** A profile's stored choice for a day; null when there is none or the column is missing. */
async function readChoice(admin: Admin, profileId: string, day: string): Promise<StoredChoice | null> {
  const { data, error } = await admin.from('profile_today_lists').select('choice').eq('profile_id', profileId).eq('day', day).maybeSingle();
  if (error || !data) return null;
  return parseStoredChoice((data as { choice?: unknown }).choice);
}

/** "I checked N live deals": today's stored choice for a profile (Batch 22; the reveal and the calls batch). */
export async function checkedCountFor(profileId: string, now: Date = new Date()): Promise<StoredChoice | null> {
  if (!hasServiceRole()) return null;
  return readChoice(createAdminClient(), profileId, todayKey(now));
}

/**
 * Today's choice worked out without storing anything (Batch 22, layer 1 of
 * the signup search): the same ranking, exclusions and mix the list would
 * get. Null on any failure.
 */
export async function previewToday(member: MemberContext, now: Date = new Date()): Promise<{ chosen: DayChoice; tally: Omit<StoredChoice, 'fp' | 'answeredAt' | 'finds'> } | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  try {
    const exclude = await excludedFor(admin, member, todayKey(now));
    return await chooseToday(admin, member, exclude, now);
  } catch (err) {
    console.error('[today] preview failed:', (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Batch 22, Part G: a member's search has finished; finds that rank better
 * than an unanswered, un-revealed card take its place (refresh.ts). Pinned:
 * `keep` (the revealed cards) and anything kept, passed or opened. Checked
 * update, like rechooseToday; replaced cards go into shown_ids. Returns the
 * deals added (empty when nothing changed or there is no list yet).
 */
export async function refreshTodayAfterSearch(member: MemberContext, finds: readonly string[], keep: readonly string[], now: Date = new Date()): Promise<string[]> {
  if (!hasServiceRole() || !member.profileId || finds.length === 0) return [];
  const admin = createAdminClient();
  const day = todayKey(now);
  const profileId = member.profileId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await readProfileList(admin, profileId, day);
    if (error || !data) return [];
    const stored = fromRow(data);
    const current = stored.dealIds;
    let ranking: string[];
    let pinned: Set<string>;
    let stillShownable: Set<string>;
    let tally: Omit<StoredChoice, 'fp' | 'answeredAt' | 'finds'>;
    let nearMissNow: boolean;
    try {
      const [exclude, answered] = await Promise.all([excludedFor(admin, member, day), answeredOrOpened(admin, member, current)]);
      // Today's ranking over the pool as it is now (finds included), with this list's own cards allowed back in.
      const res = await chooseToday(admin, member, new Set([...exclude].filter((id) => !current.includes(id))), now);
      tally = res.tally;
      nearMissNow = res.chosen.nearMiss;
      ranking = [...res.chosen.dealIds, ...current.filter((id) => !res.chosen.dealIds.includes(id))];
      pinned = new Set([...answered, ...keep]);
      stillShownable = new Set(finds.filter((id) => !exclude.has(id)));
    } catch (err) {
      console.error('[today] refresh after search failed:', (err as Error)?.message ?? err);
      return [];
    }
    // A near-miss list whose day now has real matches: the near miss gives way
    // (unless the member answered it) and the list is a real one again.
    const nowMatches = stored.nearMiss && !nearMissNow && [...stillShownable].some((id) => ranking.includes(id));
    const base = nowMatches ? current.filter((id) => pinned.has(id)) : current;
    const dropped = nowMatches ? current.filter((id) => !pinned.has(id)) : [];
    const r = refreshList({ current: base, pinned, ranking, finds: stillShownable, max: TODAY_LIST_MAX });
    if (!r.changed) return [];
    r.replaced.push(...dropped);
    const patch: Record<string, unknown> = { deal_ids: r.dealIds };
    if (nowMatches) Object.assign(patch, { near_miss: false, advice: null });
    const { data: updated, error: updErr } = await admin
      .from('profile_today_lists')
      .update(patch)
      .eq('profile_id', profileId)
      .eq('day', day)
      .filter('deal_ids', 'eq', `{${current.join(',')}}`)
      .select('day');
    if (updErr) {
      console.error('[today] refresh save failed:', updErr.message);
      return [];
    }
    if (!updated || updated.length === 0) continue;
    if (r.replaced.length > 0) await storeShown(admin, profileId, day, [...ids(data.shown_ids), ...r.replaced]);
    const before = await readChoice(admin, profileId, day);
    await storeChoice(admin, profileId, day, { ...(before ?? { fp: null, answeredAt: null }), ...tally, meeting: before?.meeting ?? tally.meeting, finds: (before?.finds ?? 0) + r.added.length });
    return r.added;
  }
  return [];
}

async function storeShown(admin: Admin, profileId: string, day: string, shown: readonly string[]): Promise<void> {
  const { error } = await admin.from('profile_today_lists').update({ shown_ids: [...new Set(shown)] }).eq('profile_id', profileId).eq('day', day);
  if (error) console.warn('[today] shown ids not stored:', error.message);
}

interface ListRow {
  day: unknown;
  deal_ids: unknown;
  near_miss: unknown;
  advice: unknown;
  shown_ids?: unknown;
  tailoring?: unknown;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function fromRow(r: ListRow): TodaySelection {
  const t = r.tailoring && typeof r.tailoring === 'object' ? (r.tailoring as Record<string, unknown>) : null;
  const n = typeof t?.mustMatches === 'number' && Number.isFinite(t.mustMatches) ? t.mustMatches : null;
  return {
    day: String(r.day),
    dealIds: ids(r.deal_ids),
    nearMiss: r.near_miss === true,
    advice: typeof r.advice === 'string' && r.advice.trim() ? r.advice : null,
    mustMatches: n,
    mustCapped: t?.capped === true,
  };
}

/**
 * A profile's list for a day, with Batch 14's two columns when they are
 * there (shown_ids, tailoring). Until that schema section is run the list
 * still reads, without them: an un-run section never blanks Today.
 */
async function readProfileList(admin: Admin, profileId: string, day: string): Promise<{ data: ListRow | null; error: { message: string } | null }> {
  const full = await admin.from('profile_today_lists').select('day, deal_ids, near_miss, advice, shown_ids, tailoring').eq('profile_id', profileId).eq('day', day).maybeSingle();
  if (!full.error) return { data: (full.data as ListRow | null) ?? null, error: null };
  const plain = await admin.from('profile_today_lists').select('day, deal_ids, near_miss, advice').eq('profile_id', profileId).eq('day', day).maybeSingle();
  return { data: (plain.data as ListRow | null) ?? null, error: plain.error };
}

let warnedTailoringColumns = 0;
/**
 * What a tailored choice adds to the stored list: the must-have count for
 * the header, and every deal it took off (shown_ids), so a replaced card is
 * never shown again. Best effort: without Batch 14's columns the list itself
 * is already stored and nothing else is lost.
 */
async function storeTailoring(admin: Admin, profileId: string, day: string, chosen: Pick<DayChoice, 'mustMatches' | 'capped'>, shown: readonly string[]): Promise<void> {
  const patch: Record<string, unknown> = { tailoring: { mustMatches: chosen.mustMatches, capped: chosen.capped } };
  if (shown.length > 0) patch.shown_ids = [...new Set(shown)];
  const { error } = await admin.from('profile_today_lists').update(patch).eq('profile_id', profileId).eq('day', day);
  if (error && Date.now() - warnedTailoringColumns > 60_000) {
    warnedTailoringColumns = Date.now();
    console.warn('[today] tailoring columns not stored (Batch 14 schema not run?):', error.message);
  }
}

/**
 * Everything that can never be on this member's Today again: kept or passed
 * (read here directly, so a pass stays out even when the pool's own pass
 * filter has to fall back), opened, or shown on an earlier day. With saved
 * profiles (Batch 13) that is member-wide, across every profile, and a deal
 * already on another of their profiles' lists today is left out too: each
 * profile's daily charge buys different deals.
 */
async function excludedFor(admin: Admin, member: MemberContext, day: string): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all([
    (async () => {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('deal_reactions').select('deal_id').eq('user_id', member.userId).order('deal_id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) {
          console.warn('[today] reactions read failed:', error.message);
          break;
        }
        for (const r of (data ?? []) as { deal_id: string }[]) out.add(r.deal_id);
        if ((data?.length ?? 0) < PAGE) break;
      }
    })(),
    (async () => {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('deal_opens').select('deal_id').eq('user_id', member.payerId).eq('status', 'open').order('deal_id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) {
          console.warn('[today] opens read failed:', error.message);
          break;
        }
        for (const r of (data ?? []) as { deal_id: string }[]) out.add(r.deal_id);
        if ((data?.length ?? 0) < PAGE) break;
      }
    })(),
    (async () => {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('today_selections').select('deal_ids').eq('user_id', member.userId).lt('day', day).order('day', { ascending: true }).range(from, from + PAGE - 1);
        if (error) {
          console.warn('[today] earlier days read failed:', error.message);
          break;
        }
        for (const r of (data ?? []) as { deal_ids: unknown }[]) if (Array.isArray(r.deal_ids)) for (const id of r.deal_ids) if (typeof id === 'string') out.add(id);
        if ((data?.length ?? 0) < PAGE) break;
      }
    })(),
    (async () => {
      if (!member.profileId) return;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('profile_today_lists').select('profile_id, day, deal_ids').eq('user_id', member.userId).lte('day', day).order('day', { ascending: true }).order('profile_id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) {
          console.warn('[today] profile lists read failed:', error.message);
          break;
        }
        for (const r of (data ?? []) as { profile_id: string; day: string; deal_ids: unknown }[]) {
          if (String(r.day) === day && r.profile_id === member.profileId) continue;
          if (Array.isArray(r.deal_ids)) for (const id of r.deal_ids) if (typeof id === 'string') out.add(id);
        }
        if ((data?.length ?? 0) < PAGE) break;
      }
    })(),
    (async () => {
      // Cards a re-choose took off a list (Batch 14): never shown again on a
      // later day, nor on another profile's list today. This profile's own
      // today can take them back: a switch flipped back restores the list.
      // Its own query, so a schema without the column costs only this.
      if (!member.profileId) return;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from('profile_today_lists').select('profile_id, day, shown_ids').eq('user_id', member.userId).lte('day', day).order('day', { ascending: true }).order('profile_id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) break;
        for (const r of (data ?? []) as { profile_id: string; day: string; shown_ids: unknown }[]) {
          if (String(r.day) === day && r.profile_id === member.profileId) continue;
          for (const id of ids(r.shown_ids)) out.add(id);
        }
        if ((data?.length ?? 0) < PAGE) break;
      }
    })(),
  ]);
  return out;
}

/** The deal types this member's profile is shown (Batch 17): its choice, its older answers mapped, or Short-let + Rent-to-rent. */
export function typesFor(member: Pick<MemberContext, 'goals' | 'tailoring'>): DealType[] {
  return typesShown({ goals: member.goals, about: member.tailoring?.about ?? null });
}

/**
 * The Keeps of each deal type on this profile since `since` (Today's mix
 * shifts toward them). The profile's own when it has one; the member's before
 * Batch 13's column. Empty on any failure: the mix then starts where it
 * starts.
 */
async function keepsByType(admin: Admin, member: MemberContext, windowStart: Date): Promise<Partial<Record<DealType, number>>> {
  // Batch 22d: after Start again only the profile's Keeps since then shift the mix.
  const since = member.profileId ? learningSince(windowStart, (await latestRestartsFor(admin, [member.profileId], windowStart)).get(member.profileId)) : windowStart;
  let q = admin.from('deal_reactions').select('deal_id').eq('user_id', member.userId).eq('reaction', 'keep').gte('updated_at', since.toISOString()).limit(PAGE);
  if (member.profileId) q = q.eq('profile_id', member.profileId);
  const { data, error } = await q;
  if (error) {
    console.warn('[today] keeps by type unreadable:', error.message);
    return {};
  }
  // Batch 25: only the member's own Keeps shift the mix, never a deal Stayful Intelligence saved for them.
  const siSaved = await siSavedDealIds(admin, member.userId);
  const types = await dealTypesByIds(((data ?? []) as { deal_id: string }[]).map((r) => r.deal_id).filter((id) => !siSaved.has(id)));
  const out: Partial<Record<DealType, number>> = {};
  for (const t of types.values()) out[t] = (out[t] ?? 0) + 1;
  return out;
}

/**
 * Choosing itself is pure (choose.ts, choose-day.ts); this wires its reads to
 * the database. Feedback and the market snapshot are read first, in that
 * order, as before. Batch 17: the profile's deal types, each chosen on its
 * own and mixed (the mix's numbers and the Keeps it shifts on read here).
 */
async function chooseToday(admin: Admin, member: MemberContext, exclude: Set<string>, now: Date, opts: TailoredOptions = {}): Promise<{ chosen: DayChoice; tally: Omit<StoredChoice, 'fp' | 'answeredAt' | 'finds'> }> {
  const feedback = await feedbackForMember(admin, member.userId, now, member.profileId ?? null);
  // The market snapshot scores areas for fit. On a cold cache the page does
  // not wait for a rebuild: without it the deal's own figures carry the fit.
  const cards = await getAreaCardsWithin(AREA_WAIT_MS);
  const types = typesFor(member);
  const mix = await readTodayMix(admin);
  const typeKeeps = types.length > 1 ? await keepsByType(admin, member, new Date(now.getTime() - mix.windowDays * 86_400_000)) : {};
  // Batch 22: what the choice reads is tallied for "I checked N live deals" (choice.ts); the choosing itself is untouched.
  const tally = poolTally<Awaited<ReturnType<typeof rankingPool>>[number]>(exclude);
  const chosen = await chooseDay(
    { goals: member.goals, savedAreas: member.savedAreas, feedback, exclude, cards, now, tailoring: member.tailoring ?? null, types, typeKeeps, mix },
    {
      pool: tally.wrap((filters, limit) => rankingPool(filters, member.visibility, { userId: member.userId }, limit)),
      fullListings: (dealIds) => fullListingsFor(admin, dealIds),
      dealTypes: (dealIds) => dealTypesByIds(dealIds),
    },
    opts,
  );
  return { chosen, tally: tally.result(chosen.mustMatches, chosen.capped === true) };
}

/** Of these deals, the ones the member has kept, passed or opened: a re-choose never takes those off. */
async function answeredOrOpened(admin: Admin, member: MemberContext, dealIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (dealIds.length === 0) return out;
  const [reactions, opens] = await Promise.all([
    admin.from('deal_reactions').select('deal_id').eq('user_id', member.userId).in('deal_id', [...dealIds]),
    admin.from('deal_opens').select('deal_id').eq('user_id', member.payerId).eq('status', 'open').in('deal_id', [...dealIds]),
  ]);
  if (reactions.error || opens.error) throw new Error(`answers unreadable: ${(reactions.error ?? opens.error)!.message}`);
  for (const r of [...(reactions.data ?? []), ...(opens.data ?? [])] as { deal_id: string }[]) out.add(r.deal_id);
  return out;
}

/**
 * Today's list chosen again after the member changed what they want (a
 * must-have switch, a widen, an accepted prompt, a profile answer): the
 * cards that still meet every must-have stay where they are, and so does
 * anything they have kept, passed or opened; the rest are replaced from
 * deals not shown today. Only a profile's list, only a tailored one, and
 * only once one has been chosen today (otherwise the next visit chooses
 * with the new answers anyway).
 *
 * The update is checked (the list must still be the one read), so two
 * devices cannot overwrite each other: on a clash it reads again. It writes
 * nothing but the list: no pick, no open, no charge.
 */
export async function rechooseToday(member: MemberContext, now: Date = new Date(), opts: { answeredAt?: string | null } = {}): Promise<TodaySelection | null> {
  if (!hasServiceRole() || !member.profileId || !usesTailoring(member.tailoring)) return null;
  const admin = createAdminClient();
  const day = todayKey(now);
  const profileId = member.profileId;
  const fp = fingerprintFor(member);
  const answeredAt = opts.answeredAt ?? null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await readProfileList(admin, profileId, day);
    if (error || !data) return null;
    const stored = fromRow(data);
    const current = stored.dealIds;
    // Batch 22 (bugs 7–8): the same answers change nothing (a no-op re-choose
    // would rotate a near-miss card the member was just shown), and a
    // re-choose from answers older than the stored list's never wins.
    const before = await readChoice(admin, profileId, day);
    const allowed = rechooseAllowed(before, fp, answeredAt);
    if (allowed !== 'go') return { ...stored, choice: before };
    let chosen: DayChoice;
    let tally: Omit<StoredChoice, 'fp' | 'answeredAt' | 'finds'>;
    try {
      const [exclude, pinned] = await Promise.all([excludedFor(admin, member, day), answeredOrOpened(admin, member, current)]);
      ({ chosen, tally } = await chooseToday(admin, member, exclude, now, { current, pinned }));
    } catch (err) {
      console.error('[today] re-choosing failed:', (err as Error)?.message ?? err);
      return null;
    }
    const same = chosen.dealIds.length === current.length && chosen.dealIds.every((id, i) => id === current[i]);
    const choice: StoredChoice = { ...tally, finds: before?.finds ?? 0, fp, answeredAt: answeredAt ?? before?.answeredAt ?? null };
    if (same && chosen.nearMiss === stored.nearMiss && chosen.advice === stored.advice) {
      await storeTailoring(admin, profileId, day, chosen, []);
      await storeChoice(admin, profileId, day, choice);
      return { ...stored, mustMatches: chosen.mustMatches, mustCapped: chosen.capped, choice };
    }
    const { data: updated, error: updErr } = await admin
      .from('profile_today_lists')
      .update({ deal_ids: chosen.dealIds, near_miss: chosen.nearMiss, advice: chosen.advice })
      .eq('profile_id', profileId)
      .eq('day', day)
      .filter('deal_ids', 'eq', `{${current.join(',')}}`)
      .select('day');
    if (updErr) {
      console.error('[today] re-choose save failed:', updErr.message);
      return null;
    }
    // Changed underneath us (another device, another answer): read it again.
    if (!updated || updated.length === 0) continue;
    const replaced = current.filter((id) => !chosen.dealIds.includes(id));
    await storeTailoring(admin, profileId, day, chosen, [...ids(data.shown_ids), ...replaced]);
    await storeChoice(admin, profileId, day, choice);
    return { day, dealIds: chosen.dealIds, nearMiss: chosen.nearMiss, advice: chosen.advice, mustMatches: chosen.mustMatches, mustCapped: chosen.capped, choice };
  }
  return null;
}

/**
 * The full stored listing of each deal, by deal id, for the last pass of the
 * feedback rules (choose.ts withFullListings). Read here, server-side, and
 * never returned to a page.
 */
async function fullListingsFor(admin: Admin, dealIds: string[]): Promise<Map<string, SourcedListing>> {
  const urlById = new Map<string, string>();
  for (let i = 0; i < dealIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select('id, canonical_url').in('id', dealIds.slice(i, i + ID_CHUNK));
    if (error) console.warn('[today] deal urls read failed:', error.message);
    for (const r of (data ?? []) as { id: string; canonical_url: string }[]) urlById.set(r.id, r.canonical_url);
  }
  const snapshots = new Map<string, SourcedListing>();
  const urls = [...new Set(urlById.values())];
  for (let i = 0; i < urls.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('sourced_listings').select('canonical_url, snapshot').in('canonical_url', urls.slice(i, i + ID_CHUNK));
    if (error) console.warn('[today] listings read failed:', error.message);
    for (const r of (data ?? []) as { canonical_url: string; snapshot: SourcedListing }[]) if (r.snapshot && typeof r.snapshot === 'object') snapshots.set(r.canonical_url, r.snapshot);
  }
  const out = new Map<string, SourcedListing>();
  for (const [id, url] of urlById) {
    const snap = snapshots.get(url);
    if (snap) out.set(id, snap);
  }
  return out;
}

/**
 * Widen-and-see (Batch 14, tailoring/widen.ts), for the Today page only (the
 * daily runs have no time for it): the offers for a tailored profile whose
 * list is short, each with the real count of deals it would add. Empty on
 * any failure: the page then says the day is short without offers.
 */
export async function widenOptionsFor(member: MemberContext, current: readonly string[], now: Date = new Date()): Promise<WidenOption[]> {
  if (!hasServiceRole() || !usesTailoring(member.tailoring)) return [];
  const admin = createAdminClient();
  try {
    const [exclude, feedback, cards] = await Promise.all([excludedFor(admin, member, todayKey(now)), feedbackForMember(admin, member.userId, now, member.profileId ?? null), getAreaCardsWithin(AREA_WAIT_MS)]);
    return await widenOptions(
      { goals: member.goals, savedAreas: member.savedAreas, feedback, exclude, cards, now, tailoring: member.tailoring },
      member.tailoring,
      // Batch 17: only the deal types this profile is shown can be added.
      { pool: (filters, limit) => rankingPool({ ...filters, types: typesFor(member) }, member.visibility, { userId: member.userId }, limit), fullListings: (dealIds) => fullListingsFor(admin, dealIds) },
      current,
    );
  } catch (err) {
    console.error('[today] widen offers failed:', (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Batch 22, Part F: the what-ifs for this member's day (intelligence/what-if.ts):
 * every one-change variant judged on one read of the member's own visible
 * pool, with Today's own exclusions and checks. Empty on any failure (the page
 * then shows the plain line).
 */
export async function whatIfsForMember(member: MemberContext, now: Date = new Date()): Promise<{ variants: WhatIf[]; results: WhatIfResult[] }> {
  const none = { variants: [] as WhatIf[], results: [] as WhatIfResult[] };
  if (!hasServiceRole() || !member.tailoring || !member.goals) return none;
  const admin = createAdminClient();
  try {
    const [exclude, feedback, cards] = await Promise.all([excludedFor(admin, member, todayKey(now)), feedbackForMember(admin, member.userId, now, member.profileId ?? null), getAreaCardsWithin(AREA_WAIT_MS)]);
    const own = new Set(member.savedAreas);
    const nearby = member.goals.where === 'near' ? [] : nearestAreas(referencePoint(member.goals, member.savedAreas), own, WHAT_IF_NEARBY_AREAS);
    const p = member.tailoring;
    const variants = whatIfChanges(p, { nearbyAreas: nearby });
    const results = await whatIfResults(
      { goals: member.goals, savedAreas: member.savedAreas, feedback, exclude, cards, now, tailoring: p },
      p,
      // Every deal type: a variant may add one the profile does not show yet.
      { pool: (filters, limit) => rankingPool({ ...filters, types: [] }, member.visibility, { userId: member.userId }, limit) },
      variants,
    );
    return { variants, results };
  } catch (err) {
    console.error('[today] what-ifs failed:', (err as Error)?.message ?? err);
    return none;
  }
}

/** This morning's pick, when there is one: already paid for, so already opened. */
export interface TodaysPick {
  id: string;
  /** The marketplace deal it was drawn from; null for a pick found outside the pool. */
  dealId: string | null;
  kind: 'sale' | 'rent';
  areaName: string | null;
  bedrooms: number | null;
  price: string;
}

/**
 * With `profileId` (Batch 13), that profile's pick: a member with several
 * profiles gets one pick for each. Pass the ACTIVE profile only: a pick made
 * for the member as one (untagged: sent before their first profile row
 * existed) counts as its.
 */
export async function todaysPick(userId: string, now: Date = new Date(), profileId: string | null = null): Promise<TodaysPick | null> {
  const since = todayStart(now).getTime();
  let mine: Set<string> | null = null;
  if (profileId && hasServiceRole()) {
    const { data, error } = await createAdminClient().from('sourcing_sent').select('id').eq('user_id', userId).or(`profile_id.eq.${profileId},profile_id.is.null`).gte('sent_at', new Date(since).toISOString());
    if (!error) mine = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  }
  const pick = (await loadPicks(userId, mine ? 12 : 3)).find((p) => Date.parse(p.sentAt) >= since && (!mine || mine.has(p.id))) ?? null;
  if (!pick) return null;
  return {
    id: pick.id,
    dealId: pick.dealId,
    kind: pick.kind,
    areaName: pick.areaName,
    bedrooms: pick.listing.bedrooms,
    price: formatListingPrice(pick.listing.price),
  };
}
