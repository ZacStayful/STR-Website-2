import 'server-only';

/**
 * A paid open: the member asks to see a deal's address, photos and listing
 * link. VERIFY BEFORE CHARGE — the page is read first (or a check from the
 * last six hours reused), and only a listing still on the market is charged
 * and unlocked. A listing that has just gone is retired on the spot and the
 * member sees "just gone", charged nothing.
 *
 * The deal_opens row is inserted as `pending` BEFORE the debit and flipped to
 * `open` after it, with the row id as the ledger's action_id: a crash between
 * the two is recovered by actionAlreadyCharged rather than charged twice.
 * Admins are never charged (and get no transaction). Shadow credit mode is
 * honoured the way the picks run does it: the balance pre-check applies only
 * when enforcing; the debit itself is allowed to go negative to cover the
 * race between the check and the charge.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBalance, debit, refund, actionAlreadyCharged, InsufficientCreditError } from '../credit/ledger';
import { isEnforcing } from '../credit/http';
import { afterDebit } from '../credit/after-debit';
import { getBillingSettings } from '../credit/unit-costs';
import { runMetered } from '../credit/context';
import { serverFetchEnabled } from '../listing/fetch';
import { postcodeAreaOf } from '../listing/normalise';
import { openPricePence } from './ladder';
import { openDecision, hasRecentLiveCheck, type FetchOutcome } from './status';
import { retiredReasonFor } from './status';
import { applyLiveResult, fetchDealPage, loadDealById, loadScreenContext, loadSourcedListings, revalidateDeals, type Admin } from './server';
import { snapshotFromDeal } from './record';
import type { DealOpenRow, DealRow, VerifiedVia } from './types';
import type { ListingSnapshot } from '../listing/types';

/** Fetch-backed opens one member may make in an hour: enough to browse, not enough to trip the shared breaker. */
export const OPENS_WITH_FETCH_PER_HOUR = 20;

export type OpenOutcome =
  | { ok: true; alreadyOpen: boolean; verifiedVia: VerifiedVia | null; chargedBasePence: number }
  | { ok: false; code: 'missing' | 'gone' | 'just_gone' | 'checking' | 'insufficient_credit' | 'rate_limited' | 'failed'; requiredPence?: number; availablePence?: number };

const OPEN_COLUMNS = 'id, user_id, canonical_url, deal_id, status, opened_at, charged_base_pence, transaction_id, verified_via, status_at_open, band_at_open, annual_profit_at_open, checked_listing_id, saved_at, fetched';

async function existingOpen(admin: Admin, userId: string, canonicalUrl: string): Promise<DealOpenRow | null> {
  const { data } = await admin.from('deal_opens').select(OPEN_COLUMNS).eq('user_id', userId).eq('canonical_url', canonicalUrl).maybeSingle();
  return (data as DealOpenRow | null) ?? null;
}

async function flipToOpen(admin: Admin, row: DealOpenRow, transactionId: number | null): Promise<boolean> {
  const { error } = await admin.from('deal_opens').update({ status: 'open', transaction_id: transactionId }).eq('id', row.id);
  if (error) console.error('[marketplace] open flip failed:', error.message);
  return !error;
}

