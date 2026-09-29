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
import { getBillingSettings } from '../credit/unit-costs';
import { buildDealRecord, mergeSnapshotIntoListing, qualifiesForMarketplace, type AreaCardLike, type DealRecord, type DealRules, type StoredRent } from './record';
import { dealChecksEnabled, readDealQualitySettings } from '../deal-quality/settings-server';
import { checkOf, shortlistExpiryAt, validCheckFor } from '../deal-quality/checks';
import { DEFAULT_DEAL_CHECKS } from '../deal-quality/config';
import { retiredReasonFor } from './status';
import { nextCheckDueAt, FAILED_CHECK_RETRY_MS, MAX_ENTRY_FAILURES } from './cadence';
import type { DealRow, RetiredReason } from './types';
import { cachedCohortLookup, type CohortLookup } from './cohorts-server';
import { projectChecksOn, readProjectSettings } from '../project/settings-server';
import { projectHoldFor } from '../project/hold';
import { projectFactsOf } from '../project/check-plan';

export const DEALS_TAG = 'marketplace-deals';

/** Every column the run modules read. The grid uses PUBLIC_DEAL_COLUMNS instead. */
export const DEAL_COLUMNS =
  'canonical_url, id, source, kind, postcode_area, outcode, town, bedrooms, price_amount, price_period, raw_type, tenure, photo, photos, band, screening, deal, suitability, motivation, annual_profit, uplift_pct, price_history, reduced_at, listed_date, status, retired_reason, retired_at, live_since, first_seen_at, last_seen_at, last_checked_live_at, last_confirmed_at, last_confirmed_via, next_check_due_at, check_requested_at, last_shown_at, check_failures, created_at, updated_at';

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
  /** The rent-to-rent bar, £ a year (billing_settings.r2r_qualified_profit). */
  r2rBar: number;
  /** Batch 16: the auction terms and the low-entry bar every record is built under. */
  rules: DealRules;
  /** Batch 17 (bug 1): the cached motivated-seller cohorts, so a rebuilt record keeps their signals. */
  cohorts?: CohortLookup;
}

/**
 * Batch 16's rules from billing_settings; the decided defaults when they
 * cannot be read. Batch 17: the Project entry hold, with its settings (off
 * whenever they cannot be read).
 */
export async function loadDealRules(): Promise<DealRules> {
  const enabled = dealChecksEnabled();
  try {
    const admin = createAdminClient();
    const [q, project] = await Promise.all([readDealQualitySettings(admin), readProjectSettings(admin)]);
    return {
      auctionTerms: q.auction,
      lowEntry: q.lowEntry,
      checks: { enabled, validDays: q.checks.validDays, shortlistExpiryDays: q.checks.shortlistExpiryDays },
      project: { hold: projectChecksOn(project), settings: project },
    };
  } catch (err) {
    console.warn('[marketplace] deal rules unreadable, using the defaults:', (err as Error)?.message ?? err);
    return { checks: { enabled, validDays: DEFAULT_DEAL_CHECKS.validDays, shortlistExpiryDays: DEFAULT_DEAL_CHECKS.shortlistExpiryDays } };
  }
}

export async function loadScreenContext(snapshotWaitMs = 20_000): Promise<ScreenContext | null> {
  const cards = await getAreaCardsWithin(snapshotWaitMs);
  if (cards === null) return null;
  const rentTable = await storedAreaRentTable().catch((err) => {
    console.warn('[marketplace] stored rent table failed:', (err as Error)?.message ?? err);
    return new Map<string, StoredRent>();
  });
  const [{ r2rQualifiedProfit: r2rBar }, rules] = await Promise.all([getBillingSettings(), loadDealRules()]);
  let cohorts: CohortLookup | undefined;
  try {
    cohorts = cachedCohortLookup(createAdminClient());
  } catch {
    cohorts = undefined;
  }
  return { cards, cardByCode: new Map(cards.map((c) => [c.code, c as AreaCardLike])), rentTable, r2rBar, rules, cohorts };
}

/**
 * The column a write was refused for because the database does not have it
 * yet (the schema behind the code): PostgREST's PGRST204, or Postgres's
 * 42703 from a function. Null for any other error.
 */
export function missingColumnOf(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null;
  const message = error.message ?? '';
  const rest = /Could not find the '([^']+)' column/.exec(message);
  if (rest) return rest[1];
  if (error.code === '42703') return /column "([^"]+)"/.exec(message)?.[1] ?? null;
  return null;
}

type WriteError = { code?: string; message?: string } | null;

