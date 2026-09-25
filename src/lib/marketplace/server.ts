import 'server-only';

/**
 * Service-role reads and writes shared by the sweep, the recheck and the
 * paid open: loading a deal with its listing, applying the result of a live
 * page read, retiring, and recording a run. Everything that decides is pure
 * and lives beside this file; everything here just moves rows.
 */
import { createAdminClient } from '../supabase/admin';
import { revalidateTag } from 'next/cache';
import { resolveListing, type ResolveOutcome } from '../listing/server';
import { serverFetchEnabled } from '../listing/fetch';
import { suitabilityFromSnapshot } from '../listing/suitability';
import { diffListing, parseHistory, type PriceHistoryEntry } from '../listing/recheck';
import type { SourcedListing } from '../listing/sourcing';
import type { ListingSnapshot } from '../listing/types';
import { getAreaCardsWithin } from '../market/cached';
import type { AreaCardData } from '../market/explorer';
import { storedAreaRentTable } from '../broker/providers/internal';
import { buildDealRecord, mergeSnapshotIntoListing, qualifiesForMarketplace, type AreaCardLike, type DealRecord, type StoredRent } from './record';
import { retiredReasonFor } from './status';
import { nextCheckDueAt, FAILED_CHECK_RETRY_MS, MAX_ENTRY_FAILURES } from './cadence';
import type { DealRow, RetiredReason } from './types';

export const DEALS_TAG = 'marketplace-deals';

/** Every column the run modules read. The grid uses PUBLIC_DEAL_COLUMNS instead. */
export const DEAL_COLUMNS =
  'canonical_url, id, source, kind, postcode_area, outcode, town, bedrooms, price_amount, price_period, raw_type, tenure, photo, photos, band, screening, deal, suitability, motivation, annual_profit, uplift_pct, price_history, reduced_at, listed_date, status, retired_reason, retired_at, first_seen_at, last_seen_at, last_checked_live_at, last_confirmed_at, last_confirmed_via, next_check_due_at, check_requested_at, last_shown_at, check_failures, created_at, updated_at';

export type Admin = ReturnType<typeof createAdminClient>;

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The area cards and stored rent table every re-screen needs. One read per run. */
export interface ScreenContext {
  cards: AreaCardData[];
  cardByCode: Map<string, AreaCardLike>;
  rentTable: Map<string, StoredRent>;
}

export async function loadScreenContext(snapshotWaitMs = 20_000): Promise<ScreenContext | null> {
  const cards = await getAreaCardsWithin(snapshotWaitMs);
  if (cards === null) return null;
  const rentTable = await storedAreaRentTable().catch((err) => {
    console.warn('[marketplace] stored rent table failed:', (err as Error)?.message ?? err);
    return new Map<string, StoredRent>();
  });
  return { cards, cardByCode: new Map(cards.map((c) => [c.code, c as AreaCardLike])), rentTable };
}

export function revalidateDeals(): void {
  try {
    revalidateTag(DEALS_TAG, 'max');
  } catch {
    /* outside a request scope (tests, scripts): nothing to revalidate */
  }
}

/** The stored SourcedListing for a deal, or null when the sourced row is gone. */
export async function loadSourcedListings(admin: Admin, urls: string[]): Promise<Map<string, { listing: SourcedListing; firstSeenAt: string }>> {
  const out = new Map<string, { listing: SourcedListing; firstSeenAt: string }>();
  for (const some of chunk(urls, 150)) {
    const { data, error } = await admin.from('sourced_listings').select('canonical_url, snapshot, first_seen_at').in('canonical_url', some);
    if (error) {
      console.error('[marketplace] sourced_listings read failed:', error.message);
      continue;
    }
    for (const r of (data ?? []) as { canonical_url: string; snapshot: SourcedListing; first_seen_at: string }[]) out.set(r.canonical_url, { listing: r.snapshot, firstSeenAt: r.first_seen_at });
  }
  return out;
}

