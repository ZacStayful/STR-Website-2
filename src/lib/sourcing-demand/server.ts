import 'server-only';

/**
 * The demand-led searches' reads and writes. The rules are pure and tested
 * next door (demand.ts, settings.ts, cost.ts, table.ts); everything here just
 * moves rows. Service role only: the callers are the cron (secret-gated),
 * the marketplace sweep and /admin/demand (admin-gated).
 *
 * Profiles are read the way the daily run reads them (Batch 13's
 * allProfilesFor + seatsFor), so demand and daily deals can never disagree
 * about which profiles count: all paused adds nothing, and a member with no
 * profile rows is one profile made of market_goals + saved_areas.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { ACCESS_COLUMNS, isPaid, type AccessProfile } from '../access';
import { payersForCharging } from '../listing/daily-deals-server';
import { allProfilesFor } from '../profiles/server';
import { seatsFor } from '../profiles/rules';
import { parseMarketGoals } from '../market/goals';
import { parseAboutYou } from '../profile/about';
import type { AreaCardData } from '../market/explorer';
import { fullyCoveredAreas, sweepAreaLimit, sweepEnabled, sweepHistory, sweepMaxQueries, sweepQueries, type SweepRunRecord } from '../marketplace/sweep-plan';
import { areaScores, buildDemand, summariseToday, type AreaData, type Demand, type DemandMember, type DemandProfile, type TodayKeys, type TodayRow } from './demand';
import { MAX_NO_ANSWER_PER_DAY } from './config';
import { DEMAND_SETTING_KEYS, parseDemandSettings, type DemandSettings } from './settings';

export type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const ID_CHUNK = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The six business numbers; defaults when the rows are missing or unreadable (settings.ts). */
export async function readDemandSettings(admin: Admin): Promise<DemandSettings> {
  const { data, error } = await admin.from('billing_settings').select('key, value').in('key', Object.values(DEMAND_SETTING_KEYS));
  if (error) console.warn('[demand-sourcing] settings unreadable, using the defaults:', error.message);
  return parseDemandSettings(new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])));
}

interface MemberRow {
  id: string;
  email: string | null;
  last_seen_at: string | null;
  market_goals: unknown;
  about_you: unknown;
}

