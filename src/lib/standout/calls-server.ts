import 'server-only';

/**
 * Batch 25: what Batch 23's call queue needs to know about a deal call.
 *
 *   dealFactsFor          how the calls, texts and emails name the deal
 *                         (copy.ts: town, bedrooms, kind, the rounded profit
 *                         range; never an address, a price or the listing)
 *   dealCallsThisMonth    deal calls placed this UK calendar month (answered
 *                         or not: every placed call counts)
 *   dealCallStillWanted   the last check before a queued deal call is dialled,
 *                         after Batch 23's own (hours, consent, owner, one
 *                         call a day, credit for a minute):
 *                           deal calls still switched on
 *                           still the SI's save: not opened, moved or "Not for me"
 *                           the primary profile still judged, and still showing this deal type
 *                           fewer than standout_calls_per_month deal calls placed this month
 *                           credit at or above standout_call_min_balance_pence
 *                           the listing seen live within standout_live_confirm_hours,
 *                           else rechecked now; gone → no call
 *
 * Every read that fails answers "don't call".
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { allProfilesFor } from '../profiles/server';
import { primaryOf, seatKey, type SavedProfile } from '../profiles/rules';
import { tailoringForSeats } from '../tailoring/server';
import { wantsFor } from '../tailoring/criteria';
import { dealTypesFor, type DealType } from '../profile/deal-types';
import { propertyKind } from '../listing/suitability';
import { serverFetchEnabled } from '../listing/fetch';
import type { ListingSource } from '../listing/types';
import { londonMonthStart } from '../sms/uk-time';
import type { BlockedReason } from '../voice/config';
import type { DealFacts } from '../voice/templates';
import type { CallRow } from '../voice/store-server';
import type { MemberFacts } from '../voice/member-server';
import { dealHeadline, dealShort, type DealDescription } from './copy';
import { chosenTypesOf, liveConfirmed, shownVerdict, type ChosenTypes, type ProfitBasis } from './rules';
import { recheckDeal } from './recheck';
import { dealCallsEnabled } from './flags';

type Admin = ReturnType<typeof createAdminClient>;

export interface DealCallFacts {
  decisionId: string;
  dealId: string;
  dealType: DealType | null;
  /** For texts and emails (templates.ts). */
  deal: DealFacts | null;
  /** The call's variables: deal_headline (spoken) and deal_short. */
  vars: { headline: string; short: string };
}

interface DecisionFacts {
  id: string;
  deal_id: string;
  deal_type: string | null;
  profit_low_pcm: number | null;
  profit_high_pcm: number | null;
  profit_basis: string | null;
  link_token: string | null;
  saved_at: string | null;
  not_for_me_at: string | null;
  opened_at: string | null;
  stage_moved_at: string | null;
}

const DECISION_COLUMNS = 'id, deal_id, deal_type, profit_low_pcm, profit_high_pcm, profit_basis, link_token, saved_at, not_for_me_at, opened_at, stage_moved_at';

async function savedDecision(admin: Admin, userId: string, dealId: string): Promise<DecisionFacts | null | 'error'> {
  const { data, error } = await admin.from('standout_decisions').select(DECISION_COLUMNS).eq('user_id', userId).eq('deal_id', dealId).not('saved_at', 'is', null).maybeSingle();
  if (error) {
    console.error('[standout] decision read failed:', error.message);
    return 'error';
  }
  return (data as DecisionFacts | null) ?? null;
}

interface DealPlace {
  id: string;
  status: string;
  source: string;
  town: string | null;
  postcode_area: string | null;
  bedrooms: number | null;
  raw_type: string | null;
  last_checked_live_at: string | null;
  last_confirmed_at: string | null;
}

async function dealPlace(admin: Admin, dealId: string): Promise<DealPlace | null | 'error'> {
  const { data, error } = await admin.from('marketplace_deals').select('id, status, source, town, postcode_area, bedrooms, raw_type, last_checked_live_at, last_confirmed_at').eq('id', dealId).maybeSingle();
  if (error) {
    console.error('[standout] deal read failed:', error.message);
    return 'error';
  }
  return (data as DealPlace | null) ?? null;
}