export async function loadDealsByUrls(admin: Admin, urls: string[]): Promise<Map<string, DealRow>> {
  const out = new Map<string, DealRow>();
  for (const some of chunk(urls, 150)) {
    const { data, error } = await admin.from('marketplace_deals').select(DEAL_COLUMNS).in('canonical_url', some);
    if (error) {
      console.error('[marketplace] deals read failed:', error.message);
      continue;
    }
    for (const r of (data ?? []) as unknown as DealRow[]) out.set(r.canonical_url, r);
  }
  return out;
}

export async function loadDealById(admin: Admin, id: string): Promise<DealRow | null> {
  const { data, error } = await admin.from('marketplace_deals').select(DEAL_COLUMNS).eq('id', id).maybeSingle();
  if (error) {
    console.error('[marketplace] deal read failed:', error.message);
    return null;
  }
  return (data as unknown as DealRow | null) ?? null;
}

/** The columns a record contributes to a row (insert and update share it). */
export function recordColumns(l: SourcedListing, rec: DealRecord): Record<string, unknown> {
  return {
    source: l.source,
    kind: l.kind,
    postcode_area: l.postcodeArea,
    outcode: l.outcode,
    town: rec.town,
    bedrooms: l.bedrooms,
    price_amount: rec.priceAmount,
    price_period: rec.pricePeriod,
    raw_type: l.rawType,
    tenure: l.tenure ?? null,
    photo: l.photo,
    band: rec.band,
    screening: rec.screening,
    deal: rec.deal,
    suitability: rec.suitability,
    motivation: rec.motivation,
    annual_profit: rec.annualProfit,
    uplift_pct: rec.upliftPct,
    listed_date: l.listedDate ?? null,
  };
}

export async function retireDeal(admin: Admin, canonicalUrl: string, reason: RetiredReason, now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString();
  const { error } = await admin
    .from('marketplace_deals')
    .update({ status: 'retired', retired_reason: reason, retired_at: nowIso, check_requested_at: null, next_check_due_at: null, updated_at: nowIso })
    .eq('canonical_url', canonicalUrl);
  if (error) console.error('[marketplace] retire failed:', error.message);
}

export type LiveOutcome =
  | { kind: 'live'; deal: DealRow; listing: SourcedListing; snapshot: ListingSnapshot }
  | { kind: 'retired'; reason: RetiredReason }
  | { kind: 'paused' }
  | { kind: 'failed'; code: string };

/**
 * A price change between what the row held and what the page (or feed) now
 * says, appended to the row's history. Returns the columns to write.
 */
export function priceChangeColumns(deal: DealRow, rec: DealRecord, nowIso: string): { history: PriceHistoryEntry[]; columns: Record<string, unknown> } {
  const history = parseHistory(deal.price_history);
  const prevAmount = deal.price_amount === null ? null : Number(deal.price_amount);
  const nextAmount = rec.priceAmount;
  const entry = diffListing({ price: prevAmount !== null ? { amount: prevAmount, period: (deal.price_period as 'total' | 'pcm') ?? 'total' } : null, status: 'available' }, { price: nextAmount !== null ? { amount: nextAmount, period: rec.pricePeriod ?? 'total' } : null, status: null }, nowIso);
  const columns: Record<string, unknown> = {};
  if (entry) {
    history.push(entry);
    columns.price_history = history;
    if (entry.previousAmount !== null && entry.amount !== null && entry.amount < entry.previousAmount) columns.reduced_at = nowIso;
  }
  return { history, columns };
}

/**
 * Applies what a live page read found to a deal: retire it if the page says
 * it has gone or cannot be short let, re-screen it at the page's price, and
 * otherwise mark it live and checked. Shared by the hourly recheck and the
 * paid open, so the two can never disagree about what a page means.
 */
