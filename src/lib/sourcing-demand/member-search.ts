import 'server-only';

/**
 * Batch 22, Part G: a member's own search.
 *
 *   signup (free)  queued when a new member's mandatory answers are done.
 *                  Layer 1 is Today's own choice worked out without storing
 *                  (previewToday): a strong match there and nothing is
 *                  searched. Layer 2 searches only the member's own
 *                  screenable areas whose stock of their kinds is thin or
 *                  stale, OnTheMarket first, PMI only where it stays thin,
 *                  then confirms the best finds live and gives the top few
 *                  Batch 16's income check, stopping at the first strong
 *                  match. Within signup_search_cap_pence raw, and the month's
 *                  signup_search_monthly_cap_pence.
 *   deep (paid)    started by the member: their areas plus nearby ones,
 *                  every kind they want, the income check on everything that
 *                  passes screening. Quoted "about £X, up to £Y" (raw ×
 *                  deep_search_markup, first one discounted); the "up to" is
 *                  reserved from their credit first; one debit at the end of
 *                  min(actual × markup × discount, up to), keyed on the
 *                  search id.
 *
 * Every paid step is claimed before it runs (member_search_claim) against
 * the search's cap and the month's ceiling, and trued up after with the
 * unrounded cost the meter recorded under the search's id. Provider calls
 * are house spend (userId null): the broker's per-member budgets never block
 * a member search. Off unless MEMBER_SEARCH_ENABLED=true (?dry=1 works
 * either way).
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { ask, memberListingsOtm, memberListingsPmi } from '../broker';
import { runMetered } from '../credit/context';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { unitKey } from '../credit/costs';
import { debit, release, reserve, actionAlreadyCharged } from '../credit/ledger';
import { payerFor } from '../team';
import { areaMetaForCode } from '../market/areas';
import { queryKey, type SourcingQuery, type SourcedListing } from '../listing/sourcing';
import { absorbListings, cohortLoader, emptyAbsorbCounters } from '../marketplace/absorb';
import { applyLiveResult, DEAL_COLUMNS, fetchDealPage, loadScreenContext, loadSourcedListings, revalidateDeals, type ScreenContext } from '../marketplace/server';
import type { DealRow } from '../marketplace/types';
import { checkDeal, claimBook } from '../deal-quality/checks-run';
import { readDealQualitySettings } from '../deal-quality/settings-server';
import { worstCasePence } from '../deal-quality/checks';
import { COST_PENCE } from '../broker/config';
import { profileAreas, kindsOf, type DemandKind } from './demand';
import { areaDataFrom, callRowsFor } from './server';
import { actualPence } from './cost';
import { deepAreas, isStrongMatch, planDeepSearch, planSignupSearch, pmiFollowUp, type AreaStock, type SearchStep } from './member-search-plan';
import { deepCharge, deepQuote, estimateRaw } from './member-search-quote';
import { nearestAreas, referencePoint } from '../today/candidates';
import { previewToday, refreshTodayAfterSearch, type MemberContext } from '../today/selection';
import { tailoringForMember } from '../tailoring/server';
import { usesTailoring } from '../tailoring/profile';
import { judgeRow } from '../tailoring/today';
import { wantsFor } from '../tailoring/criteria';
import { dealCardsByIds } from '../marketplace/queries';
import type { PoolRow } from '../today/candidates';
import { dealVisibilityFor } from '../marketplace/tier';
import { isAdminEmail } from '../admin';
import { primaryProfileFor } from '../profiles/server';
import { revealRowFor } from '../intelligence/reveal-server';
import { logActivity } from '../activity/log';
import { SEARCH_LEASE_MS, SEARCH_SLICE_MS } from '../intelligence/config';
import { isRevealAccount, type IntelligenceSettings } from '../intelligence/settings';

type Admin = ReturnType<typeof createAdminClient>;

export const MEMBER_SEARCH_ACTION = 'member-search';
export const DEEP_SEARCH_ACTION = 'deep_search';
/** Areas a member's own search covers at most (its own, before nearby). */
const MAX_OWN_AREAS = 6;
/** What one live confirmation is claimed at before it runs (trued up after). */
const CONFIRM_CLAIM_PENCE = 2;
const DEEP_RESERVE_MINUTES = 60;