function describe(d: DecisionFacts, p: DealPlace): DealDescription {
  return {
    bedrooms: p.bedrooms,
    propertyKind: propertyKind(p.raw_type, null),
    dealType: (d.deal_type as DealType | null) ?? 'buy_str',
    town: p.town,
    postcodeArea: p.postcode_area,
    range: d.profit_low_pcm !== null && d.profit_high_pcm !== null ? { lowPcm: d.profit_low_pcm, highPcm: d.profit_high_pcm } : null,
    basis: (d.profit_basis as ProfitBasis | null) ?? 'range',
  };
}

function factsOf(d: DecisionFacts, p: DealPlace): DealCallFacts {
  const desc = describe(d, p);
  const short = dealShort(desc);
  return {
    decisionId: d.id,
    dealId: d.deal_id,
    dealType: (d.deal_type as DealType | null) ?? null,
    deal: d.link_token ? { short, headline: dealHeadline(desc, 'text'), token: d.link_token } : null,
    vars: { headline: dealHeadline(desc, 'speech'), short },
  };
}

/** How the calls, texts and emails name a deal saved for this member; null when it isn't one. */
export async function dealFactsFor(admin: Admin, userId: string, dealId: string): Promise<DealCallFacts | null> {
  const [d, p] = await Promise.all([savedDecision(admin, userId, dealId), dealPlace(admin, dealId)]);
  if (!d || d === 'error' || !p || p === 'error') return null;
  return factsOf(d, p);
}

/** The deal a deal call is about (its trigger_ref). */
export async function dealCallFacts(admin: Admin, call: Pick<CallRow, 'user_id' | 'trigger_ref' | 'call_type'>): Promise<DealCallFacts | null> {
  if (call.call_type !== 'deal' || !call.user_id || !call.trigger_ref) return null;
  return dealFactsFor(admin, call.user_id, call.trigger_ref);
}

/** Deal calls placed for this member this UK calendar month (any outcome). Null when unreadable. */
export async function dealCallsThisMonth(admin: Admin, userId: string, now: Date, exceptId: string | null = null): Promise<number | null> {
  const { data, error } = await admin.from('si_calls_log').select('id').eq('user_id', userId).eq('call_type', 'deal').not('placed_at', 'is', null).gte('uk_day', londonMonthStart(now));
  if (error) {
    console.error('[standout] deal calls unreadable:', error.message);
    return null;
  }
  return ((data ?? []) as { id: string }[]).filter((r) => r.id !== exceptId).length;
}

/** Whether the member's Keep on this deal is still the one Stayful Intelligence made. */
async function stillSiSave(admin: Admin, userId: string, dealId: string): Promise<boolean | null> {
  const { data, error } = await admin.from('deal_reactions').select('saved_by, reaction').eq('user_id', userId).eq('deal_id', dealId).maybeSingle();
  if (error) return null;
  const r = data as { saved_by: string | null; reaction: string } | null;
  return Boolean(r && r.reaction === 'keep' && r.saved_by);
}

/**
 * The deal types each member's primary profile shows now, or the reason it
 * is no longer judged at all (paused, for a client, waiting on answers, no
 * types). In bulk, for anything that tells members about saves some time
 * after they were made. Null when the profiles can't be read.
 */
export async function chosenTypesFor(admin: Admin, userIds: readonly string[], now: Date): Promise<Map<string, ChosenTypes> | null> {
  const out = new Map<string, ChosenTypes>();
  if (userIds.length === 0) return out;
  const profiles = await allProfilesFor(admin, userIds);
  if (!profiles) return null;
  const primary = new Map<string, SavedProfile>();
  for (const userId of userIds) {
    const p = pickPrimary(profiles.get(userId) ?? []);
    if (p) primary.set(userId, p);
    else out.set(userId, { blocked: 'profile_changed' });
  }
  const tailoring = await tailoringForSeats(admin, [...primary].map(([userId, p]) => ({ userId, profile: p, goals: p.goals, savedAreas: p.areas })), now);
  for (const [userId, p] of primary) {
    const t = tailoring.get(seatKey(userId, p.id)) ?? null;
    if (!t) continue; // unreadable for this member: absent, so nothing is told on a guess
    out.set(userId, chosenTypesOf({ primary: p, types: dealTypesFor({ goals: p.goals, about: t.about }), wants: wantsFor(t) }));
  }
  return out;
}