export async function openDeal(input: { userId: string; adminUser: boolean; dealId: string }): Promise<OpenOutcome> {
  if (!hasServiceRole()) return { ok: false, code: 'failed' };
  const admin = createAdminClient();
  const now = new Date();
  const deal = await loadDealById(admin, input.dealId);
  if (!deal) return { ok: false, code: 'missing' };

  // ── Already theirs? Free forever, even after it has gone. ──
  const existing = await existingOpen(admin, input.userId, deal.canonical_url);
  if (existing?.status === 'open') return { ok: true, alreadyOpen: true, verifiedVia: existing.verified_via, chargedBasePence: Number(existing.charged_base_pence) };
  if (existing?.status === 'pending') {
    // Crash recovery: the debit may have gone through before the flip.
    if (input.adminUser || (await actionAlreadyCharged(existing.id))) {
      await flipToOpen(admin, existing, existing.transaction_id);
      return { ok: true, alreadyOpen: true, verifiedVia: existing.verified_via, chargedBasePence: Number(existing.charged_base_pence) };
    }
  }
  if (deal.status === 'retired') return { ok: false, code: 'gone' };
  if (deal.status === 'pending_verify') return { ok: false, code: 'checking' };

  // ── Price and balance, before any fetch ──
  const settings = await getBillingSettings();
  const pence = input.adminUser ? 0 : openPricePence(deal.annual_profit === null ? null : Number(deal.annual_profit), settings.dealOpenLadder);
  if (pence > 0 && isEnforcing()) {
    const bal = await getBalance(input.userId).catch(() => null);
    if (!bal || bal.spendableBasePence < pence) return { ok: false, code: 'insufficient_credit', requiredPence: pence, availablePence: Math.max(0, Math.round(bal?.spendableBasePence ?? 0)) };
  }

  // ── Verify ──
  const fetchable = serverFetchEnabled(deal.source);
  let fetch: FetchOutcome | null = null;
  let status: ListingSnapshot['status'] | null = null;
  let fetched = false;
  let verifiedDeal: DealRow = deal;
  if (fetchable && !hasRecentLiveCheck(deal.last_checked_live_at, now)) {
    // The member's own fetch cap protects the portal breaker everyone shares.
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { count } = await admin.from('deal_opens').select('id', { count: 'exact', head: true }).eq('user_id', input.userId).eq('fetched', true).gte('opened_at', hourAgo);
    if ((count ?? 0) >= OPENS_WITH_FETCH_PER_HOUR && !input.adminUser) return { ok: false, code: 'rate_limited' };
    const ctx = await loadScreenContext(10_000);
    const sourced = (await loadSourcedListings(admin, [deal.canonical_url])).get(deal.canonical_url);
    if (ctx && sourced) {
      fetched = true;
      const res = await runMetered({ userId: null, admin: false, action: 'deal_open_verify', actionId: existing?.id ?? crypto.randomUUID() }, () => fetchDealPage(deal));
      if (res === null) {
        fetch = 'unavailable';
      } else if (!res.ok) {
        fetch = res.code === 'not_found' ? 'not_found' : 'unavailable';
        // Record the failure the same way the recheck would (retire on not_found, back off otherwise).
        const outcome = await applyLiveResult(admin, deal, sourced.listing, res, ctx, now);
        if (outcome.kind === 'retired') fetch = 'ok_gone';
      } else {
        status = res.snapshot.status ?? null;
        const outcome = await applyLiveResult(admin, deal, sourced.listing, res, ctx, now);
        if (outcome.kind === 'retired') {
          fetch = 'ok_gone';
          status = (retiredReasonFor(status) ? status : null) as ListingSnapshot['status'] | null;
        } else if (outcome.kind === 'live') {
          fetch = 'ok_live';
          verifiedDeal = outcome.deal;
        } else {
          fetch = 'unavailable';
        }
      }
    }
  }
  const decision = openDecision({ fetchable, fetch, status, lastCheckedLiveAt: deal.last_checked_live_at, lastConfirmedAt: deal.last_confirmed_at, now });
  if (decision.kind === 'just_gone') {
    revalidateDeals();
    return { ok: false, code: 'just_gone' };
  }
  if (decision.kind === 'checking') {
    const { error } = await admin.from('marketplace_deals').update({ check_requested_at: now.toISOString(), next_check_due_at: now.toISOString(), updated_at: now.toISOString() }).eq('canonical_url', deal.canonical_url);
    if (error) console.error('[marketplace] check request failed:', error.message);
    return { ok: false, code: 'checking' };
  }

  // ── Insert pending, debit, flip ──
  let row = existing;
  if (!row) {
    const insert = {
      user_id: input.userId,
      canonical_url: deal.canonical_url,
      deal_id: deal.id,
      status: 'pending',
      charged_base_pence: pence,
      verified_via: input.adminUser ? 'admin' : decision.verifiedVia,
      status_at_open: 'available',
      band_at_open: verifiedDeal.band,
      annual_profit_at_open: verifiedDeal.annual_profit,
      fetched,
    };
    const { data, error } = await admin.from('deal_opens').insert(insert).select(OPEN_COLUMNS).single();
    if (error) {
      if (error.code === '23505') {
        // Double submit: the other request owns the row; read it back and follow the same path.
        const again = await existingOpen(admin, input.userId, deal.canonical_url);
        if (again?.status === 'open') return { ok: true, alreadyOpen: true, verifiedVia: again.verified_via, chargedBasePence: Number(again.charged_base_pence) };
        return { ok: false, code: 'failed' };
      }
      console.error('[marketplace] open insert failed:', error.message);
      return { ok: false, code: 'failed' };
    }
    row = data as DealOpenRow;
  } else {
    const { error } = await admin.from('deal_opens').update({ charged_base_pence: pence, verified_via: input.adminUser ? 'admin' : decision.verifiedVia, band_at_open: verifiedDeal.band, annual_profit_at_open: verifiedDeal.annual_profit, fetched: row.fetched || fetched, opened_at: now.toISOString() }).eq('id', row.id);
    if (error) console.error('[marketplace] pending refresh failed:', error.message);
  }

  let transactionId: number | null = null;
  if (pence > 0) {
    try {
      transactionId = await debit(input.userId, pence, {
        allowNegative: true,
        meta: { action: 'deal_open', action_id: row.id, provider: 'marketplace', unit: 'deal_open', quantity: 1, unit_cost_pence: 0, markup: 1, raw_cost_pence: 0, description: `Deal sheet: ${[verifiedDeal.town, verifiedDeal.postcode_area].filter(Boolean).join(', ')} (${verifiedDeal.kind === 'rent' ? 'rent-to-rent' : 'to buy'})` },
      });
    } catch (err) {
      if (err instanceof InsufficientCreditError) {
        await admin.from('deal_opens').delete().eq('id', row.id).eq('status', 'pending');
        return { ok: false, code: 'insufficient_credit', requiredPence: err.requiredPence, availablePence: Math.max(0, Math.round(err.availablePence)) };
      }
      console.error('[marketplace] open debit failed:', (err as Error)?.message ?? err);
      await admin.from('deal_opens').delete().eq('id', row.id).eq('status', 'pending');
      return { ok: false, code: 'failed' };
    }
    void afterDebit(input.userId).catch(() => {});
  }
  // The deal could have been retired by a concurrent recheck between the verify and here.
  const latest = await loadDealById(admin, deal.id);
  if (latest?.status === 'retired' || !(await flipToOpen(admin, row, transactionId))) {
    if (transactionId !== null) {
      try {
        await refund(transactionId, undefined, 'Deal went off market before unlock');
      } catch (err) {
        console.error('[marketplace] refund failed:', (err as Error)?.message ?? err);
      }
    }
    await admin.from('deal_opens').delete().eq('id', row.id).eq('status', 'pending');
    return { ok: false, code: latest?.status === 'retired' ? 'just_gone' : 'failed' };
  }
  return { ok: true, alreadyOpen: false, verifiedVia: input.adminUser ? 'admin' : decision.verifiedVia, chargedBasePence: pence };
}