export function memberSearchEnabled(): boolean {
  return process.env.MEMBER_SEARCH_ENABLED === 'true';
}

export interface SearchRow {
  id: string;
  user_id: string;
  payer_id: string | null;
  profile_id: string | null;
  purpose: 'signup' | 'deep';
  status: 'queued' | 'running' | 'done' | 'failed';
  plan: { steps: SearchStep[] } | null;
  cursor: { next: number; phase: 'search' | 'confirm' | 'finish' } | null;
  lease_until: string | null;
  cap_raw_pence: number;
  claimed_raw_pence: number;
  raw_pence: number;
  up_to_base_pence: number | null;
  discount_pct: number;
  first_discount: boolean;
  reservation_id: string | null;
  charged_base_pence: number;
  found: number;
  confirmed: number;
  stop_reason: string | null;
}

const SEARCH_COLUMNS = 'id, user_id, payer_id, profile_id, purpose, status, plan, cursor, lease_until, cap_raw_pence, claimed_raw_pence, raw_pence, up_to_base_pence, discount_pct, first_discount, reservation_id, charged_base_pence, found, confirmed, stop_reason';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function parseRow(r: Record<string, unknown> | null): SearchRow | null {
  if (!r || typeof r.id !== 'string') return null;
  return { ...(r as unknown as SearchRow), cap_raw_pence: n(r.cap_raw_pence), claimed_raw_pence: n(r.claimed_raw_pence), raw_pence: n(r.raw_pence), up_to_base_pence: r.up_to_base_pence === null ? null : n(r.up_to_base_pence), discount_pct: n(r.discount_pct), charged_base_pence: n(r.charged_base_pence), found: n(r.found), confirmed: n(r.confirmed) };
}

// ── The member, as Today sees them (primary profile) ──

async function memberFor(admin: Admin, userId: string, now: Date): Promise<{ member: MemberContext; email: string | null; roles: string[] } | null> {
  const [{ data: prof }, profile] = await Promise.all([admin.from('profiles').select('email, about_you').eq('id', userId).maybeSingle(), primaryProfileFor(userId)]);
  const email = (prof as { email?: string | null } | null)?.email ?? null;
  const [payer, visibility] = await Promise.all([payerFor(userId), dealVisibilityFor(userId, isAdminEmail(email))]);
  const goals = profile?.goals ?? null;
  const savedAreas = profile?.areas ?? [];
  const tailoring = await tailoringForMember(userId, profile, goals, savedAreas, now);
  const roles = ((prof as { about_you?: { roles?: unknown } } | null)?.about_you?.roles as string[] | undefined) ?? [];
  return { member: { userId, payerId: payer.payerId, goals, savedAreas, visibility, profileId: profile?.id ?? null, profileActive: profile?.isActive ?? true, tailoring }, email, roles };
}

/** Is today's best for this member already a strong match (no search needed / stop searching)? */
async function strongNow(member: MemberContext, s: Pick<IntelligenceSettings, 'strongMatchPct' | 'strongMatchMinChecked'>, now: Date): Promise<boolean> {
  if (!usesTailoring(member.tailoring) || !member.tailoring) return false;
  const preview = await previewToday(member, now);
  const topId = preview?.chosen.dealIds[0];
  if (!preview || !topId) return false;
  // Today's #1, judged as its card is: a tailored list only holds deals meeting every must-have unless it is a near miss.
  const [card] = await dealCardsByIds([topId], member.visibility);
  if (!card) return false;
  const j = judgeRow(card as PoolRow, member.tailoring, wantsFor(member.tailoring), now).judgement;
  const pct = j.checked > 0 ? (j.met / j.checked) * 100 : null;
  return isStrongMatch({ matchPct: pct, checks: j.checked, missedMustHave: preview.chosen.nearMiss || j.mustFails.length > 0 }, s);
}

// ── Queueing ──

/**
 * The signup search, queued once per member when their mandatory answers are
 * first done. Nothing when switched off; a second call finds the unique index.
 */
