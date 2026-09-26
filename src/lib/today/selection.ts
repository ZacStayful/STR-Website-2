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
import { personaliseScore, personalInputFor } from '../market/personalise';
import { areaMetaForCode } from '../market/areas';
import type { MarketGoals } from '../market/goals';
import { applyCandidateFeedback, feedbackRules, type AppliedRules, type PickFeedback } from '../listing/picks';
import { rankForMember } from '../listing/rank';
import { rankPicks, type SourcedListing } from '../listing/sourcing';
import { isSendable } from '../listing/screen';
import { formatListingPrice } from '../listing/format';
import { analyseRelaxation, closestMatch, describeRelaxation } from '../listing/relax';
import { loadPicks } from '../listing/picks-server';
import type { DealFilters } from '../marketplace/grid';
import { rankingPool, type RankingRow } from '../marketplace/queries';
import type { DealVisibility } from '../marketplace/visibility';
import { applyKindFeedback, buildCandidate, CLOSEST_ADVICE, dealKey, filtersForGoals, nearestAreas, nearestOutside, orderForToday, referencePoint, WIDEN_AREA_ADVICE, type Built, type CandidateContext, type TodayCandidate } from './candidates';
import { feedbackForMember } from './feedback';
import { todayKey, todayStart, TODAY_SIZE } from './day';

type Admin = ReturnType<typeof createAdminClient>;

/** Rows of the pool read for ranking: the best-profit end of what matches. */
const POOL_LIMIT = 1000;
/** How deep the ranking reaches, as the picks run's SPREAD_DEPTH. */
const DEPTH = 40;
/** Rows read when looking for the nearest thing to a search that matched nothing. */
const NEAR_LIMIT = 400;
/** Areas searched outside the member's own when theirs hold nothing. */
const NEARBY_AREAS = 12;
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
}

/** The day's list: the stored one, or a new one chosen and stored now. Null when it cannot be read (schema not run). */
export async function todaySelection(member: MemberContext, now: Date = new Date()): Promise<TodaySelection | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const day = todayKey(now);
  const read = () => admin.from('today_selections').select('day, deal_ids, near_miss, advice').eq('user_id', member.userId).eq('day', day).maybeSingle();
  const first = await read();
  if (first.error) {
    console.error('[today] selection read failed (schema behind?):', first.error.message);
    return null;
  }
  if (first.data) return fromRow(first.data);

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
  const { error } = await admin
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
 * filter has to fall back), opened, or shown on an earlier day.
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
  ]);
  return out;
}

async function chooseToday(admin: Admin, member: MemberContext, exclude: Set<string>, now: Date): Promise<Omit<TodaySelection, 'day'>> {
  const feedback = await feedbackForMember(admin, member.userId, now);
  const rules = feedbackRules(feedback);
  const filters = applyKindFeedback(filtersForGoals(member.goals, member.savedAreas), rules);
  const mode = member.goals?.motivation.mode ?? 'off';
  const ctx = await candidateContext(member.goals, filters, now);
  const usable = (rows: RankingRow[]): Built[] => {
    const out: Built[] = [];
    for (const row of rows) {
      if (exclude.has(row.id)) continue;
      // "Wrong area" answers: the picks run stops searching there, Today stops showing it.
      if (row.postcode_area && rules.badAreas.has(row.postcode_area.toUpperCase())) continue;
      const built = buildCandidate(row, ctx);
      if (built) out.push(built);
    }
    return out;
  };

  // ── The day's list ──
  const pool = usable(await rankingPool(filters, member.visibility, { userId: member.userId }, POOL_LIMIT));
  const exact = pool.filter((b) => b.fails.length === 0).map((b) => b.candidate);
  const ranked = rankForMember(exact, feedback, rules, { depth: DEPTH, mode }).ranked;
  const top = await withFullListings(admin, orderForToday(ranked), feedback, rules);
  if (top.length > 0) return { dealIds: top.slice(0, TODAY_SIZE).map((c) => c.dealId), nearMiss: false, advice: null };

  // ── Nothing matched: the closest thing, and what to change ──
  // First inside their own areas, with the budget lifted: a row failing only
  // on price (or on time on market) is what tells relax.ts which setting is
  // costing them the most.
  const loose = usable(await rankingPool({ ...filters, minPrice: null, maxPrice: null }, member.visibility, { userId: member.userId }, NEAR_LIMIT));
  const misses = viableMisses(loose.filter((b) => b.fails.length > 0), feedback, rules);
  let closest: Built | null = null;
  if (misses.length > 0) {
    // Fewest failed settings first, then the seller most ready to deal (relax.ts).
    const best = closestMatch(
      misses.map((m) => m.near),
      (l) => misses.find((m) => m.near.listing === l)?.candidate.motivation?.score ?? 0,
    );
    const chosen = best ? misses.find((m) => m.near === best) ?? null : null;
    closest = chosen;
    const motiv = member.goals?.motivation ?? null;
    const kind = chosen?.candidate.listing.kind ?? 'sale';
    const relaxation = analyseRelaxation(
      misses.map((m) => m.near),
      { kind, thresholdUnits: motiv ? (kind === 'rent' ? motiv.minWeeksOnMarket : motiv.minMonthsOnMarket) : 0, maxPrice: filters.maxPrice, minBedrooms: null },
    );
    const advice = describeRelaxation(relaxation);
    if (chosen && advice) return { dealIds: [chosen.candidate.dealId], nearMiss: true, advice };
  }
  // Their areas hold nothing that works: the nearest deal just outside them.
  if (filters.areas.length > 0) {
    const own = new Set(filters.areas);
    const from = referencePoint(member.goals, filters.areas);
    const nearby = nearestAreas(from, own, NEARBY_AREAS);
    if (nearby.length > 0) {
      const wide = usable(await rankingPool({ ...filters, areas: nearby }, member.visibility, { userId: member.userId }, NEAR_LIMIT));
      const around = rankForMember(wide.filter((b) => b.fails.length === 0).map((b) => b.candidate), feedback, rules, { depth: NEAR_LIMIT, mode }).ranked;
      const checked = await withFullListings(admin, around, feedback, rules, around.length);
      const nearest = nearestOutside(checked, from, own);
      if (nearest) return { dealIds: [nearest.dealId], nearMiss: true, advice: WIDEN_AREA_ADVICE };
    }
  }
  // Something close, but no single setting would have admitted it.
  if (closest) return { dealIds: [closest.candidate.dealId], nearMiss: true, advice: CLOSEST_ADVICE };
  return { dealIds: [], nearMiss: false, advice: null };
}

