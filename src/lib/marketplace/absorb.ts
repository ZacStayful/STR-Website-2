import 'server-only';

/**
 * Folding a search's listings into the pool: record every listing in
 * sourced_listings, screen the newcomers and insert the qualified ones as
 * pending_verify (the hourly recheck reads their page before they go live),
 * and reconcile rows the pool already holds against what today's feed says.
 *
 * With the daily checks on (Batch 16, Part B: DealRules.checks.enabled), a
 * qualifying newcomer waits as pending_check instead — the shortlist the
 * nightly job takes its checks from — and a revived deal does the same
 * unless its own check is still good. A re-screen (a reprice, a revival)
 * builds on that check while it is good rather than the area's average.
 *
 * Shared by the marketplace sweep (src/lib/marketplace/sweep-run.ts) and the
 * demand-led searches (src/lib/sourcing-demand/run.ts), so a listing is
 * screened the same way whichever job found it.
 *
 * Batch 17: while the Project hold is on (DealRules.project), a sale whose
 * card says it needs work is decided before it is shown (src/lib/project/
 * hold.ts): held on the shortlist in the Project stream, or retired as never
 * a Project deal. A newcomer or a revived row alike.
 */
import { runMetered, newActionId } from '../credit/context';
import { areaCentroid } from '../market/area-centroids';
import { listingNeedsWork, type SourcedListing, type SourcingQuery } from '../listing/sourcing';
import { fetchCohorts, sourcedPropertiesConfigured } from '../apis/propertydata-sourced';
import { indexCohorts, lookupCohorts, type CohortMember } from '../listing/cohorts';
import { buildDealRecord, feedStatusOf, qualifiesForMarketplace, type AreaCardLike, type DealRecord, type DealRules, type StoredRent } from './record';
import { checkOf, shortlistExpiryAt, validCheckFor, type StoredCheck } from '../deal-quality/checks';
import { DEFAULT_DEAL_CHECKS } from '../deal-quality/config';
import { retiredReasonFor } from './status';
import { nextCheckDueAt } from './cadence';
import { REACTIVATABLE_REASONS, RETURNING_REASONS, type DealRow } from './types';
import { chunk, loadDealsByUrls, priceChangeColumns, recordColumns, retireDeal, writeWithoutMissing, type Admin } from './server';
import { serverFetchEnabled } from '../listing/fetch';
import { SERVER_FETCHABLE } from '../listing/detect';
import type { NeedsWork } from '../project/needs-work';
import { projectHoldFor, type HoldDecision } from '../project/hold';
import { projectFactsOf } from '../project/check-plan';
import { COHORT_MAX_AGE_MS } from './cohorts-server';
import type { Band } from '../listing/screen';
import type { UnsuitableReason } from '../listing/suitability';

const COHORT_RADIUS_MILES = 10;
const URL_CHUNK = 150;

/** What folding listings in did, counted into the caller's summary. */
export interface AbsorbCounters {
  screened: Partial<Record<Band, number>>;
  unsuitable: Partial<Record<UnsuitableReason, number>>;
  newDeals: number;
  /** Of newDeals and reactivated, how many wait on the shortlist for their check (Part B). */
  shortlisted: number;
  confirmed: number;
  repriced: number;
  retired: Partial<Record<string, number>>;
  reactivated: number;
  /** Batch 17: of newDeals and reactivated, how many wait for their Project check. */
  projectHeld: number;
}

export function emptyAbsorbCounters(): AbsorbCounters {
  return { screened: {}, unsuitable: {}, newDeals: 0, shortlisted: 0, confirmed: 0, repriced: 0, retired: {}, reactivated: 0, projectHeld: 0 };
}

/** A sale's renovation wording from its card (and any page read already folded into it). */
function needsWorkOf(l: SourcedListing): NeedsWork | null {
  if (l.kind !== 'sale') return null;
  const nw = listingNeedsWork(l);
  return nw.phrases.length > 0 ? nw : null;
}