export async function queueSignupSearch(userId: string): Promise<string | null> {
  if (!memberSearchEnabled() || !hasServiceRole()) return null;
  const settings = (await getBillingSettings()).intelligence;
  // New members only (the reveal's own rule): an existing member finishing the quiz gets no search.
  const { data: p } = await createAdminClient().from('profiles').select('created_at').eq('id', userId).maybeSingle();
  if (!isRevealAccount((p as { created_at?: string } | null)?.created_at ?? null, settings)) return null;
  const profile = await primaryProfileFor(userId);
  const payer = await payerFor(userId);
  const { data, error } = await createAdminClient()
    .from('member_searches')
    .insert({ user_id: userId, payer_id: payer.payerId, profile_id: profile?.id ?? null, purpose: 'signup', status: 'queued', cap_raw_pence: settings.signupSearchCapPence })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code !== '23505') console.error('[member-search] queue failed:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

// ── Planning ──

async function areaStock(admin: Admin, ctx: ScreenContext, areas: readonly string[], kinds: readonly DemandKind[], questions: readonly string[]): Promise<AreaStock[]> {
  const data = areaDataFrom(ctx.cards);
  const out: AreaStock[] = [];
  const keys = areas.flatMap((a) => kinds.map((k) => ({ area: a, kind: k, key: queryKey(k, a, null, null, null) })));
  const { data: cache } = await admin.from('broker_cache').select('key, fetched_at').in('question', [...questions]).in('key', keys.map((k) => k.key));
  const fetched = new Map<string, string>();
  for (const r of (cache ?? []) as { key: string; fetched_at: string }[]) if (!fetched.has(r.key) || fetched.get(r.key)! < r.fetched_at) fetched.set(r.key, r.fetched_at);
  for (const k of keys) {
    const { count } = await admin.from('marketplace_deals').select('id', { count: 'exact', head: true }).eq('status', 'live').eq('kind', k.kind).eq('postcode_area', k.area);
    out.push({ area: k.area, kind: k.kind, screenable: data.get(k.area)?.screenable === true, live: count ?? 0, searchedAt: fetched.get(k.key) ?? null });
  }
  return out;
}

function areasOf(member: MemberContext, roles: string[]): { own: string[]; kinds: DemandKind[] } {
  if (!member.goals) return { own: [], kinds: [] };
  const own = profileAreas({ goals: member.goals, areas: member.savedAreas }, [], { radiusAreas: 4, maxAreasPerProfile: MAX_OWN_AREAS });
  return { own, kinds: kindsOf(member.goals, roles as never) };
}

// ── One slice ──

export interface SliceResult {
  id: string;
  status: SearchRow['status'];
  steps: number;
  found: number;
  stop: string | null;
}

/** Leases a queued or running search (or one whose lease ran out); null when another slice holds it. */
async function lease(admin: Admin, id: string, now: Date): Promise<SearchRow | null> {
  const until = new Date(now.getTime() + SEARCH_LEASE_MS).toISOString();
  const { data, error } = await admin
    .from('member_searches')
    .update({ lease_until: until, status: 'running', started_at: now.toISOString() })
    .eq('id', id)
    .in('status', ['queued', 'running'])
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select(SEARCH_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error('[member-search] lease failed:', error.message);
    return null;
  }
  return parseRow(data as Record<string, unknown> | null);
}

async function claim(admin: Admin, id: string, pence: number): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await admin.rpc('member_search_claim', { p: { search_id: id, pence } });
  if (error) {
    console.error('[member-search] claim failed:', error.message);
    return { ok: false, reason: 'error' };
  }
  const r = data as { ok?: boolean; reason?: string } | null;
  return { ok: r?.ok === true, reason: r?.reason };
}

/**
 * Swaps a step's claim for what it actually cost: the calls the meter has
 * recorded under the search's own id since the last true-up (`metered` holds
 * that running total; income checks are metered under their own ids and
 * trued up from their own result).
 */
async function trueUp(admin: Admin, row: SearchRow, claimed: number, unitCostOf: (p: string, u: string) => number | null, metered: { total: number }): Promise<number> {
  const calls = await callRowsFor(admin, row.id);
  const total = calls === null ? metered.total + claimed : actualPence(calls, unitCostOf);
  const step = Math.max(0, Math.round((total - metered.total) * 10_000) / 10_000);
  metered.total = Math.max(metered.total, total);
  const { data, error } = await admin.rpc('member_search_true_up', { p: { search_id: row.id, claimed, actual: step } });
  if (error) console.error('[member-search] true-up failed:', error.message);
  const raw = (data as { raw?: number } | null)?.raw;
  row.raw_pence = typeof raw === 'number' ? raw : row.raw_pence + step;
  return step;
}