/**
 * A write that names a column the database does not have yet is made again
 * without it (each missing column once), so a deploy that runs before its
 * schema section degrades to the old row shape instead of failing every
 * insert. `payload` is one row or a list of rows.
 */
export async function writeWithoutMissing<P extends Record<string, unknown> | Record<string, unknown>[], R extends { error: WriteError }>(payload: P, run: (p: P) => PromiseLike<R>, tag: string): Promise<R> {
  let current = payload;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await run(current);
    const missing = missingColumnOf(res.error);
    const has = missing !== null && (Array.isArray(current) ? current.some((r) => missing in r) : missing in current);
    if (!has) return res;
    console.warn(`[${tag}] column ${missing} missing (schema behind the code?): written without it`);
    const strip = (r: Record<string, unknown>) => {
      const { [missing as string]: _dropped, ...rest } = r;
      void _dropped;
      return rest;
    };
    current = (Array.isArray(current) ? current.map(strip) : strip(current)) as P;
  }
  return run(current);
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
    // Batch 16, Part F. Written through writeWithoutMissing, so a database without the column still takes the row.
    stream: rec.stream,
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
  /** Batch 17: its page says it needs work, so it waits for its Project check instead of going live. */
  | { kind: 'held' }
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
 *
 * Batch 17: the rebuilt record keeps its motivated-seller cohort signals
 * (bug 1), and a sale on its entry read (pending_verify) whose page says it
 * needs work goes to the Project hold instead of live (hold.ts), while the
 * hold is on. A live deal is never flipped by a recheck.
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
  // Batch 16: a check still good for the listing the page describes keeps its figure; otherwise the area figures, as before.
  const check = validCheckFor(checkOf(deal.screening), merged, ctx.rules.checks?.validDays ?? DEFAULT_DEAL_CHECKS.validDays, now);
  const cohort = ctx.cohorts ? await ctx.cohorts.find(merged, deal.postcode_area) : null;
  const rec = buildDealRecord(merged, { card, rentTable: ctx.rentTable, r2rBar: ctx.r2rBar, rules: ctx.rules, check, firstSeenAt: deal.first_seen_at, cohort, now });
  if (!qualifiesForMarketplace(rec)) {
    await retireDeal(admin, deal.canonical_url, 'unqualified', now);
    return { kind: 'retired', reason: 'unqualified' };
  }
  const project = ctx.rules.project;
  const hold =
    project?.hold && deal.status === 'pending_verify' && merged.kind === 'sale'
      ? projectHoldFor(
          {
            kind: 'sale',
            needsWork: merged.needsWork,
            auction: merged.auction,
            fetchable: true,
            pageExclusion: merged.projectExclusion ?? null,
            texts: [],
            tenure: merged.tenure,
            yearsRemainingOnLease: merged.yearsRemainingOnLease,
            listedFlag: merged.listedBuilding,
            price: rec.priceAmount,
            facts: projectFactsOf(merged),
          },
          project.settings,
        )
      : { kind: 'none' as const };
  if (hold.kind === 'retire') {
    await retireDeal(admin, deal.canonical_url, hold.reason, now);
    return { kind: 'retired', reason: hold.reason };
  }
  const held = hold.kind === 'hold';
  const { columns: priceCols } = priceChangeColumns(deal, rec, nowIso);
  const update: Record<string, unknown> = {
    ...recordColumns(merged, rec),
    ...priceCols,
    // Batch 17: the renovation wording (our phrase keys) for the Project ranking; written where the column exists.
    ...(merged.kind === 'sale' ? { needs_work: merged.needsWork && merged.needsWork.phrases.length > 0 ? merged.needsWork : null } : {}),
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
    // Batch 17: held for its Project check instead (on Batch 16's shortlist, until its expiry), keeping its comparables check.
    ...(held
      ? {
          status: 'pending_check',
          stream: 'project',
          next_check_due_at: shortlistExpiryAt(now, { shortlistExpiryDays: ctx.rules.checks?.shortlistExpiryDays ?? DEFAULT_DEAL_CHECKS.shortlistExpiryDays }),
        }
      : {}),
  };
  const { data, error } = await writeWithoutMissing(update, (u) => admin.from('marketplace_deals').update(u).eq('canonical_url', deal.canonical_url).select(DEAL_COLUMNS).maybeSingle(), 'marketplace');
  if (error) console.error('[marketplace] live update failed:', error.message);
  if (held) return error ? { kind: 'failed', code: 'write' } : { kind: 'held' };
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