// ── The sheet ──

export interface DealSheetPrivate {
  address: string | null;
  postcode: string | null;
  listingUrl: string;
  photos: string[];
  snapshot: ListingSnapshot;
  open: DealOpenRow;
}

export interface DealSheet {
  deal: DealRow;
  listing: import('../listing/sourcing').SourcedListing | null;
  /** Only when the member has an open row (or is an admin). */
  priv: DealSheetPrivate | null;
}

export async function dealSheet(dealId: string, userId: string, adminUser: boolean): Promise<DealSheet | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const deal = await loadDealById(admin, dealId);
  if (!deal) return null;
  const open = await existingOpen(admin, userId, deal.canonical_url);
  const unlocked = open?.status === 'open' || adminUser;
  if (!unlocked) return { deal, listing: null, priv: null };
  const sourced = (await loadSourcedListings(admin, [deal.canonical_url])).get(deal.canonical_url) ?? null;
  const listing = sourced?.listing ?? null;
  const { data: snapRow } = await admin.from('listing_snapshots').select('snapshot').eq('canonical_url', deal.canonical_url).maybeSingle();
  const live = (snapRow?.snapshot as ListingSnapshot | undefined) ?? null;
  const snapshot = listing ? snapshotFromDeal(listing, live) : live;
  if (!snapshot) return { deal, listing, priv: null };
  const photos = [...new Set([...(live?.photos ?? []), ...(deal.photos ?? []), ...(deal.photo ? [deal.photo] : [])])];
  const openRow: DealOpenRow = open ?? { id: 'admin', user_id: userId, canonical_url: deal.canonical_url, deal_id: deal.id, status: 'open', opened_at: new Date().toISOString(), charged_base_pence: 0, transaction_id: null, verified_via: 'admin', status_at_open: null, band_at_open: null, annual_profit_at_open: null, checked_listing_id: null, saved_at: null, fetched: false };
  return {
    deal,
    listing,
    priv: { address: listing?.address ?? snapshot.displayAddress ?? null, postcode: listing?.postcode ?? snapshot.postcode ?? null, listingUrl: listing?.sourceUrl ?? deal.canonical_url, photos, snapshot, open: openRow },
  };
}