async function save(admin: Admin, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('member_searches').update(patch).eq('id', id);
  if (error) console.error('[member-search] save failed:', error.message);
}

/** Records the deals a step inserted as this search's finds (one finder per deal). */
async function recordFinds(admin: Admin, row: SearchRow, urls: readonly string[]): Promise<number> {
  if (urls.length === 0) return 0;
  const { data } = await admin.from('marketplace_deals').select('id').in('canonical_url', [...urls]);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { data: ins, error } = await admin
    .from('member_search_finds')
    .upsert(ids.map((deal_id) => ({ search_id: row.id, user_id: row.user_id, deal_id })), { onConflict: 'deal_id', ignoreDuplicates: true })
    .select('deal_id');
  if (error) console.error('[member-search] finds failed:', error.message);
  return ins?.length ?? 0;
}

async function findRows(admin: Admin, searchId: string): Promise<{ deal_id: string; confirmed_at: string | null; checked_at: string | null }[]> {
  const { data } = await admin.from('member_search_finds').select('deal_id, confirmed_at, checked_at').eq('search_id', searchId);
  return (data ?? []) as { deal_id: string; confirmed_at: string | null; checked_at: string | null }[];
}

/**
 * Runs as much of one search as fits before `deadlineMs`: the search steps,
 * then the income checks and live confirmations, then the finish (today's
 * list refreshed; a deep search charged). Picked up where it stopped by the
 * next slice (the cron, or another kick).
 */
