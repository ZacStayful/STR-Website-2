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
import { rankingPool } from '../marketplace/queries';
import type { DealVisibility } from '../marketplace/visibility';
import type { TailoringProfile } from '../tailoring/profile';
import { chooseTodayFrom, type TodayChoice } from './choose';
import { feedbackForMember } from './feedback';
import { todayKey, todayStart } from './day';

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
  const read = () =>
    profileId
      ? admin.from('profile_today_lists').select('day, deal_ids, near_miss, advice').eq('profile_id', profileId).eq('day', day).maybeSingle()
      : admin.from('today_selections').select('day, deal_ids, near_miss, advice').eq('user_id', member.userId).eq('day', day).maybeSingle();
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

  let chosen: Omit<TodaySelection, 'day'>;
  try {
    const exclude = await excludedFor(admin, member, day);
    chosen = await chooseToday(admin, member, exclude, now);
  } catch (err) {
    // The page says the day's deals are not ready rather than failing.
    console.error('[today] choosing failed:', (err as Error)?.message ?? err);
    return null;
  }
  // An empty day is not stored: nothing to keep steady, and the next visit
  // may find something (a deal leaving the early-access window, a read that
  // failed this time).
  if (chosen.dealIds.length === 0) return { day, ...chosen };
  const { error } = profileId
    ? await admin
        .from('profile_today_lists')
        .upsert({ profile_id: profileId, user_id: member.userId, day, deal_ids: chosen.dealIds, near_miss: chosen.nearMiss, advice: chosen.advice }, { onConflict: 'profile_id,day', ignoreDuplicates: true })
    : await admin
        .from('today_selections')
        .upsert({ user_id: member.userId, day, deal_ids: chosen.dealIds, near_miss: chosen.nearMiss, advice: chosen.advice }, { onConflict: 'user_id,day', ignoreDuplicates: true });
  if (error) console.error('[today] selection insert failed:', error.message);
  // Read back: when two devices chose at once, both show the one stored first.
  const again = await read();
  return again.data ? fromRow(again.data) : { day, ...chosen };
}

function fromRow(r: { day: unknown; deal_ids: unknown; near_miss: unknown; advice: unknown }): TodaySelection {
  return {
    day: String(r.day),
    dealIds: Array.isArray(r.deal_ids) ? r.deal_ids.filter((x): x is string => typeof x === 'string') : [],
    nearMiss: r.near_miss === true,
    advice: typeof r.advice === 'string' && r.advice.trim() ? r.advice : null,
  };
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
  ]);
  return out;
}

/**
 * Choosing itself is pure (choose.ts); this wires its reads to the database.
 * Feedback and the market snapshot are read first, in that order, as before.
 */
async function chooseToday(admin: Admin, member: MemberContext, exclude: Set<string>, now: Date): Promise<TodayChoice> {
  const feedback = await feedbackForMember(admin, member.userId, now, member.profileId ?? null);
  // The market snapshot scores areas for fit. On a cold cache the page does
  // not wait for a rebuild: without it the deal's own figures carry the fit.
  const cards = await getAreaCardsWithin(AREA_WAIT_MS);
  return chooseTodayFrom(
    { goals: member.goals, savedAreas: member.savedAreas, feedback, exclude, cards, now, tailoring: member.tailoring ?? null },
    {
      pool: (filters, limit) => rankingPool(filters, member.visibility, { userId: member.userId }, limit),
      fullListings: (dealIds) => fullListingsFor(admin, dealIds),
    },
  );
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