/**
 * Saves an opened deal to the member's pipeline (checked_listings) at no
 * charge and outside the daily resolve cap: the snapshot is the live page's
 * when there is one, else a minimal one built from the listing.
 */
export async function saveOpenedDealToPipeline(userId: string, dealId: string, adminUser: boolean): Promise<{ ok: true; checkedListingId: string } | { ok: false; code: 'missing' | 'not_open' | 'failed' }> {
  if (!hasServiceRole()) return { ok: false, code: 'failed' };
  const sheet = await dealSheet(dealId, userId, adminUser);
  if (!sheet) return { ok: false, code: 'missing' };
  if (!sheet.priv) return { ok: false, code: 'not_open' };
  const admin = createAdminClient();
  const s = sheet.priv.snapshot;
  const row = {
    user_id: userId,
    canonical_url: s.canonicalUrl,
    source: s.source,
    kind: s.kind,
    postcode: s.postcode ?? null,
    postcode_area: postcodeAreaOf(s.outcode ?? s.postcode) ?? sheet.deal.postcode_area,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    snapshot: s,
    quick_estimate: null,
    deal: sheet.deal.deal ?? null,
    listing_status: s.status ?? null,
    // Not a resolve: the daily cap counts last_checked_at, and this save spent nothing.
    last_checked_at: null,
    rechecked_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from('checked_listings').upsert(row, { onConflict: 'user_id,canonical_url' }).select('id').single();
  if (error || !data?.id) {
    console.error('[marketplace] pipeline save failed:', error?.message);
    return { ok: false, code: 'failed' };
  }
  const checkedListingId = String(data.id);
  if (sheet.priv.open.id !== 'admin') {
    const { error: upErr } = await admin.from('deal_opens').update({ checked_listing_id: checkedListingId, saved_at: new Date().toISOString() }).eq('id', sheet.priv.open.id);
    if (upErr) console.error('[marketplace] saved update failed:', upErr.message);
  }
  return { ok: true, checkedListingId };
}

export interface OpenedDeal {
  open: DealOpenRow;
  deal: DealRow | null;
}

export async function listOpened(userId: string): Promise<OpenedDeal[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.from('deal_opens').select(OPEN_COLUMNS).eq('user_id', userId).eq('status', 'open').order('opened_at', { ascending: false }).limit(200);
  if (error) {
    console.error('[marketplace] listOpened failed:', error.message);
    return [];
  }
  const opens = (data ?? []) as DealOpenRow[];
  const ids = [...new Set(opens.map((o) => o.deal_id))];
  const deals = new Map<string, DealRow>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: rows } = await admin.from('marketplace_deals').select('canonical_url, id, source, kind, postcode_area, outcode, town, bedrooms, price_amount, price_period, raw_type, tenure, photo, photos, band, screening, deal, suitability, motivation, annual_profit, uplift_pct, price_history, reduced_at, listed_date, status, retired_reason, retired_at, first_seen_at, last_seen_at, last_checked_live_at, last_confirmed_at, last_confirmed_via, next_check_due_at, check_requested_at, last_shown_at, check_failures, created_at, updated_at').in('id', ids.slice(i, i + 150));
    for (const d of (rows ?? []) as unknown as DealRow[]) deals.set(d.id, d);
  }
  return opens.map((open) => ({ open, deal: deals.get(open.deal_id) ?? null }));
}