export async function runSearchSlice(id: string, opts: { deadlineMs?: number; now?: Date } = {}): Promise<SliceResult | null> {
  if (!hasServiceRole()) return null;
  const started = Date.now();
  const deadline = started + (opts.deadlineMs ?? SEARCH_SLICE_MS);
  const now = opts.now ?? new Date();
  const admin = createAdminClient();
  const row = await lease(admin, id, now);
  if (!row) return null;
  const result: SliceResult = { id, status: 'running', steps: 0, found: row.found, stop: null };
  const settings = (await getBillingSettings()).intelligence;
  const who = await memberFor(admin, row.user_id, now);
  if (!who) {
    await save(admin, id, { status: 'failed', stop_reason: 'member', finished_at: new Date().toISOString(), lease_until: null });
    return { ...result, status: 'failed', stop: 'member' };
  }
  const ctx = await loadScreenContext(Math.max(1000, Math.min(10_000, deadline - Date.now())));
  if (!ctx) return { ...result, stop: 'snapshot' };
  const table = await getUnitCostTable();
  const unitCostOf = (p: string, u: string) => table.get(unitKey(p, u))?.unitCostPence ?? null;
  const cursor = row.cursor ?? { next: 0, phase: 'search' as const };
  // What the meter had recorded under this search's id before this slice.
  const before = await callRowsFor(admin, id);
  const metered = { total: before === null ? 0 : actualPence(before, unitCostOf) };

  // Plan once.
  if (!row.plan) {
    if (row.purpose === 'signup' && (await strongNow(who.member, settings, now))) {
      await finish(admin, row, who.member, settings, 'strong_layer1', now);
      return { ...result, status: 'done', stop: 'strong_layer1' };
    }
    const { own, kinds } = areasOf(who.member, who.roles);
    let steps: SearchStep[];
    if (row.purpose === 'signup') {
      const stock = await areaStock(admin, ctx, own, kinds, ['marketplaceListings', 'memberListingsOtm', 'memberListingsPmi']);
      steps = planSignupSearch(stock, { thinStock: settings.signupThinStock, freshHours: settings.signupSearchFreshHours, now });
    } else {
      const ref = referencePoint(who.member.goals, own);
      const nearby = nearestAreas(ref, new Set(own), settings.deepSearchNearbyAreas);
      const otm = planDeepSearch(deepAreas(own, nearby, settings.deepSearchNearbyAreas), kinds);
      steps = [...otm, ...otm.map((s) => ({ ...s, source: 'pmi' as const }))];
    }
    row.plan = { steps };
    await save(admin, id, { plan: row.plan, cursor });
    if (steps.length === 0) {
      await finish(admin, row, who.member, settings, 'nothing_to_search', now);
      return { ...result, status: 'done', stop: 'nothing_to_search' };
    }
  }

  const steps = row.plan.steps;
  const cohorts = cohortLoader(admin, { buy: false, maxBuys: 0, action: MEMBER_SEARCH_ACTION, tag: 'member-search' });
  // ── Search ──
  while (cursor.phase === 'search' && cursor.next < steps.length) {
    if (Date.now() > deadline) return { ...result, stop: 'time' };
    const step = steps[cursor.next];
    const cost = step.source === 'pmi' ? unitCostOf('pmi', 'listings') ?? COST_PENCE.pmiListings : unitCostOf('onthemarket', 'search_page') ?? 0.2;
    const c = await claim(admin, id, cost);
    if (!c.ok) {
      result.stop = c.reason ?? 'cap';
      cursor.phase = 'confirm';
      break;
    }
    const meta = areaMetaForCode(step.area);
    const query: SourcingQuery = { key: queryKey(step.kind, step.area, null, null, null), kind: step.kind, area: step.area, areaName: meta.name, areaSlug: meta.slug, minPrice: null, maxPrice: null, minBedrooms: null };
    const out = { inserted: [] as string[] };
    try {
      const res = await runMetered({ userId: null, admin: false, action: MEMBER_SEARCH_ACTION, actionId: id }, () => ask(step.source === 'pmi' ? memberListingsPmi : memberListingsOtm, query, { mode: 'cron' }));
      if (res.value && !res.stale && res.value.length > 0) {
        await cohorts.loadFor(step.area);
        await absorbListings(admin, ctx.cardByCode, ctx.rentTable, ctx.r2rBar, cohorts.index, query, res.value, emptyAbsorbCounters(), 'member-search', ctx.rules, out);
      }
    } catch (err) {
      console.error('[member-search] step failed:', query.key, (err as Error)?.message ?? err);
    }
    await trueUp(admin, row, cost, unitCostOf, metered);
    const added = await recordFinds(admin, row, out.inserted);
    row.found += added;
    result.found = row.found;
    result.steps += 1;
    cursor.next += 1;
    // Signup: PMI only where the area stays thin after OnTheMarket.
    if (row.purpose === 'signup') {
      const { count } = await admin.from('marketplace_deals').select('id', { count: 'exact', head: true }).eq('status', 'live').eq('kind', step.kind).eq('postcode_area', step.area);
      const follow = pmiFollowUp(step, count ?? 0, settings.signupThinStock);
      if (follow) steps.splice(cursor.next, 0, follow);
    }
    await save(admin, id, { plan: { steps }, cursor, found: row.found, lease_until: new Date(Date.now() + SEARCH_LEASE_MS).toISOString() });
    if (row.purpose === 'signup' && added > 0 && (await strongNow(who.member, settings, now))) {
      result.stop = 'strong';
      cursor.phase = 'confirm';
    }
  }
  if (cursor.phase === 'search') cursor.phase = 'confirm';

  // ── Income checks and live confirmations ──
  if (cursor.phase === 'confirm') {
    const done = await confirmFinds(admin, row, ctx, settings, deadline, unitCostOf, metered);
    await save(admin, id, { cursor, confirmed: row.confirmed });
    if (!done) return { ...result, stop: result.stop ?? 'time' };
    cursor.phase = 'finish';
  }
  await finish(admin, row, who.member, settings, result.stop ?? 'done', now);
  return { ...result, status: 'done' };
}

/**
 * The finds' income checks (Batch 16's checkDeal: a deal on the shortlist
 * waits for its own comparables) and live confirmations (a page read, as the
 * recheck does), best first, within the search's cap. A signup search does
 * at most signup_income_checks_max checks and signup_confirm_live_max reads;
 * a deep search, every find. Returns false when out of time.
 */