async function recentMembers(admin: Admin, sinceIso: string): Promise<MemberRow[] | null> {
  const out: MemberRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, email, last_seen_at, market_goals, about_you')
      .gte('last_seen_at', sinceIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[demand-sourcing] members unreadable:', error.message);
      return null;
    }
    out.push(...((data ?? []) as MemberRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

/** Batch 9's manual switch-off list. Empty when unreadable (that schema not run yet). */
async function switchedOff(admin: Admin): Promise<Set<string>> {
  const { data, error } = await admin.from('activity_excluded_accounts').select('user_id');
  if (error) {
    console.warn('[demand-sourcing] switch-off list unreadable (schema behind?):', error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

/** Which of these paying accounts is paying now (src/lib/access.ts isPaid). */
async function payingNow(admin: Admin, payerIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const some of chunk(payerIds, ID_CHUNK)) {
    const { data, error } = await admin.from('profiles').select(`id, ${ACCESS_COLUMNS}`).in('id', some);
    if (error) {
      console.error('[demand-sourcing] account status unreadable:', error.message);
      continue;
    }
    for (const row of (data ?? []) as unknown as (AccessProfile & { id: string })[]) if (isPaid(row)) out.add(row.id);
  }
  return out;
}

/** saved_areas for the members served as one legacy profile (no profile rows). */
async function savedAreasFor(admin: Admin, ids: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const some of chunk(ids, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from('saved_areas').select('user_id, postcode_area').in('user_id', some).order('user_id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) {
        console.warn('[demand-sourcing] saved areas unreadable:', error.message);
        break;
      }
      for (const r of (data ?? []) as { user_id: string; postcode_area: string }[]) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r.postcode_area]);
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  return out;
}

export interface DemandInputs {
  members: DemandMember[];
  profiles: DemandProfile[];
}

/**
 * Everyone seen in the app within the active window, with their running
 * profiles. Staff and switched-off accounts are still returned (flagged):
 * buildDemand leaves them out and counts them. Null when the members, or who
 * pays for whom, cannot be read.
 */
export async function loadDemandInputs(admin: Admin, settings: Pick<DemandSettings, 'activeDays'>, now: Date = new Date()): Promise<DemandInputs | null> {
  const rows = await recentMembers(admin, new Date(now.getTime() - settings.activeDays * DAY_MS).toISOString());
  if (rows === null) return null;
  const ids = rows.map((r) => r.id);
  // Chunked, and null rather than "everyone pays for themselves" when the lookup fails: that would count a team's seats separately.
  const [off, payers, profileRows] = await Promise.all([switchedOff(admin), payersForCharging(ids), allProfilesFor(admin, ids)]);
  if (payers === null) {
    console.error('[demand-sourcing] team lookup failed: no demand this run');
    return null;
  }
  const members: DemandMember[] = [];
  const kept: MemberRow[] = [];
  for (const r of rows) {
    const payer = payers.get(r.id);
    // A suspended seat cannot use the app on the owner's account, so it steers nothing.
    if (payer?.suspended) continue;
    kept.push(r);
    members.push({ id: r.id, email: r.email, lastSeenAt: r.last_seen_at, payerId: payer?.payerId ?? r.id, paying: false, unitAreas: parseAboutYou(r.about_you)?.unitAreas ?? [], switchedOff: off.has(r.id) });
  }
  const paying = await payingNow(admin, [...new Set(members.map((m) => m.payerId))]);
  for (const m of members) m.paying = paying.has(m.payerId);

  const profiles: DemandProfile[] = [];
  const legacy: MemberRow[] = [];
  for (const r of kept) {
    const { seats, allPaused } = seatsFor(r.id, profileRows?.get(r.id));
    if (allPaused) continue;
    for (const seat of seats) {
      if (seat.profile) profiles.push({ memberId: r.id, profileId: seat.profile.id, goals: seat.profile.goals, areas: seat.profile.areas });
      else legacy.push(r);
    }
  }
  if (legacy.length > 0) {
    const saved = await savedAreasFor(admin, legacy.map((r) => r.id));
    for (const r of legacy) profiles.push({ memberId: r.id, profileId: null, goals: parseMarketGoals(r.market_goals), areas: saved.get(r.id) ?? [] });
  }
  return { members, profiles };
}

/** The demand list itself. Null when the members cannot be read. */
export async function loadDemand(admin: Admin, settings: DemandSettings, now: Date = new Date()): Promise<Demand | null> {
  const inputs = await loadDemandInputs(admin, settings, now);
  if (!inputs) return null;
  return buildDemand(inputs.members, inputs.profiles, { adminEmails: adminEmails(), activeDays: settings.activeDays, now, radiusAreas: settings.radiusAreas, maxAreasPerProfile: settings.maxAreasPerProfile });
}

/** What each area's card can screen: a revenue figure, and how thin the data behind it is. */
export function areaDataFrom(cards: readonly AreaCardData[]): Map<string, AreaData> {
  const out = new Map<string, AreaData>();
  for (const c of cards) {
    const screenable = (c.headline.grossRevenue ?? 0) > 0 || c.byBedrooms.some((b) => (b.grossRevenue ?? 0) > 0);
    out.set(c.code.toUpperCase(), { screenable, early: c.confidence.tier === 'early' });
  }
  return out;
}

/**
 * The areas the marketplace sweep covers, both kinds, from the same list
 * (and query limit) its passes use; none while its cron is switched off, so
 * demand is not left to nobody.
 */
export function sweepAreaSet(cards: readonly AreaCardData[]): Set<string> {
  return sweepEnabled() ? fullyCoveredAreas(sweepQueries([...cards], sweepAreaLimit(), sweepMaxQueries())) : new Set();
}

/**
 * How much members want each area, for the sweep's order (wanted areas go
 * first). Never throws: any failure gives an empty map, and the sweep then
 * keeps its score order, exactly as before this batch.
 */
export async function sweepDemandScores(now: Date = new Date()): Promise<Map<string, number>> {
  if (!hasServiceRole()) return new Map();
  try {
    const admin = createAdminClient();
    const settings = await readDemandSettings(admin);
    const demand = await loadDemand(admin, settings, now);
    return demand ? areaScores(demand, settings.payingWeight) : new Map();
  } catch (err) {
    console.warn('[demand-sourcing] demand scores for the sweep failed:', (err as Error)?.message ?? err);
    return new Map();
  }
}

// ── Claims, the month's spend and the search log (supabase/schema.sql, "Batch 15") ──

export interface MonthFigures {
  spentPence: number;
  openPence: number;
  searches: number;
  answered: number;
  newDeals: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The month's figures, summed in SQL. Null when unreadable, which is also how a missing schema shows. */
export async function monthFigures(admin: Admin, month: string): Promise<MonthFigures | null> {
  const { data, error } = await admin.rpc('demand_sourcing_month', { p: { month } });
  if (error || !data || typeof data !== 'object') {
    if (error) console.warn('[demand-sourcing] month figures unreadable (schema behind?):', error.message);
    return null;
  }
  const d = data as Record<string, unknown>;
  return { spentPence: num(d.spent_pence), openPence: num(d.open_pence), searches: num(d.searches), answered: num(d.answered), newDeals: num(d.new_deals) };
}

/** What this UK day's searches rule out until tomorrow: keys reserved or answered, and keys with no answer too often. Null when unreadable. */
export async function todaysSearches(admin: Admin, day: string): Promise<TodayKeys | null> {
  const { data, error } = await admin.from('demand_searches').select('query_key, status').eq('day', day);
  if (error) {
    console.warn('[demand-sourcing] today’s searches unreadable (schema behind?):', error.message);
    return null;
  }
  return summariseToday((data ?? []) as TodayRow[], MAX_NO_ANSWER_PER_DAY);
}

/** Marketplace answers still fresh in the broker's cache: asking again costs nothing. Keys only, never the listings. */
export async function cachedAnswerKeys(admin: Admin, now: Date = new Date()): Promise<Set<string>> {
  const { data, error } = await admin.from('broker_cache').select('key').eq('question', 'marketplaceListings').gt('expires_at', now.toISOString());
  if (error) {
    console.warn('[demand-sourcing] broker cache unreadable:', error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
}

export interface ClaimInput {
  month: string;
  day: string;
  area: string;
  kind: string;
  key: string;
  reservePence: number;
  capPence: number;
  actionId: string;
  runId: string;
  triggeredBy: string;
  members: number;
  payingMembers: number;
}

export type ClaimResult = { id: string; refused: null; spentPence: number } | { id: null; refused: 'cap' | 'duplicate' | 'error'; spentPence: number | null };

/**
 * Claims one search against the cap (demand_search_reserve). Fails closed:
 * any error — the schema not run yet, a bad row — is 'error', and the
 * caller searches nothing.
 */
export async function claimSearch(admin: Admin, c: ClaimInput): Promise<ClaimResult> {
  const { data, error } = await admin.rpc('demand_search_reserve', {
    p: {
      month: c.month,
      day: c.day,
      area: c.area,
      kind: c.kind,
      key: c.key,
      reserve_pence: c.reservePence,
      cap_pence: c.capPence,
      action_id: c.actionId,
      run_id: c.runId,
      triggered_by: c.triggeredBy,
      members: c.members,
      paying_members: c.payingMembers,
    },
  });
  if (error || !data || typeof data !== 'object') {
    console.error('[demand-sourcing] claim failed, searching nothing:', error?.message ?? 'no answer');
    return { id: null, refused: 'error', spentPence: null };
  }
  const d = data as { id?: unknown; refused?: unknown; spent_pence?: unknown };
  if (d.refused === 'cap' || d.refused === 'duplicate') return { id: null, refused: d.refused, spentPence: num(d.spent_pence) };
  if (typeof d.id === 'string' && d.id) return { id: d.id, refused: null, spentPence: num(d.spent_pence) };
  return { id: null, refused: 'error', spentPence: null };
}

export interface Settlement {
  status: 'answered' | 'unavailable' | 'failed';
  costPence: number;
  provider: string | null;
  cached: boolean | null;
  listings: number | null;
  newDeals: number | null;
}

/** Settles a claim to what the search did and cost. A claim is settled once. */
export async function settleSearch(admin: Admin, id: string, s: Settlement): Promise<void> {
  const { error } = await admin
    .from('demand_searches')
    .update({ status: s.status, cost_pence: s.costPence, provider: s.provider, cached: s.cached, listings: s.listings, new_deals: s.newDeals, settled_at: new Date().toISOString() })
    .eq('id', id)
    .is('settled_at', null);
  // Left open, the claim keeps counting at its reserve and the next pass closes it: the safe side.
  if (error) console.error('[demand-sourcing] settle failed (the claim stays at its reserve):', error.message);
}

/** Claims a dead pass left open: closed as failed, at their reserve. Returns how many. */
export async function closeStaleClaims(admin: Admin, olderThanMs: number, now: Date = new Date()): Promise<number> {
  const { data: open, error: readErr } = await admin
    .from('demand_searches')
    .select('id, reserve_pence')
    .is('settled_at', null)
    .lt('reserved_at', new Date(now.getTime() - olderThanMs).toISOString());
  if (readErr) return 0;
  let closed = 0;
  for (const r of (open ?? []) as { id: string; reserve_pence: unknown }[]) {
    const { error } = await admin.from('demand_searches').update({ status: 'failed', cost_pence: num(r.reserve_pence), settled_at: now.toISOString() }).eq('id', r.id).is('settled_at', null);
    if (!error) closed += 1;
  }
  return closed;
}

/** The provider calls the meter recorded for one search. Null when unreadable (the caller then settles at the reserve). */
export async function callRowsFor(admin: Admin, actionId: string): Promise<{ provider: string; unit: string | null; quantity: number | null; ok: boolean | null; cache_hit: boolean | null }[] | null> {
  const { data, error } = await admin.from('provider_calls').select('provider, unit, quantity, ok, cache_hit').eq('action_id', actionId);
  if (error) {
    console.warn('[demand-sourcing] provider calls unreadable:', error.message);
    return null;
  }
  return (data ?? []) as { provider: string; unit: string | null; quantity: number | null; ok: boolean | null; cache_hit: boolean | null }[];
}

/** One live pool row, as far as supply goes: never an address, a postcode, a link or a photo. */
export interface PoolRow {
  postcode_area: string | null;
  kind: string;
  raw_type: string | null;
  created_at: string;
}

/** Live deals (status live), paged past PostgREST's 1,000-row limit. Null when unreadable. */
export async function livePool(admin: Admin): Promise<PoolRow[] | null> {
  return poolRows(admin, (q) => q.eq('status', 'live'));
}

/** Every deal added to the pool since `sinceIso`, whatever its status now. Null when unreadable. */
export async function addedSince(admin: Admin, sinceIso: string): Promise<PoolRow[] | null> {
  return poolRows(admin, (q) => q.gte('created_at', sinceIso));
}

type PoolQuery = ReturnType<ReturnType<Admin['from']>['select']>;

async function poolRows(admin: Admin, where: (q: PoolQuery) => PoolQuery): Promise<PoolRow[] | null> {
  const out: PoolRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await where(admin.from('marketplace_deals').select('postcode_area, kind, raw_type, created_at'))
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[demand-sourcing] pool unreadable:', error.message);
      return null;
    }
    out.push(...((data ?? []) as PoolRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

/** The marketplace sweep's searches finished today (its pass records), for "searched today" on the admin page. */
export async function sweepDoneToday(admin: Admin, now: Date = new Date()): Promise<Set<string>> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { data, error } = await admin.from('marketplace_runs').select('started_at, doneKeys:summary->doneKeys').eq('kind', 'sweep').eq('dry', false).gte('started_at', dayStart);
  if (error) {
    console.warn('[demand-sourcing] sweep runs unreadable:', error.message);
    return new Set();
  }
  const runs: SweepRunRecord[] = ((data ?? []) as { started_at: string; doneKeys: unknown }[]).map((r) => ({ startedAt: r.started_at, doneKeys: r.doneKeys }));
  return sweepHistory(runs, now).doneToday;
}

export interface SearchLogRow {
  reserved_at: string;
  postcode_area: string;
  kind: string;
  status: string;
  provider: string | null;
  cached: boolean | null;
  cost_pence: number | null;
  reserve_pence: number;
  listings: number | null;
  new_deals: number | null;
  triggered_by: string;
}

/** The latest demand-led searches, newest first. Null when unreadable (the schema not run yet). */
export async function lastSearches(admin: Admin, limit: number): Promise<SearchLogRow[] | null> {
  const { data, error } = await admin
    .from('demand_searches')
    .select('reserved_at, postcode_area, kind, status, provider, cached, cost_pence, reserve_pence, listings, new_deals, triggered_by')
    .order('reserved_at', { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data ?? []) as SearchLogRow[];
}