export async function applyLiveResult(admin: Admin, deal: DealRow, listing: SourcedListing, res: ResolveOutcome, ctx: ScreenContext, now: Date = new Date()): Promise<LiveOutcome> {
  const nowIso = now.toISOString();
  if (!res.ok) {
    if (res.code === 'paused') return { kind: 'paused' };
    if (res.code === 'not_found') {
      await retireDeal(admin, deal.canonical_url, 'removed', now);
      return { kind: 'retired', reason: 'removed' };
    }
    // Blocked, unreadable, disabled: try again later; one bad page must not pin the queue.
    const failures = (deal.check_failures ?? 0) + 1;
    const update: Record<string, unknown> = { check_failures: failures, check_requested_at: null, next_check_due_at: new Date(now.getTime() + FAILED_CHECK_RETRY_MS).toISOString(), updated_at: nowIso };
    // A deal we cannot verify on entry still goes live on the feed rather than never appearing.
    if (deal.status === 'pending_verify' && failures >= MAX_ENTRY_FAILURES) update.status = 'live';
    const { error } = await admin.from('marketplace_deals').update(update).eq('canonical_url', deal.canonical_url);
    if (error) console.error('[marketplace] failure update failed:', error.message);
    return { kind: 'failed', code: res.code };
  }
  const s = res.snapshot;
  const gone = retiredReasonFor(s.status ?? null);
  if (gone) {
    await retireDeal(admin, deal.canonical_url, gone, now);
    return { kind: 'retired', reason: gone };
  }
  const merged = mergeSnapshotIntoListing(listing, s);
  // The page is the better record of the listing; tomorrow's sweep starts from it.
  const { error: snapErr } = await admin.from('sourced_listings').update({ snapshot: merged, last_seen_at: nowIso }).eq('canonical_url', deal.canonical_url);
  if (snapErr) console.error('[marketplace] snapshot write failed:', snapErr.message);
  const suitability = suitabilityFromSnapshot(s, listing.kind);
  if (suitability !== 'ok') {
    await retireDeal(admin, deal.canonical_url, 'unsuitable', now);
    return { kind: 'retired', reason: 'unsuitable' };
  }
  const card = (merged.postcodeArea ? ctx.cardByCode.get(merged.postcodeArea) : null) ?? (deal.postcode_area ? ctx.cardByCode.get(deal.postcode_area) : null) ?? null;
  const rec = buildDealRecord(merged, { card, rentTable: ctx.rentTable, firstSeenAt: deal.first_seen_at, now });
  if (!qualifiesForMarketplace(rec)) {
    await retireDeal(admin, deal.canonical_url, 'unqualified', now);
    return { kind: 'retired', reason: 'unqualified' };
  }
  const { columns: priceCols } = priceChangeColumns(deal, rec, nowIso);
  const update: Record<string, unknown> = {
    ...recordColumns(merged, rec),
    ...priceCols,
    photos: s.photos.length > 0 ? s.photos : (deal.photos ?? null),
    status: 'live',
    last_seen_at: nowIso,
    last_checked_live_at: nowIso,
    last_confirmed_at: nowIso,
    last_confirmed_via: 'live',
    next_check_due_at: nextCheckDueAt(merged.kind, rec.annualProfit, now),
    check_requested_at: null,
    check_failures: 0,
    updated_at: nowIso,
  };
  const { data, error } = await admin.from('marketplace_deals').update(update).eq('canonical_url', deal.canonical_url).select(DEAL_COLUMNS).maybeSingle();
  if (error) console.error('[marketplace] live update failed:', error.message);
  return { kind: 'live', deal: ((data as unknown as DealRow | null) ?? { ...deal, ...(update as Partial<DealRow>) }) as DealRow, listing: merged, snapshot: s };
}

/** A live page read for a deal, house-metered by the caller. Null when the source cannot be fetched. */
export async function fetchDealPage(deal: DealRow): Promise<ResolveOutcome | null> {
  if (!serverFetchEnabled(deal.source)) return null;
  return resolveListing(deal.canonical_url, { refresh: true });
}

export async function recordRun(admin: Admin, kind: 'sweep' | 'recheck', dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[marketplace] run record failed:', error.message);
}