async function confirmFinds(admin: Admin, row: SearchRow, ctx: ScreenContext, s: IntelligenceSettings, deadline: number, unitCostOf: (p: string, u: string) => number | null, metered: { total: number }): Promise<boolean> {
  const finds = await findRows(admin, row.id);
  const open = finds.filter((f) => !f.confirmed_at);
  if (open.length === 0) return true;
  const { data } = await admin.from('marketplace_deals').select(DEAL_COLUMNS).in('id', open.map((f) => f.deal_id)).order('annual_profit', { ascending: false, nullsFirst: false });
  const deals = (data ?? []) as unknown as DealRow[];
  const listings = await loadSourcedListings(admin, deals.map((d) => d.canonical_url));
  const dq = await readDealQualitySettings(admin);
  let checks = row.purpose === 'signup' ? s.signupIncomeChecksMax : Number.POSITIVE_INFINITY;
  let reads = row.purpose === 'signup' ? s.signupConfirmLiveMax : Number.POSITIVE_INFINITY;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: lastHour } = await admin.from('member_search_finds').select('deal_id', { count: 'exact', head: true }).gte('confirmed_at', hourAgo);
  let hourLeft = Math.max(0, s.memberSearchConfirmsPerHour - (lastHour ?? 0));
  const nowIso = () => new Date().toISOString();

  for (const deal of deals) {
    if (Date.now() > deadline) return false;
    const found = listings.get(deal.canonical_url);
    if (!found) continue;
    let current: DealRow | null = deal;
    // Income check first: a shortlisted deal is only shown once its own comparables say so.
    if (current.status === 'pending_check' && checks > 0) {
      const worst = worstCasePence(dq.checks, COST_PENCE.airbticsBounds, found.listing.lat === null);
      const c = await claim(admin, row.id, worst);
      if (!c.ok) break;
      const book = claimBook(worst, 0);
      const r = await checkDeal(current, found.listing, { admin, ctx, settings: dq, via: 'daily', action: MEMBER_SEARCH_ACTION, tag: 'member-search', claim: book.claim, release: book.release, now: new Date() });
      const { error: trErr } = await admin.rpc('member_search_true_up', { p: { search_id: row.id, claimed: worst, actual: r.pence } });
      if (trErr) console.error('[member-search] check true-up failed:', trErr.message);
      row.raw_pence += r.pence;
      checks -= 1;
      await admin.from('member_search_finds').update({ checked_at: nowIso() }).eq('deal_id', deal.id);
      const { data: again } = await admin.from('marketplace_deals').select(DEAL_COLUMNS).eq('id', deal.id).maybeSingle();
      current = (again as unknown as DealRow | null) ?? null;
    }
    if (!current) continue;
    if (current.status === 'pending_verify' && reads > 0 && hourLeft > 0) {
      const c = await claim(admin, row.id, CONFIRM_CLAIM_PENCE);
      if (!c.ok) break;
      try {
        const res = await runMetered({ userId: null, admin: false, action: MEMBER_SEARCH_ACTION, actionId: row.id }, () => fetchDealPage(current!));
        if (res) {
          const live = await applyLiveResult(admin, current, found.listing as SourcedListing, res, ctx);
          if (live.kind === 'live') {
            await admin.from('member_search_finds').update({ confirmed_at: nowIso() }).eq('deal_id', deal.id);
            row.confirmed += 1;
          }
        }
      } catch (err) {
        console.error('[member-search] live read failed:', (err as Error)?.message ?? err);
      }
      await trueUp(admin, row, CONFIRM_CLAIM_PENCE, unitCostOf, metered);
      reads -= 1;
      hourLeft -= 1;
    } else if (current.status === 'live') {
      await admin.from('member_search_finds').update({ confirmed_at: nowIso() }).eq('deal_id', deal.id).is('confirmed_at', null);
      row.confirmed += 1;
    }
  }
  return true;
}

/**
 * Done: today's list takes the finds that beat its unanswered, un-revealed
 * cards; a deep search is charged (once, keyed on its id) and its
 * reservation released.
 */