/** The Project hold's decision for a listing coming into the pool (hold.ts); 'none' while the hold is off. */
function holdFor(l: SourcedListing, priceAmount: number | null, rules: DealRules): HoldDecision {
  const project = rules.project;
  if (!project?.hold || !rules.checks?.enabled || l.kind !== 'sale') return { kind: 'none' };
  return projectHoldFor(
    {
      kind: l.kind,
      needsWork: needsWorkOf(l),
      auction: l.auction,
      fetchable: SERVER_FETCHABLE.has(l.source),
      pageExclusion: l.projectExclusion,
      texts: [l.title, l.priceQualifier, ...(l.features ?? [])],
      tenure: l.tenure,
      yearsRemainingOnLease: l.yearsRemainingOnLease,
      listedFlag: l.listedBuilding,
      price: priceAmount,
      facts: projectFactsOf(l),
    },
    project.settings,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The PropertyData motivated-seller cohorts for the areas a run touches,
 * from the weekly cache or, when `buy` allows, a fresh (paid, house) read
 * for at most `maxBuys` areas. A run that must not spend (the demand-led
 * searches, which count every penny against their cap) passes buy: false
 * and gets whatever the cache holds.
 */
export interface CohortLoader {
  /** Every cohort member indexed so far; the first area to claim a key keeps it. */
  index: Map<string, CohortMember>;
  loadFor(area: string): Promise<void>;
  /** Areas bought fresh this run. */
  bought(): number;
}

export function cohortLoader(admin: Admin, opts: { buy: boolean; maxBuys: number; action: string; tag: string }): CohortLoader {
  const index = new Map<string, CohortMember>();
  const loaded = new Set<string>();
  let bought = 0;
  return {
    index,
    bought: () => bought,
    async loadFor(area: string): Promise<void> {
      if (loaded.has(area)) return;
      loaded.add(area);
      const { data } = await admin.from('marketplace_cohorts').select('payload, fetched_at').eq('postcode_area', area).maybeSingle();
      const fresh = data && Date.now() - new Date(String(data.fetched_at)).getTime() < COHORT_MAX_AGE_MS;
      let rows: CohortMember[] = [];
      if (fresh) {
        rows = Array.isArray(data.payload) ? (data.payload as CohortMember[]) : [];
      } else if (opts.buy && sourcedPropertiesConfigured() && bought < opts.maxBuys) {
        const c = areaCentroid(area);
        if (!c) return;
        try {
          rows = await runMetered({ userId: null, admin: false, action: opts.action, actionId: newActionId() }, () => fetchCohorts({ lat: c.lat, lng: c.lng }, COHORT_RADIUS_MILES));
          bought += 1;
          const { error } = await admin.from('marketplace_cohorts').upsert({ postcode_area: area, payload: rows, fetched_at: nowIso() }, { onConflict: 'postcode_area' });
          if (error) console.error(`[${opts.tag}] cohort cache write failed:`, error.message);
        } catch (err) {
          console.warn(`[${opts.tag}] cohort feed failed for`, area, (err as Error)?.message ?? err);
        }
      }
      for (const [k, v] of indexCohorts(rows)) if (!index.has(k)) index.set(k, v);
    },
  };
}

/** Folds one query's listings into sourced_listings and the pool. */
export async function absorbListings(
  admin: Admin,
  cardByCode: Map<string, AreaCardLike>,
  rentTable: ReadonlyMap<string, StoredRent>,
  r2rBar: number,
  cohortIndex: Map<string, CohortMember>,
  query: SourcingQuery,
  listings: SourcedListing[],
  counters: AbsorbCounters,
  tag = 'marketplace-sweep',
  rules: DealRules = {},
  /** Batch 22: collects the canonical URLs this call newly inserted (a member search attributes its finds exactly). */
  out?: { inserted: string[] },
): Promise<void> {
  const now = new Date();
  const stamp = now.toISOString();
  const rows = listings.map((l) => ({ canonical_url: l.canonicalUrl, source: l.source, kind: l.kind, query_key: query.key, postcode_area: l.postcodeArea ?? query.area, snapshot: l, first_seen_at: stamp, last_seen_at: stamp }));
  const { error: insErr } = await admin.from('sourced_listings').upsert(rows, { onConflict: 'canonical_url', ignoreDuplicates: true });
  if (insErr) console.error(`[${tag}] sourced_listings insert failed:`, insErr.message);
  const urls = rows.map((r) => r.canonical_url);
  for (const some of chunk(urls, URL_CHUNK)) {
    const { error } = await admin.from('sourced_listings').update({ last_seen_at: stamp }).in('canonical_url', some);
    if (error) console.error(`[${tag}] last_seen update failed:`, error.message);
  }
  const firstSeen = new Map<string, string>();
  for (const some of chunk(urls, URL_CHUNK)) {
    const { data } = await admin.from('sourced_listings').select('canonical_url, first_seen_at').in('canonical_url', some);
    for (const r of (data ?? []) as { canonical_url: string; first_seen_at: string }[]) firstSeen.set(r.canonical_url, r.first_seen_at);
  }
  const existing = await loadDealsByUrls(admin, urls);
  const card = cardByCode.get(query.area) ?? null;

  const checks = rules.checks;
  const inserts: Record<string, unknown>[] = [];
  for (const l of listings) {
    const deal = existing.get(l.canonicalUrl);
    const listingCard = (l.postcodeArea ? cardByCode.get(l.postcodeArea) : null) ?? card;
    const build = (check: StoredCheck | null): DealRecord => buildDealRecord(l, { card: listingCard, rentTable, r2rBar, rules, check, firstSeenAt: firstSeen.get(l.canonicalUrl) ?? stamp, cohort: lookupCohorts(cohortIndex, { uprn: l.uprn, postcode: l.postcode, address: l.address }), now });
    const feedGone = retiredReasonFor(feedStatusOf(l));
    if (!deal) {
      const rec = build(null);
      counters.screened[rec.band] = (counters.screened[rec.band] ?? 0) + 1;
      if (rec.suitability !== 'ok' && rec.suitability !== 'unknown') counters.unsuitable[rec.suitability] = (counters.unsuitable[rec.suitability] ?? 0) + 1;
      if (!qualifiesForMarketplace(rec) || feedGone) continue;
      const fetchable = serverFetchEnabled(l.source);
      // Batch 17: a sale whose card says it needs work is a Project deal or nothing.
      const hold = holdFor(l, rec.priceAmount, rules);
      const needsWork = needsWorkOf(l);
      if (hold.kind === 'retire') {
        // Recorded as retired, so the decision is seen on /admin/deals and never revisited.
        inserts.push({ canonical_url: l.canonicalUrl, ...recordColumns(l, rec), needs_work: needsWork, photos: l.photo ? [l.photo] : null, status: 'retired', retired_reason: hold.reason, retired_at: stamp, first_seen_at: firstSeen.get(l.canonicalUrl) ?? stamp, last_seen_at: stamp, last_confirmed_at: stamp, last_confirmed_via: 'feed', next_check_due_at: null, created_at: stamp, updated_at: stamp });
        counters.retired[hold.reason] = (counters.retired[hold.reason] ?? 0) + 1;
        continue;
      }
      // Part B: with the checks on, a newcomer waits on the shortlist; next_check_due_at is then when it is dropped unchecked.
      const shortlist = Boolean(checks?.enabled);
      inserts.push({
        canonical_url: l.canonicalUrl,
        ...recordColumns(l, rec),
        ...(needsWork ? { needs_work: needsWork } : {}),
        // Held for its Project check: the same shortlist, in the Project stream.
        ...(hold.kind === 'hold' ? { stream: 'project' } : {}),
        photos: l.photo ? [l.photo] : null,
        // Zoopla is never fetched: it goes live on the feed with a placeholder photo.
        status: shortlist ? 'pending_check' : fetchable ? 'pending_verify' : 'live',
        first_seen_at: firstSeen.get(l.canonicalUrl) ?? stamp,
        last_seen_at: stamp,
        last_confirmed_at: stamp,
        last_confirmed_via: 'feed',
        next_check_due_at: shortlist && checks ? shortlistExpiryAt(now, checks) : fetchable ? stamp : nextCheckDueAt(l.kind, rec.annualProfit, now),
        created_at: stamp,
        updated_at: stamp,
      });
      if (shortlist) counters.shortlisted += 1;
      if (hold.kind === 'hold') counters.projectHeld += 1;
      continue;
    }
    await reconcileDeal(admin, deal, l, build, feedGone, now, counters, tag, rules);
  }
  if (inserts.length > 0) {
    // ignoreDuplicates: a row that appeared between the read and the write keeps its state.
    const { error, data } = await writeWithoutMissing(inserts, (rows) => admin.from('marketplace_deals').upsert(rows, { onConflict: 'canonical_url', ignoreDuplicates: true }).select('canonical_url'), tag);
    if (error) console.error(`[${tag}] deals insert failed:`, error.message);
    else {
      counters.newDeals += data?.length ?? inserts.length;
      if (out && Array.isArray(data)) for (const r of data as { canonical_url?: unknown }[]) if (typeof r.canonical_url === 'string') out.inserted.push(r.canonical_url);
    }
  }
}

/** An existing row against what today's feed says about it. The record is built on the row's own check while that is good (Part B). */
async function reconcileDeal(admin: Admin, deal: DealRow, l: SourcedListing, build: (check: StoredCheck | null) => DealRecord, feedGone: ReturnType<typeof retiredReasonFor>, now: Date, counters: AbsorbCounters, tag: string, rules: DealRules): Promise<void> {
  const stamp = now.toISOString();
  const count = (reason: string) => (counters.retired[reason] = (counters.retired[reason] ?? 0) + 1);
  const checks = rules.checks;
  const check = validCheckFor(checkOf(deal.screening), l, checks?.validDays ?? DEFAULT_DEAL_CHECKS.validDays, now);
  const rec = build(check);
  if (deal.status === 'retired') {
    // Back in the feed and qualifying again: same row, same id. A retirement
    // the feed can undo (unqualified, stale) or — Batch 6 — one that meant the
    // listing went (sold / under offer / let agreed / removed), which is then
    // "back on the market": stamped, and confirmed by a page read before it
    // goes live wherever the source can be read.
    const reason = deal.retired_reason;
    const returning = Boolean(reason && RETURNING_REASONS.has(reason));
    if (reason && (REACTIVATABLE_REASONS.has(reason) || returning) && qualifiesForMarketplace(rec) && !feedGone) {
      const fetchable = serverFetchEnabled(l.source);
      // Batch 17: a revived sale whose card says it needs work is decided as a newcomer is.
      const hold = holdFor(l, rec.priceAmount, rules);
      if (hold.kind === 'retire') {
        if (reason !== hold.reason) {
          const { error } = await admin.from('marketplace_deals').update({ retired_reason: hold.reason, retired_at: stamp, updated_at: stamp }).eq('canonical_url', deal.canonical_url).eq('status', 'retired');
          if (error) console.error(`[${tag}] project retire failed:`, error.message);
        }
        count(hold.reason);
        return;
      }
      const held = hold.kind === 'hold';
      // Part B: without a check still good for it, a revived deal waits on the shortlist like a newcomer. Held for its Project check it waits whatever its check (the Project job needs one).
      const shortlist = (Boolean(checks?.enabled) && !check) || held;
      // The price may have moved while it was off the market: record it, as any reprice is.
      const { columns: priceCols } = priceChangeColumns(deal, rec, stamp);
      const needsWork = needsWorkOf(l);
      const revive = { ...recordColumns(l, rec), ...priceCols, ...(needsWork ? { needs_work: needsWork } : {}), ...(held ? { stream: 'project' } : {}), status: shortlist ? 'pending_check' : fetchable ? 'pending_verify' : 'live', retired_reason: null, retired_at: null, last_seen_at: stamp, last_confirmed_at: stamp, last_confirmed_via: 'feed', next_check_due_at: shortlist && checks ? shortlistExpiryAt(now, checks) : stamp, check_failures: 0, updated_at: stamp };
      // A database without the Batch 6 columns (revived_at, revived_from) or Batch 16's (stream) still revives the deal: writeWithoutMissing drops what it lacks.
      const { error } = await writeWithoutMissing(returning ? { ...revive, revived_at: stamp, revived_from: reason } : revive, (columns) => admin.from('marketplace_deals').update(columns).eq('canonical_url', deal.canonical_url), tag);
      if (error) console.error(`[${tag}] reactivate failed:`, error.message);
      else {
        counters.reactivated += 1;
        if (shortlist) counters.shortlisted += 1;
        if (held) counters.projectHeld += 1;
      }
    }
    return;
  }
  if (feedGone) {
    await retireDeal(admin, deal.canonical_url, feedGone, now);
    count(feedGone);
    return;
  }
  const { columns: priceCols } = priceChangeColumns(deal, rec, stamp);
  const repriced = Object.keys(priceCols).length > 0;
  if (repriced && !qualifiesForMarketplace(rec)) {
    await retireDeal(admin, deal.canonical_url, 'unqualified', now);
    count('unqualified');
    return;
  }
  const update: Record<string, unknown> = { last_seen_at: stamp, last_confirmed_at: stamp, updated_at: stamp };
  // A live check within the day is the stronger claim; the feed does not overwrite it.
  if (!(deal.last_confirmed_via === 'live' && deal.last_checked_live_at && now.getTime() - new Date(deal.last_checked_live_at).getTime() < 24 * 60 * 60 * 1000)) update.last_confirmed_via = 'feed';
  if (repriced) {
    // A shortlisted deal keeps its expiry (next_check_due_at is when it is dropped unchecked); the rest move to the recheck cadence.
    Object.assign(update, priceCols, { price_amount: rec.priceAmount, price_period: rec.pricePeriod, screening: rec.screening, deal: rec.deal, annual_profit: rec.annualProfit, uplift_pct: rec.upliftPct, band: rec.band, next_check_due_at: deal.status === 'pending_check' ? deal.next_check_due_at : nextCheckDueAt(l.kind, rec.annualProfit, now) });
    counters.repriced += 1;
  }
  const { error } = await admin.from('marketplace_deals').update(update).eq('canonical_url', deal.canonical_url);
  if (error) console.error(`[${tag}] confirm update failed:`, error.message);
  else counters.confirmed += 1;
}