/** Batch 22's primary profile (the earliest live one), from rows already read: primaryProfileFor would create one. */
function pickPrimary(rows: readonly SavedProfile[]): SavedProfile | null {
  const id = primaryOf(rows);
  return rows.find((r) => r.id === id) ?? null;
}

/**
 * Whether the member's primary profile still shows this deal type and is
 * still judged (not paused, not for a client, its answers in): 'ok', the
 * reason it isn't, or null when it can't be read. For anything that tells a
 * member about a save some time after it was made.
 */
export async function stillShownFor(admin: Admin, userId: string, dealType: string | null, now: Date): Promise<'ok' | BlockedReason | null> {
  const chosen = (await chosenTypesFor(admin, [userId], now))?.get(userId);
  return chosen ? shownVerdict(chosen, dealType) : null;
}

export type StillWanted =
  | { ok: true; facts: DealCallFacts; recheck: 'fresh' | 'rechecked' | 'would_recheck' }
  | { ok: false; reason: BlockedReason }
  /** Couldn't tell (a read failed, the page couldn't be fetched): try again later, don't call now. */
  | { ok: false; wait: true; why: string };

/**
 * The deal-call checks, just before dialling (after Batch 23's eligibility).
 * With apply=false (the calls cron's dry run) nothing is rechecked or written.
 */
export async function dealCallStillWanted(admin: Admin, call: CallRow, m: MemberFacts, now: Date, o: { apply: boolean }): Promise<StillWanted> {
  const wait = (why: string): StillWanted => ({ ok: false, wait: true, why });
  if (!dealCallsEnabled()) return { ok: false, reason: 'deal_calls_off' };
  if (!call.trigger_ref) return { ok: false, reason: 'deal_gone' };
  const dealId = call.trigger_ref;
  const [d, place, siSave, settings] = await Promise.all([savedDecision(admin, m.userId, dealId), dealPlace(admin, dealId), stillSiSave(admin, m.userId, dealId), getBillingSettings()]);
  if (d === 'error' || place === 'error' || siSave === null) return wait('read failed');
  if (!d || !place) return { ok: false, reason: 'deal_gone' };
  // The member got there first: opened it, moved it, said "Not for me", or made the Keep their own.
  if (d.not_for_me_at || d.opened_at || d.stage_moved_at || !siSave) return { ok: false, reason: 'deal_acted' };

  const shown = await stillShownFor(admin, m.userId, d.deal_type, now);
  if (shown === null) return wait('profile unreadable');
  if (shown !== 'ok') return { ok: false, reason: shown };

  const s = settings.standout;
  const placed = await dealCallsThisMonth(admin, m.userId, now, call.id);
  if (placed === null) return wait('calls unreadable');
  if (placed >= s.callsPerMonth) return { ok: false, reason: 'monthly_limit' };
  if (m.balancePence < s.callMinBalancePence) return { ok: false, reason: 'below_floor' };

  if (place.status !== 'live') return { ok: false, reason: 'deal_gone' };
  const fetchable = serverFetchEnabled(place.source as ListingSource);
  if (liveConfirmed({ fetchable, lastCheckedLiveAt: place.last_checked_live_at, lastConfirmedAt: place.last_confirmed_at }, now, s.liveConfirmHours)) {
    return { ok: true, facts: factsOf(d, place), recheck: 'fresh' };
  }
  if (!o.apply) return { ok: true, facts: factsOf(d, place), recheck: 'would_recheck' };
  const r = await recheckDeal(admin, dealId, now);
  if (r.result === 'gone') return { ok: false, reason: 'deal_gone' };
  if (r.result === 'unknown') return wait('listing could not be checked');
  await admin.from('standout_decisions').update({ live_confirmed_at: r.confirmedAt, updated_at: now.toISOString() }).eq('id', d.id);
  return { ok: true, facts: factsOf(d, place), recheck: 'rechecked' };
}