async function finish(admin: Admin, row: SearchRow, member: MemberContext, s: IntelligenceSettings, stop: string, now: Date): Promise<void> {
  const finds = await findRows(admin, row.id);
  const { data: liveRows } = finds.length ? await admin.from('marketplace_deals').select('id').in('id', finds.map((f) => f.deal_id)).eq('status', 'live') : { data: [] };
  const live = ((liveRows ?? []) as { id: string }[]).map((r) => r.id);
  if (live.length > 0) {
    const reveal = await revealRowFor(row.user_id);
    await refreshTodayAfterSearch(member, live, reveal?.dealIds ?? [], now).catch((err) => console.error('[member-search] refresh failed:', err));
    revalidateDeals();
  }
  const patch: Record<string, unknown> = { status: 'done', stop_reason: stop, finished_at: new Date().toISOString(), lease_until: null, cursor: { next: 0, phase: 'finish' } };
  if (row.purpose === 'deep') Object.assign(patch, await chargeDeep(admin, row, s));
  await save(admin, row.id, patch);
  if (row.purpose === 'signup') await admin.from('signup_reveals').update({ search_id: row.id, layer: live.length > 0 ? 2 : null }).eq('user_id', row.user_id);
}

async function chargeDeep(admin: Admin, row: SearchRow, s: IntelligenceSettings): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const payer = row.payer_id ?? row.user_id;
    const base = deepCharge(row.raw_pence, { upToBasePence: row.up_to_base_pence ?? 0, discountPct: row.discount_pct }, s.deepSearchMarkup);
    if (base > 0 && !(await actionAlreadyCharged(row.id))) {
      const tx = await debit(payer, base, { reservationId: row.reservation_id, meta: { action_id: row.id, action: DEEP_SEARCH_ACTION, description: 'Deep search of your areas', raw_cost_pence: row.raw_pence } });
      out.transaction_id = tx;
      out.charged_base_pence = base;
      // Batch 23 (bug 3): the low-balance emails, auto top-up and the low-credit call follow this debit too.
      void import('../credit/after-debit').then((m) => m.afterDebit(payer)).catch(() => {});
    }
  } catch (err) {
    console.error('[member-search] deep charge failed:', (err as Error)?.message ?? err);
  } finally {
    await release(row.reservation_id).catch(() => {});
  }
  return out;
}

// ── The deep search: quote and start ──

export interface DeepQuoteView {
  aboutBasePence: number;
  upToBasePence: number;
  discountPct: number;
  firstDiscount: boolean;
  areas: string[];
}