/**
 * Near misses that could still be offered: past the member's feedback rules,
 * a deal that works (the money test the ranking applies), clearing the income
 * bar, and card-cleared if they asked for that. "Closest" never means a deal
 * the member already ruled out or one that loses money.
 */
function viableMisses(misses: Built[], feedback: PickFeedback[], rules: AppliedRules): Built[] {
  const survivors = new Set(applyCandidateFeedback(misses.map((m) => m.candidate), feedback, rules).map((c) => c.dealId));
  const pass = misses.filter((m) => survivors.has(m.candidate.dealId));
  const works = new Set(rankPicks(pass.map((m) => m.candidate), pass.length, 'off').map((c) => c.dealId));
  return pass.filter((m) => works.has(m.candidate.dealId) && (!m.candidate.screening || isSendable(m.candidate.screening)) && (m.candidate.precheck === 'ok' || !rules.strictSuitability));
}

async function candidateContext(goals: MarketGoals | null, filters: DealFilters, now: Date): Promise<CandidateContext> {
  // The market snapshot scores areas for fit. On a cold cache the page does
  // not wait for a rebuild: without it the deal's own figures carry the fit.
  const cards = (await getAreaCardsWithin(AREA_WAIT_MS)) ?? [];
  const byCode = new Map(cards.map((c) => [c.code, c]));
  const fits = new Map<string, number | null>();
  return {
    goals,
    areaFit: (code) => {
      if (!code) return null;
      if (fits.has(code)) return fits.get(code)!;
      const card = byCode.get(code);
      const fit = !card ? null : goals ? personaliseScore(personalInputFor(card, goals), goals)?.score ?? card.score?.score ?? null : card.score?.score ?? null;
      fits.set(code, fit);
      return fit;
    },
    areaName: (code) => (code ? byCode.get(code)?.name ?? areaMetaForCode(code).name : 'the UK'),
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    now,
  };
}

/**
 * The last pass of the feedback rules, on the full stored listing of each
 * ranked deal. The card's columns carry no title, features or price
 * qualifier, and "needs too much work" (and a title-only flat or house)
 * reads those. The full listing is read here, server-side, and never leaves:
 * what comes back is the same candidate, with its public listing.
 */
async function withFullListings<C extends TodayCandidate>(admin: Admin, ranked: C[], feedback: PickFeedback[], rules: AppliedRules, limit = DEPTH): Promise<C[]> {
  const head = ranked.slice(0, limit);
  if (head.length === 0) return [];
  const urlById = new Map<string, string>();
  for (let i = 0; i < head.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select('id, canonical_url').in('id', head.slice(i, i + ID_CHUNK).map((c) => c.dealId));
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
  const full = head.map((c) => {
    const url = urlById.get(c.dealId);
    const snap = url ? snapshots.get(url) : undefined;
    // The stand-in URL is kept, so nothing downstream is keyed on the real one.
    return snap ? { ...c, listing: { ...snap, canonicalUrl: dealKey(c.dealId) } } : c;
  });
  const kept = new Set(applyCandidateFeedback(full, feedback, rules).map((c) => c.dealId));
  return head.filter((c) => kept.has(c.dealId));
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

export async function todaysPick(userId: string, now: Date = new Date()): Promise<TodaysPick | null> {
  const since = todayStart(now).getTime();
  const pick = (await loadPicks(userId, 3)).find((p) => Date.parse(p.sentAt) >= since) ?? null;
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