async function firstDeepSearchUsed(admin: Admin, payerId: string): Promise<boolean> {
  const { data, error } = await admin.from('member_searches').select('id').eq('payer_id', payerId).eq('first_discount', true).or('status.in.(queued,running),charged_base_pence.gt.0').limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

/** "About £X, up to £Y" for this member's deep search now. Null when it can't be offered (no areas, switched off). */
export async function deepQuoteFor(userId: string, now: Date = new Date()): Promise<DeepQuoteView | null> {
  if (!memberSearchEnabled() || !hasServiceRole()) return null;
  const admin = createAdminClient();
  const who = await memberFor(admin, userId, now);
  if (!who) return null;
  const s = (await getBillingSettings()).intelligence;
  const { own, kinds } = areasOf(who.member, who.roles);
  if (own.length === 0 || kinds.length === 0) return null;
  const nearby = nearestAreas(referencePoint(who.member.goals, own), new Set(own), s.deepSearchNearbyAreas);
  const areas = deepAreas(own, nearby, s.deepSearchNearbyAreas);
  const otm = planDeepSearch(areas, kinds);
  const table = await getUnitCostTable();
  const unit = { onthemarket: table.get(unitKey('onthemarket', 'search_page'))?.unitCostPence ?? 0.2, pmi: table.get(unitKey('pmi', 'listings'))?.unitCostPence ?? COST_PENCE.pmiListings };
  const estimate = estimateRaw([...otm, ...otm.map((x) => ({ ...x, source: 'pmi' as const }))], unit, Math.min(6, areas.length * 2), COST_PENCE.airbticsBounds);
  const first = !(await firstDeepSearchUsed(admin, who.member.payerId));
  const q = deepQuote({ estimateRawPence: estimate, maxRawPence: s.deepSearchMaxRawPence, markup: s.deepSearchMarkup, discountPct: first ? s.deepSearchFirstDiscountPct : 0 });
  return { aboutBasePence: q.aboutBasePence, upToBasePence: q.upToBasePence, discountPct: q.discountPct, firstDiscount: first, areas };
}

export type DeepStart = { ok: true; id: string } | { ok: false; reason: 'off' | 'busy' | 'credit' | 'quote_changed' | 'failed' };

/**
 * Starts a deep search at the quote the member saw: re-quoted here (never
 * trusted from the page), the "up to" reserved from their credit first —
 * whatever the enforcement setting — and one search at a time.
 */
export async function startDeepSearch(userId: string, seenUpToBasePence: number, now: Date = new Date()): Promise<DeepStart> {
  const q = await deepQuoteFor(userId, now);
  if (!q) return { ok: false, reason: 'off' };
  if (Math.abs(q.upToBasePence - seenUpToBasePence) > 0.5) return { ok: false, reason: 'quote_changed' };
  const admin = createAdminClient();
  const payer = await payerFor(userId);
  const s = (await getBillingSettings()).intelligence;
  const profile = await primaryProfileFor(userId);
  const { data, error } = await admin
    .from('member_searches')
    .insert({ user_id: userId, payer_id: payer.payerId, profile_id: profile?.id ?? null, purpose: 'deep', status: 'queued', cap_raw_pence: s.deepSearchMaxRawPence, about_base_pence: q.aboutBasePence, up_to_base_pence: q.upToBasePence, discount_pct: q.discountPct, first_discount: q.firstDiscount })
    .select('id')
    .maybeSingle();
  if (error || !data) return { ok: false, reason: error?.code === '23505' ? 'busy' : 'failed' };
  const id = (data as { id: string }).id;
  try {
    const reservationId = await reserve(payer.payerId, DEEP_SEARCH_ACTION, id, q.upToBasePence, DEEP_RESERVE_MINUTES);
    if (!reservationId && q.upToBasePence > 0) throw new Error('no reservation');
    await save(admin, id, { reservation_id: reservationId });
  } catch {
    await save(admin, id, { status: 'failed', stop_reason: 'credit', finished_at: new Date().toISOString() });
    return { ok: false, reason: 'credit' };
  }
  logActivity(userId, 'deep_search_run', { extras: { search: id, upTo: q.upToBasePence, first: q.firstDiscount } });
  return { ok: true, id };
}

// ── The cron and the status poll ──

/** Continues or settles every search left over (the cron). `dry`: lists them, runs nothing. */
export async function runDueSearches(opts: { dry: boolean; deadlineMs: number }): Promise<{ enabled: boolean; due: number; ran: SliceResult[] }> {
  if (!hasServiceRole()) return { enabled: memberSearchEnabled(), due: 0, ran: [] };
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data } = await admin.from('member_searches').select('id').in('status', ['queued', 'running']).or(`lease_until.is.null,lease_until.lt.${nowIso}`).order('created_at', { ascending: true }).limit(20);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (opts.dry || !memberSearchEnabled()) return { enabled: memberSearchEnabled(), due: ids.length, ran: [] };
  const started = Date.now();
  const ran: SliceResult[] = [];
  for (const id of ids) {
    const left = opts.deadlineMs - (Date.now() - started);
    if (left < 5_000) break;
    const r = await runSearchSlice(id, { deadlineMs: left });
    if (r) ran.push(r);
  }
  return { enabled: true, due: ids.length, ran };
}

/** What the view shows while a member's search runs: "I'm still checking your areas". */
export async function searchStatusFor(userId: string): Promise<{ running: boolean; purpose: 'signup' | 'deep' | null; found: number; finds: string[] }> {
  if (!hasServiceRole()) return { running: false, purpose: null, found: 0, finds: [] };
  const admin = createAdminClient();
  const { data } = await admin.from('member_searches').select('id, purpose, status, found').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  const r = (data ?? [])[0] as { id: string; purpose: 'signup' | 'deep'; status: string; found: number } | undefined;
  if (!r) return { running: false, purpose: null, found: 0, finds: [] };
  const finds = (await findRows(admin, r.id)).filter((f) => f.confirmed_at).map((f) => f.deal_id);
  return { running: r.status === 'queued' || r.status === 'running', purpose: r.purpose, found: n(r.found), finds };
}
