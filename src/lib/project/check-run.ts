import 'server-only';

/**
 * The Project job (Batch 17, Part B step 6): the sale listings held on Batch
 * 16's shortlist as Project candidates (status pending_check, stream
 * project) whose own comparables check is done, taken strongest first
 * (rank.ts) and decided:
 *
 *   Prep, once a UK day (free or cheap; nothing is spent on a listing that
 *   cannot pass):
 *     1. its page read again: gone, unsuitable or no longer qualifying →
 *        retired for that; an auction lot → released to Batch 16's flow as an
 *        auction deal (Q10); no longer worded as needing work → released as
 *        an ordinary deal; an exclusion in its own words → project_excluded;
 *     2. the free best case at the page's price → not_project;
 *     3. PropertyData's listed-building and conservation-area checks (Q9) →
 *        project_excluded;
 *     4. the sold prices (pdSoldPrices: 30-day cache, a daily count) → the
 *        value ceiling, or project_no_evidence with too few sales.
 *   The photo check, at most one a run:
 *     5. an earlier check of exactly these photos within 60 days is reused
 *        (the estimate worked out again, free, at today's price); otherwise
 *        a slot is claimed (project_claim_check: one a listing a UK day, the
 *        day's allowance and spend line) and the photos are checked
 *        (photo-check-server.ts);
 *     6. the estimate: ready to go → released as an ordinary Short-let deal;
 *        passes → live as a Project (BRRR) deal (the card numbers on the row,
 *        the full estimate in project_estimates); fails → not_project (Q3).
 *   A step that fails through nobody's fault (the page unreadable, the model
 *   down, an answer that fails validation) leaves the candidate for
 *   tomorrow; after `giveUpDays` such days it is retired project_uncheckable.
 *
 * Live Project deals whose price has moved are re-costed, free, from their
 * stored findings. Every write to a held row is conditional on it still
 * being held (status pending_check, stream project) at the price the steps
 * were taken at, so a sweep or an admin change in between is never
 * overwritten. House spend throughout, never a member's credit; the day's
 * allowance and spend line (deal_checks.projectPhotoChecks, projectCapPence)
 * cover the photo checks, the sold prices and the planning checks together.
 *
 * Every real run is recorded in marketplace_runs (kind project_checks, with
 * who ran it). Entry points: /api/internal/project-checks (cron,
 * secret-gated, ?dry=1) and the /admin/deals buttons. OFF until
 * project_checks.enabled is on AND Batch 16's DEAL_CHECKS_ENABLED is set; a
 * dry run works either way.
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { ask, pdConservationArea, pdListedBuildings, pdSoldPrices } from '../broker';
import { COST_PENCE, providerEnabled } from '../broker/config';
import { resolveListing } from '../listing/server';
import { serverFetchEnabled } from '../listing/fetch';
import { suitabilityFromSnapshot } from '../listing/suitability';
import { projectPhotosFrom } from '../listing/parsers/photos';
import { parseMotivation } from '../listing/motivation';
import type { SourcedListing } from '../listing/sourcing';
import { buildDealRecord, mergeSnapshotIntoListing, qualifiesForMarketplace } from '../marketplace/record';
import { DEAL_COLUMNS, loadScreenContext, loadSourcedListings, priceChangeColumns, recordColumns, revalidateDeals, writeWithoutMissing, type Admin, type ScreenContext } from '../marketplace/server';
import { retiredReasonFor } from '../marketplace/status';
import { nextCheckDueAt } from '../marketplace/cadence';
import type { DealRow, RetiredReason } from '../marketplace/types';
import { checkOf, ukDayStart, validCheckFor } from '../deal-quality/checks';
import { DEFAULT_DEAL_CHECKS } from '../deal-quality/config';
import { streamOfRow } from '../deal-quality/streams';
import { dealChecksEnabled, readDealQualitySettings, type DealQualitySettings } from '../deal-quality/settings-server';
import { ukDay } from '../activity/week';
import { readProjectSettings, type ProjectSettingsRead } from './settings-server';
import { bestCase, ESTIMATE_VERSION, estimateFromFindings } from './estimate';
import { ceilingFrom } from './value';
import { ceilingTypeFor, designationExclusion, pdSoldTypeFor, soldSalesFrom } from './evidence';
import { parseProjectCard } from './headline';
import { priceToAreaMedian, rankCandidates, type CandidateKey } from './rank';
import { photoCheckConfigured, runPhotoCheck, type PhotoCheckOutcome } from './photo-check-server';
import { photoCheckWorstPence } from './photo-check-usage';
import { validatePhotoAnswer } from './photo-check-schema';
import { isMissingColumn, projectColumnsFor } from './read-server';
import {
  capLeftPence,
  claimCapPence,
  dayUseFromRuns,
  emptyDayUse,
  failedDay,
  needsPrep,
  needsRecost,
  parsePrep,
  photoChecksLeft,
  PROJECT_CHECKS_ACTION,
  PROJECT_CHECKS_KIND,
  projectFactsOf,
  readyForCheck,
  reusableCheck,
  verdictFor,
  type CheckVerdict,
  type EarlierCheck,
  type Prep,
  type PrepFacts,
  type PrepOutcome,
  type ProjectDayUse,
} from './check-plan';

/** Vercel gives the route 60 seconds; the run keeps a margin for its own writes. */
const RUN_BUDGET_MS = 55_000;
/** A photo check is only started with this much of the run left. */
const PHOTO_CHECK_MIN_MS = 40_000;
/** A prep (a page read and up to three PropertyData calls) is only started with this much left. */
const PREP_MIN_MS = 20_000;
/** Between a prep's steps: stop rather than start a call that could run past the budget. */
const STEP_MIN_MS = 8_000;
const SNAPSHOT_WAIT_MS = 10_000;
/** Live Project deals re-costed a run, at most (database work only). */
const RECOSTS_PER_RUN = 10;
const RECOST_MS = 5_000;
const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
/** The sold prices asked for: the ceiling's window, whole months. */
const PD_CTX = { mode: 'cron' as const, userId: null };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

// ── Reads ──

interface Candidate {
  row: DealRow;
  listing: SourcedListing | null;
  prep: Prep | null;
  price: number | null;
  key: CandidateKey;
  claimedToday: boolean;
}

/** The rows held for a Project check; null when unreadable, [] when the schema has no stream column yet. */
async function loadHeld(admin: Admin): Promise<DealRow[] | null> {
  const { data, error } = await admin.from('marketplace_deals').select(DEAL_COLUMNS).eq('status', 'pending_check').eq('stream', 'project').order('first_seen_at', { ascending: true }).limit(500);
  if (error) {
    if (isMissingColumn(error)) return [];
    console.error('[project-checks] held rows unreadable:', error.message);
    return null;
  }
  return (data ?? []) as unknown as DealRow[];
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(error.message ?? '')));
}

async function loadPreps(admin: Admin, urls: readonly string[]): Promise<Map<string, Prep> | 'missing' | null> {
  const out = new Map<string, Prep>();
  for (let i = 0; i < urls.length; i += 150) {
    const { data, error } = await admin.from('project_prep').select('*').in('canonical_url', urls.slice(i, i + 150));
    if (error) {
      if (isMissingTable(error)) return 'missing';
      console.error('[project-checks] prep unreadable:', error.message);
      return null;
    }
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const p = parsePrep(r);
      if (p) out.set(String(r.canonical_url), p);
    }
  }
  return out;
}

/** Today's claims and the day's other spend, from project_checks and the day's runs. */
async function loadDayUse(admin: Admin, today: string, dayStart: Date): Promise<{ use: ProjectDayUse; claimed: Set<string> } | null> {
  const [claims, runs] = await Promise.all([
    admin.from('project_checks').select('canonical_url, cost_pence').eq('check_day', today).limit(1000),
    admin.from('marketplace_runs').select('summary').eq('kind', PROJECT_CHECKS_KIND).eq('dry', false).gte('started_at', dayStart.toISOString()).limit(500),
  ]);
  if (claims.error || runs.error) {
    // Unreadable: plan as if the day were spent, which is the safe side.
    console.warn('[project-checks] day use unreadable:', claims.error?.message ?? runs.error?.message);
    return null;
  }
  const rows = (claims.data ?? []) as { canonical_url: string; cost_pence: unknown }[];
  const other = dayUseFromRuns(((runs.data ?? []) as { summary: unknown }[]).map((r) => r.summary));
  return {
    use: { photoChecks: rows.length, photoPence: Math.round(rows.reduce((n, r) => n + (num(r.cost_pence) ?? 0), 0) * 100) / 100, otherPence: other.otherPence, soldLookups: other.soldLookups },
    claimed: new Set(rows.map((r) => r.canonical_url)),
  };
}

/** The median asking price a bedroom of the live sale deals in each area, for the ranking's last key. */
async function areaMedians(admin: Admin, areas: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (areas.length === 0) return out;
  const { data, error } = await admin.from('marketplace_deals').select('postcode_area, price_amount, bedrooms').eq('status', 'live').eq('kind', 'sale').in('postcode_area', [...areas]).limit(5000);
  if (error) {
    console.warn('[project-checks] area prices unreadable:', error.message);
    return out;
  }
  const byArea = new Map<string, number[]>();
  for (const r of (data ?? []) as { postcode_area: string | null; price_amount: unknown; bedrooms: number | null }[]) {
    const p = num(r.price_amount);
    if (!r.postcode_area || p === null || p <= 0) continue;
    const list = byArea.get(r.postcode_area) ?? [];
    list.push(p / Math.max(1, r.bedrooms ?? 1));
    byArea.set(r.postcode_area, list);
  }
  for (const [area, list] of byArea) {
    list.sort((a, b) => a - b);
    const mid = Math.floor(list.length / 2);
    out.set(area, list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2);
  }
  return out;
}

/** The earlier finished photo checks of these listings, newest first. */
async function earlierChecks(admin: Admin, url: string): Promise<EarlierCheck[]> {
  const { data, error } = await admin.from('project_checks').select('id, photos, floorplans, findings, created_at').eq('canonical_url', url).eq('status', 'done').order('created_at', { ascending: false }).limit(5);
  if (error) {
    console.warn('[project-checks] earlier checks unreadable:', error.message);
    return [];
  }
  const out: EarlierCheck[] = [];
  for (const r of (data ?? []) as { id: string; photos: unknown; floorplans: unknown; findings: unknown; created_at: string }[]) {
    const photos = Array.isArray(r.photos) ? r.photos.filter((x): x is string => typeof x === 'string') : [];
    const floorplans = Array.isArray(r.floorplans) ? r.floorplans.filter((x): x is string => typeof x === 'string') : [];
    // Stored answers go through the validator again: a stored answer is never trusted blind.
    const checked = validatePhotoAnswer(r.findings, photos.length + floorplans.length);
    if (checked.ok) out.push({ id: r.id, photos, floorplans, findings: checked.findings, at: r.created_at });
  }
  return out;
}

// ── Writes (every one to a held row is conditional on it still being held) ──

type HeldFilter = { price?: number | null };

/** Updates a held row; the number of rows it matched (0: it was no longer held at that price). */
async function writeHeld(admin: Admin, url: string, update: Record<string, unknown>, f: HeldFilter, tag = 'project-checks'): Promise<number> {
  const { data, error } = await writeWithoutMissing(update, (u) => {
    let q = admin.from('marketplace_deals').update(u).eq('canonical_url', url).eq('status', 'pending_check').eq('stream', 'project');
    if (f.price !== undefined && f.price !== null) q = q.eq('price_amount', f.price);
    return q.select('canonical_url');
  }, tag);
  if (error) {
    console.error(`[${tag}] held row write failed:`, error.message);
    return 0;
  }
  return (data as unknown[] | null)?.length ?? 0;
}

async function retireHeld(admin: Admin, url: string, reason: RetiredReason, now: Date, f: HeldFilter = {}): Promise<boolean> {
  const nowIso = now.toISOString();
  return (await writeHeld(admin, url, { status: 'retired', retired_reason: reason, retired_at: nowIso, check_requested_at: null, next_check_due_at: null, updated_at: nowIso }, f)) > 0;
}

/** Back to the ordinary flow: live (its page was read today), in the stream its own deal puts it in. */
async function releaseHeld(admin: Admin, row: DealRow, dq: DealQualitySettings, now: Date, f: HeldFilter = {}): Promise<boolean> {
  const nowIso = now.toISOString();
  const stream = streamOfRow({ kind: row.kind, deal: row.deal }, dq.lowEntry);
  const update = { status: 'live', stream, project: null, next_check_due_at: nextCheckDueAt(row.kind, num(row.annual_profit), now), check_failures: 0, updated_at: nowIso };
  return (await writeHeld(admin, row.canonical_url, update, f)) > 0;
}

async function upsertPrep(admin: Admin, url: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('project_prep').upsert({ canonical_url: url, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'canonical_url' });
  if (error) console.error('[project-checks] prep write failed:', error.message);
}

/** A failed day, counted; the candidate let go at the last one. */
async function recordFailedDay(admin: Admin, c: Candidate, today: string, s: ProjectSettingsRead, now: Date, why: string): Promise<StepResult> {
  const f = failedDay(c.prep, today, s.checks.giveUpDays);
  await upsertPrep(admin, c.row.canonical_url, { deal_id: c.row.id, failed_days: f.failedDays, last_failed_day: f.lastFailedDay, outcome: 'failed' as PrepOutcome });
  if (c.prep) c.prep = { ...c.prep, failedDays: f.failedDays, lastFailedDay: f.lastFailedDay, outcome: 'failed' };
  else c.prep = { price: c.price, preppedOn: null, photos: [], floorplans: [], facts: null, ceiling: null, outcome: 'failed', failedDays: f.failedDays, lastFailedDay: f.lastFailedDay };
  if (f.giveUp) {
    await retireHeld(admin, c.row.canonical_url, 'project_uncheckable', now);
    return { outcome: 'uncheckable', error: why };
  }
  return { outcome: 'failed', error: why };
}

// ── The steps ──

interface StepResult {
  outcome: string;
  error?: string;
  /** Raw pence this step spent on PropertyData (the photo check's spend is in project_checks). */
  otherPence?: number;
  soldLookups?: number;
  photoPence?: number;
}

interface RunEnv {
  admin: Admin;
  settings: ProjectSettingsRead;
  dq: DealQualitySettings;
  today: string;
  now: Date;
  deadline: number;
  use: ProjectDayUse;
  /** Spent by this run so far, on top of `use`. */
  spent: { otherPence: number; soldLookups: number; photoPence: number; photoChecks: number };
  ctx: ScreenContext | null;
}

const remaining = (env: RunEnv) => env.deadline - Date.now();

/** What this run may still spend, raw pence. */
function capLeft(env: RunEnv): number {
  return capLeftPence(env.settings.allowance, { ...env.use, otherPence: env.use.otherPence + env.spent.otherPence, photoPence: env.use.photoPence + env.spent.photoPence });
}

/**
 * Prep: the page, the free tests and the cheaper lookups (see the header).
 * Returns what happened; writes the prep row and any retire or release.
 */
async function prepCandidate(env: RunEnv, c: Candidate): Promise<StepResult> {
  const { admin, settings: s, now, today } = env;
  const row = c.row;
  const url = row.canonical_url;
  if (!c.listing) {
    await retireHeld(admin, url, 'removed', now);
    return { outcome: 'removed', error: 'sourced listing gone' };
  }
  if (!serverFetchEnabled(row.source)) {
    // A page that can never be read can never be photo-checked (Zoopla).
    await retireHeld(admin, url, 'project_uncheckable', now);
    return { outcome: 'uncheckable', error: `${row.source} pages are not read` };
  }
  if (!env.ctx) return { outcome: 'skipped', error: 'snapshot_warming' };
  const ctx = env.ctx;

  // 1. The page, read again (the HTML only for the photos; never kept).
  const page: { html: string | null } = { html: null };
  const res = await resolveListing(url, {
    refresh: true,
    onHtml: (h) => {
      page.html = h;
    },
  });
  if (!res.ok) {
    if (res.code === 'not_found') {
      await retireHeld(admin, url, 'removed', now);
      return { outcome: 'removed' };
    }
    // The whole site paused or switched off is not this listing's failure.
    if (res.code === 'paused' || res.code === 'disabled') return { outcome: 'skipped', error: `source ${res.code}` };
    return recordFailedDay(admin, c, today, s, now, `page ${res.code}`);
  }
  const snap = res.snapshot;
  const gone = retiredReasonFor(snap.status ?? null);
  if (gone) {
    await retireHeld(admin, url, gone, now);
    return { outcome: gone };
  }
  const merged = mergeSnapshotIntoListing(c.listing, snap);
  const nowIso = now.toISOString();
  const { error: snapErr } = await admin.from('sourced_listings').update({ snapshot: merged, last_seen_at: nowIso }).eq('canonical_url', url);
  if (snapErr) console.error('[project-checks] snapshot write failed:', snapErr.message);
  if (suitabilityFromSnapshot(snap, 'sale') !== 'ok') {
    await retireHeld(admin, url, 'unsuitable', now);
    return { outcome: 'unsuitable' };
  }
  const card = (merged.postcodeArea ? ctx.cardByCode.get(merged.postcodeArea) : null) ?? (row.postcode_area ? ctx.cardByCode.get(row.postcode_area) : null) ?? null;
  const check = validCheckFor(checkOf(row.screening), merged, ctx.rules.checks?.validDays ?? DEFAULT_DEAL_CHECKS.validDays, now);
  const rec = buildDealRecord(merged, { card, rentTable: ctx.rentTable, r2rBar: ctx.r2rBar, rules: ctx.rules, check, firstSeenAt: row.first_seen_at, now });
  if (!qualifiesForMarketplace(rec)) {
    await retireHeld(admin, url, 'unqualified', now);
    return { outcome: 'unqualified' };
  }
  // The row as the page describes it, still held; a price move is recorded as any reprice is.
  const { columns: priceCols } = priceChangeColumns(row, rec, nowIso);
  const written = await writeHeld(admin, url, {
    ...recordColumns(merged, rec),
    ...priceCols,
    stream: 'project',
    photos: snap.photos.length > 0 ? snap.photos : (row.photos ?? null),
    last_seen_at: nowIso,
    last_checked_live_at: nowIso,
    last_confirmed_at: nowIso,
    last_confirmed_via: 'live',
    updated_at: nowIso,
  }, {});
  if (written === 0) return { outcome: 'skipped', error: 'no longer held' };
  const price = rec.priceAmount;
  c.price = price;
  c.row = { ...row, price_amount: price, deal: rec.deal as DealRow['deal'], annual_profit: rec.annualProfit } as DealRow;
  const released = { ...c.row };

  if (merged.auction === true) {
    // Q10: an auction lot stays one of Batch 16's auction deals.
    await releaseHeld(admin, released, env.dq, now, { price });
    await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, outcome: 'auction' as PrepOutcome });
    return { outcome: 'auction' };
  }
  if (!merged.needsWork?.flag) {
    await releaseHeld(admin, released, env.dq, now, { price });
    await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, outcome: 'released' as PrepOutcome });
    return { outcome: 'released' };
  }
  if (merged.projectExclusion) {
    await retireHeld(admin, url, 'project_excluded', now, { price });
    await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, exclusion: merged.projectExclusion, outcome: 'excluded' as PrepOutcome });
    return { outcome: 'excluded', error: merged.projectExclusion };
  }

  // 2. The free best case at the page's price.
  const facts = projectFactsOf({ bedrooms: merged.bedrooms, bathrooms: merged.bathrooms, rawType: merged.rawType, floorAreaSqft: merged.floorAreaSqft ?? null, postcode: merged.postcode, outcode: merged.outcode });
  if (price === null || price <= 0 || !facts) {
    await retireHeld(admin, url, 'project_uncheckable', now);
    return { outcome: 'uncheckable', error: 'no price or bedrooms' };
  }
  const best = bestCase(price, facts, s);
  if (!best.passes) {
    await retireHeld(admin, url, 'not_project', now, { price });
    await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, facts, best_case: best, outcome: 'not_project' as PrepOutcome });
    return { outcome: 'not_project', error: 'best case' };
  }

  const photos = page.html ? projectPhotosFrom(merged.source, page.html, s.checks.maxPhotos) : { photos: [], floorplans: [] };
  if (photos.photos.length === 0) return recordFailedDay(admin, c, today, s, now, 'no photos on the page');

  // 3 and 4 need PropertyData and a full postcode.
  const postcode = merged.postcode?.trim() ?? '';
  if (!FULL_POSTCODE.test(postcode)) {
    await retireHeld(admin, url, 'project_no_evidence', now, { price });
    await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, facts, best_case: best, outcome: 'no_evidence' as PrepOutcome });
    return { outcome: 'no_evidence', error: 'no full postcode' };
  }
  if (!providerEnabled('propertydata')) return { outcome: 'skipped', error: 'PROPERTYDATA_API_KEY is not set' };
  let otherPence = 0;
  let soldLookups = 0;
  const spend = (pence: number) => {
    otherPence += pence;
    env.spent.otherPence += pence;
  };

  // 3. The planning checks (Q9): a listed building at the postcode, or a conservation area.
  let designation: { listed: boolean | null; conservation: boolean | null } | null = null;
  if (s.checks.planningChecks) {
    if (remaining(env) < STEP_MIN_MS) return { outcome: 'skipped', error: 'out of time' };
    if (capLeft(env) < 2 * COST_PENCE.propertydataCall) return { outcome: 'skipped', error: 'the day’s cap' };
    const [listed, conservation] = await Promise.all([ask(pdListedBuildings, { postcode }, PD_CTX), ask(pdConservationArea, { postcode }, PD_CTX)]);
    spend((listed.costPence ?? 0) + (conservation.costPence ?? 0));
    const excluded = designationExclusion(listed.value, conservation.value);
    designation = { listed: listed.value ? excluded === 'listed' : null, conservation: conservation.value ? conservation.value.inside === true : null };
    if (excluded) {
      await retireHeld(admin, url, 'project_excluded', now, { price });
      await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, facts, best_case: best, exclusion: excluded, designation, designation_checked_at: nowIso, outcome: 'excluded' as PrepOutcome });
      return { outcome: 'excluded', error: excluded, otherPence, soldLookups };
    }
  }

  // 4. The sold prices, and the ceiling on them.
  if (remaining(env) < STEP_MIN_MS) return { outcome: 'skipped', error: 'out of time', otherPence, soldLookups };
  const ceilingType = ceilingTypeFor(facts.homeType);
  const lookupsLeft = s.checks.soldLookupsPerDay - (env.use.soldLookups + env.spent.soldLookups);
  const mayBuy = lookupsLeft > 0 && capLeft(env) >= COST_PENCE.propertydataCall;
  const lat = merged.lat ?? snap.lat ?? null;
  const lng = merged.lng ?? snap.lng ?? null;
  const sold = await ask(pdSoldPrices, { postcode, type: pdSoldTypeFor(facts.homeType), maxAgeMonths: s.ceiling.months, from: lat !== null && lng !== null ? { lat, lng } : null }, mayBuy ? PD_CTX : { ...PD_CTX, cacheOnly: true });
  if (!sold.cached && sold.costPence > 0) {
    soldLookups += 1;
    env.spent.soldLookups += 1;
    spend(sold.costPence);
  }
  if (!sold.value) {
    // Not in the cache and nothing more may be bought today: tomorrow, not a failure.
    if (!mayBuy) return { outcome: 'waiting', error: 'the day’s sold-price lookups', otherPence, soldLookups };
    return { ...(await recordFailedDay(admin, c, today, s, now, 'sold prices unavailable')), otherPence, soldLookups };
  }
  const ceiling = ceilingFrom(soldSalesFrom(sold.value), { homeType: ceilingType, bedrooms: facts.bedrooms }, now, s.ceiling);
  if (!ceiling) {
    await retireHeld(admin, url, 'project_no_evidence', now, { price });
    await upsertPrep(admin, url, { deal_id: row.id, price, prepped_on: today, facts, best_case: best, designation, designation_checked_at: designation ? nowIso : null, sold_checked_at: nowIso, ceiling: null, outcome: 'no_evidence' as PrepOutcome });
    return { outcome: 'no_evidence', otherPence, soldLookups };
  }

  await upsertPrep(admin, url, {
    deal_id: row.id,
    price,
    prepped_on: today,
    photos: photos.photos,
    floorplans: photos.floorplans,
    facts,
    best_case: best,
    exclusion: null,
    ceiling,
    sold_checked_at: nowIso,
    designation,
    designation_checked_at: designation ? nowIso : null,
    outcome: 'ready' as PrepOutcome,
  });
  c.prep = { price, preppedOn: today, photos: photos.photos, floorplans: photos.floorplans, facts, ceiling, outcome: 'ready', failedDays: c.prep?.failedDays ?? 0, lastFailedDay: c.prep?.lastFailedDay ?? null };
  return { outcome: 'ready', otherPence, soldLookups };
}

/** The verdict written: live as a Project deal, released, or never shown. */
async function applyVerdict(env: RunEnv, c: Candidate, verdict: CheckVerdict, price: number, used: { photos: string[]; floorplans: string[] }, checkId: string | null): Promise<string> {
  const { admin, now } = env;
  const url = c.row.canonical_url;
  if (verdict.kind === 'ready') {
    return (await releaseHeld(admin, c.row, env.dq, now, { price })) ? 'ready' : 'skipped';
  }
  if (verdict.kind === 'not_project') {
    return (await retireHeld(admin, url, 'not_project', now, { price })) ? 'not_project' : 'skipped';
  }
  // The full estimate first (private, read only after an open), then the row goes live with its card numbers.
  const { error: estErr } = await admin.from('project_estimates').upsert(
    { deal_id: c.row.id, canonical_url: url, version: ESTIMATE_VERSION, price, estimate: verdict.estimate, photos: [...used.photos, ...used.floorplans], check_id: checkId, estimated_at: now.toISOString() },
    { onConflict: 'deal_id' },
  );
  if (estErr) {
    console.error('[project-checks] estimate write failed:', estErr.message);
    return 'failed';
  }
  const nowIso = now.toISOString();
  const live = await writeHeld(admin, url, { status: 'live', project: verdict.card, next_check_due_at: nextCheckDueAt('sale', num(c.row.annual_profit), now), check_failures: 0, updated_at: nowIso }, { price });
  return live > 0 ? 'project' : 'skipped';
}

/** The photo check (or an earlier one reused) and its verdict, for one prepped candidate. */
async function photoCheckCandidate(env: RunEnv, c: Candidate): Promise<StepResult> {
  const { admin, settings: s, now, today } = env;
  const prep = c.prep!;
  const facts = prep.facts as PrepFacts;
  const price = prep.price as number;
  const url = c.row.canonical_url;
  const estimateOn = (findings: Parameters<typeof estimateFromFindings>[0]['findings']) =>
    verdictFor(estimateFromFindings({ price, facts, country: facts.country, ceiling: prep.ceiling, findings, settings: s, bridging: s.bridging }), facts.bedrooms, now);

  const earlier = reusableCheck(await earlierChecks(admin, url), { photos: prep.photos, floorplans: prep.floorplans }, now, s.checks.reuseDays);
  if (earlier) {
    const outcome = await applyVerdict(env, c, estimateOn(earlier.findings), price, { photos: [...earlier.photos], floorplans: [...earlier.floorplans] }, earlier.id);
    return { outcome: `${outcome} (reused)` };
  }

  const images = prep.photos.length + prep.floorplans.length;
  const { data: claim, error: claimErr } = await admin.rpc('project_claim_check', {
    p_url: url,
    p_deal: c.row.id,
    p_day: today,
    p_max: s.allowance.photoChecks,
    p_cap_pence: claimCapPence(s.allowance, env.use.otherPence + env.spent.otherPence),
    p_worst_pence: photoCheckWorstPence(images),
  });
  if (claimErr) {
    console.error('[project-checks] claim failed:', claimErr.message);
    return { outcome: 'stopped', error: `claim: ${claimErr.message}` };
  }
  const claimed = claim as { ok?: boolean; reason?: string | null } | null;
  if (!claimed?.ok) return { outcome: 'stopped', error: claimed?.reason ?? 'not claimed' };
  env.spent.photoChecks += 1;
  c.claimedToday = true;

  const result: PhotoCheckOutcome = await runMetered({ userId: null, admin: false, action: PROJECT_CHECKS_ACTION, actionId: newActionId() }, () =>
    runPhotoCheck({ photos: prep.photos, floorplans: prep.floorplans, bedrooms: facts.bedrooms, bathrooms: facts.bathrooms, propertyType: facts.rawType, effort: s.checks.effort, deadline: env.deadline }),
  );
  env.spent.photoPence += result.costPence;
  const finished = new Date().toISOString();
  const record = result.ok
    ? { status: 'done', model: result.model, fell_back: result.fellBack, photos: result.used.photos, floorplans: result.used.floorplans, findings: result.findings, usage: result.usage, cost_pence: result.costPence, error: null, finished_at: finished }
    : { status: result.reason === 'refused' || result.reason === 'invalid' || result.reason === 'max_tokens' || result.reason === 'unavailable' ? result.reason : 'failed', photos: prep.photos, floorplans: prep.floorplans, usage: result.usage, cost_pence: result.costPence, error: result.detail ?? result.reason, finished_at: finished };
  const { data: checkRow, error: recErr } = await admin.from('project_checks').update(record).eq('canonical_url', url).eq('check_day', today).select('id').maybeSingle();
  if (recErr) console.error('[project-checks] check record failed:', recErr.message);
  if (!result.ok) return { ...(await recordFailedDay(admin, c, today, s, now, `photo check ${result.reason}`)), photoPence: result.costPence };
  const outcome = await applyVerdict(env, c, estimateOn(result.findings), price, result.used, (checkRow as { id?: string } | null)?.id ?? null);
  return { outcome, photoPence: result.costPence };
}

/** Live Project deals whose price has moved since they were costed. */
async function loadMoved(admin: Admin): Promise<{ id: string; canonical_url: string; price_amount: unknown; project: unknown }[]> {
  const { data, error } = await admin.from('marketplace_deals').select('id, canonical_url, price_amount, project').eq('status', 'live').not('project', 'is', null).limit(1000);
  if (error) {
    if (!isMissingColumn(error)) console.warn('[project-checks] live Project deals unreadable:', error.message);
    return [];
  }
  return ((data ?? []) as { id: string; canonical_url: string; price_amount: unknown; project: unknown }[]).filter((r) => needsRecost(parseProjectCard(r.project), num(r.price_amount)));
}

/**
 * Live Project deals whose price has moved: the estimate again, free, from
 * the stored findings, the facts and the ceiling. A few a run, within a few
 * seconds, so the photo check keeps its time.
 */
async function recostLive(env: RunEnv): Promise<{ recosted: number; retired: number; skipped: number }> {
  const { admin, settings: s, now } = env;
  const out = { recosted: 0, retired: 0, skipped: 0 };
  const started = Date.now();
  const moved = await loadMoved(admin);
  for (const r of moved) {
    if (out.recosted + out.retired >= RECOSTS_PER_RUN || Date.now() - started > RECOST_MS) break;
    const price = num(r.price_amount) as number;
    const [{ data: est }, { data: prepRow }] = await Promise.all([
      admin.from('project_estimates').select('check_id, photos').eq('deal_id', r.id).maybeSingle(),
      admin.from('project_prep').select('*').eq('canonical_url', r.canonical_url).maybeSingle(),
    ]);
    const checkId = (est as { check_id?: string | null } | null)?.check_id ?? null;
    const prep = parsePrep(prepRow as Record<string, unknown> | null);
    const { data: chk } = checkId ? await admin.from('project_checks').select('findings, photos, floorplans').eq('id', checkId).maybeSingle() : { data: null };
    const c = chk as { findings: unknown; photos: unknown; floorplans: unknown } | null;
    const photos = Array.isArray(c?.photos) ? (c!.photos as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const floorplans = Array.isArray(c?.floorplans) ? (c!.floorplans as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const checked = c ? validatePhotoAnswer(c.findings, photos.length + floorplans.length) : null;
    if (!checked?.ok || !prep?.facts) {
      out.skipped += 1;
      continue;
    }
    const facts = prep.facts;
    const verdict = verdictFor(estimateFromFindings({ price, facts, country: facts.country, ceiling: prep.ceiling, findings: checked.findings, settings: s, bridging: s.bridging }), facts.bedrooms, now);
    const nowIso = now.toISOString();
    if (verdict.kind === 'project') {
      await admin.from('project_estimates').upsert({ deal_id: r.id, canonical_url: r.canonical_url, version: ESTIMATE_VERSION, price, estimate: verdict.estimate, photos: [...photos, ...floorplans], check_id: checkId, estimated_at: nowIso }, { onConflict: 'deal_id' });
      const { error: upErr } = await admin.from('marketplace_deals').update({ project: verdict.card, updated_at: nowIso }).eq('id', r.id).eq('status', 'live').eq('price_amount', price);
      if (upErr) console.error('[project-checks] re-cost write failed:', upErr.message);
      else out.recosted += 1;
    } else if (verdict.kind === 'not_project') {
      // At its new price the value added no longer passes: never shown (Q3).
      const { error: upErr } = await admin.from('marketplace_deals').update({ status: 'retired', retired_reason: 'not_project', retired_at: nowIso, next_check_due_at: null, updated_at: nowIso }).eq('id', r.id).eq('status', 'live').eq('price_amount', price);
      if (upErr) console.error('[project-checks] re-cost retire failed:', upErr.message);
      else out.retired += 1;
    } else {
      out.skipped += 1;
    }
  }
  return out;
}

// ── The run ──

export interface ProjectRunOptions {
  dry: boolean;
  /** 'cron', 'internal', or the admin's email. */
  triggeredBy: string;
  /** Candidates this run may prep, at most (the photo check is always at most one). */
  maxPreps?: number;
}

export interface ProjectRunResult {
  status: number;
  body: Record<string, unknown>;
}

/** The project checks' switch: its own setting AND Batch 16's checks (the hold rests on its shortlist). */
export function projectChecksOn(settings: Pick<ProjectSettingsRead, 'checks'>): boolean {
  return settings.checks.enabled && dealChecksEnabled();
}

async function recordRun(admin: Admin, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: PROJECT_CHECKS_KIND, dry: false, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[project-checks] run record failed:', error.message);
}

/** A candidate for the run's summary and the dry run: area, bedrooms, type and its best case; never an address. */
const describe = (c: Candidate) =>
  `${c.row.postcode_area ?? '?'} · ${c.row.bedrooms ?? '?'} bed ${c.row.raw_type ?? 'sale'} · ${c.key.bestCaseValueAdded === Number.MIN_SAFE_INTEGER ? 'best case unknown' : `best case £${Math.round(c.key.bestCaseValueAdded / 1000)}k value added`}`;

export async function runProjectChecks(opts: ProjectRunOptions): Promise<ProjectRunResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + RUN_BUDGET_MS;
  const done = (result: ProjectRunResult): ProjectRunResult => {
    const { results: _r, candidates: _c, ...rest } = result.body;
    void _r;
    void _c;
    console.log('[project-checks] run', JSON.stringify({ status: result.status, ms: Date.now() - startedAt.getTime(), ...rest }));
    return result;
  };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: 'Storage not configured' } });
  }
  const [settings, dq] = await Promise.all([readProjectSettings(admin), readDealQualitySettings(admin)]);
  const today = ukDay(startedAt);
  const dayStart = ukDayStart(startedAt);

  const held = await loadHeld(admin);
  if (!held) return done({ status: 500, body: { error: 'Could not read the held candidates' } });
  const urls = held.map((r) => r.canonical_url);
  const [preps, dayRead, listings, columns] = await Promise.all([loadPreps(admin, urls), loadDayUse(admin, today, dayStart), loadSourcedListings(admin, urls), projectColumnsFor(admin, urls)]);
  if (preps === 'missing') return done({ status: 503, body: { error: 'The Batch 17 schema section has not been run (project_prep is missing).' } });
  if (!preps) return done({ status: 500, body: { error: 'Could not read the candidates’ prep' } });
  const use = dayRead?.use ?? { ...emptyDayUse(), photoChecks: settings.allowance.photoChecks, photoPence: settings.allowance.capPence };
  const claimed = dayRead?.claimed ?? new Set<string>();
  const medians = await areaMedians(admin, [...new Set(held.map((r) => r.postcode_area).filter((a): a is string => Boolean(a)))]);

  // Only candidates with their own comparables check are this job's; the rest wait on Batch 16's.
  const waitingComps = held.filter((r) => !checkOf(r.screening)).length;
  const candidates: Candidate[] = rankCandidates(
    held
      .filter((r) => checkOf(r.screening))
      .map((row) => {
        const listing = listings.get(row.canonical_url)?.listing ?? null;
        const price = num(row.price_amount);
        const facts = projectFactsOf({ bedrooms: listing?.bedrooms ?? row.bedrooms, bathrooms: listing?.bathrooms ?? null, rawType: listing?.rawType ?? row.raw_type, floorAreaSqft: listing?.floorAreaSqft ?? null, postcode: listing?.postcode ?? null, outcode: row.outcode });
        const best = price !== null && price > 0 && facts ? bestCase(price, facts, settings) : null;
        const key: CandidateKey = {
          bestCaseValueAdded: best?.valueAdded ?? Number.MIN_SAFE_INTEGER,
          wordingScore: columns.get(row.canonical_url)?.needsWork?.score ?? 0,
          motivationScore: parseMotivation(row.motivation)?.score ?? null,
          priceToAreaMedian: priceToAreaMedian(price, row.bedrooms, row.postcode_area ? medians.get(row.postcode_area) ?? null : null),
        };
        return { row, listing, prep: preps.get(row.canonical_url) ?? null, price, key, claimedToday: claimed.has(row.canonical_url) };
      }),
  );
  const ready = () => candidates.filter((c) => !c.claimedToday && readyForCheck(c.prep, c.price, today));
  const toPrep = () => candidates.filter((c) => needsPrep(c.prep, c.price, today));

  const summary: Record<string, unknown> = {
    dry: opts.dry,
    enabled: settings.checks.enabled,
    dealChecksEnabled: dealChecksEnabled(),
    configured: { anthropic: photoCheckConfigured(), propertydata: providerEnabled('propertydata') },
    triggeredBy: opts.triggeredBy,
    day: today,
    allowance: settings.allowance,
    usedBefore: use,
    photoChecksLeft: photoChecksLeft(settings.allowance, use),
    capLeftPence: capLeftPence(settings.allowance, use),
    soldLookupsLeft: Math.max(0, settings.checks.soldLookupsPerDay - use.soldLookups),
    waiting: { comparables: waitingComps, prep: toPrep().length, photoCheck: ready().length },
  };

  if (opts.dry) {
    const next = ready()[0] ?? null;
    const moved = await loadMoved(admin);
    return done({
      status: 200,
      body: {
        ...summary,
        nextPhotoCheck: next ? { what: describe(next), worstCasePence: photoCheckWorstPence((next.prep?.photos.length ?? 0) + (next.prep?.floorplans.length ?? 0)) } : null,
        wouldRecost: moved.length,
        wouldPrep: toPrep().slice(0, 20).map(describe),
        candidates: candidates.slice(0, 30).map((c) => `${describe(c)} · ${c.claimedToday ? 'checked today' : readyForCheck(c.prep, c.price, today) ? 'ready for its photo check' : c.prep?.lastFailedDay === today ? 'failed today' : 'to prep'}`),
      },
    });
  }

  const env: RunEnv = { admin, settings, dq, today, now: startedAt, deadline, use, spent: { otherPence: 0, soldLookups: 0, photoPence: 0, photoChecks: 0 }, ctx: null };
  const recost = await recostLive(env);
  const results: { what: string; step: 'prep' | 'photo_check'; outcome: string; error?: string }[] = [];
  let photoChecked = false;
  let preps_ = 0;
  let stoppedBy: string | null = null;
  const canPhotoCheck = () => !photoChecked && photoCheckConfigured() && remaining(env) >= PHOTO_CHECK_MIN_MS && photoChecksLeft(settings.allowance, use) - env.spent.photoChecks > 0 && capLeft(env) > 0;
  const maxPreps = Math.max(0, Math.floor(opts.maxPreps ?? Number.POSITIVE_INFINITY));

  // A prep is good for its UK day only: prep no more than the day's photo checks still left can use.
  const checksLeftToday = () => photoChecksLeft(settings.allowance, use) - env.spent.photoChecks;
  for (;;) {
    if (canPhotoCheck()) {
      const next = ready()[0];
      if (next) {
        const r = await photoCheckCandidate(env, next);
        results.push({ what: describe(next), step: 'photo_check', outcome: r.outcome, error: r.error });
        photoChecked = true;
        if (r.outcome === 'stopped') stoppedBy = r.error ?? 'allowance';
        continue;
      }
    }
    const next = toPrep()[0];
    if (!next) break;
    if (checksLeftToday() <= 0 || capLeft(env) <= 0) {
      stoppedBy = stoppedBy ?? 'allowance';
      break;
    }
    if (ready().length >= checksLeftToday()) {
      stoppedBy = stoppedBy ?? 'enough_ready';
      break;
    }
    if (preps_ >= maxPreps) {
      stoppedBy = stoppedBy ?? 'max';
      break;
    }
    if (remaining(env) < PREP_MIN_MS) {
      stoppedBy = stoppedBy ?? 'time';
      break;
    }
    if (!env.ctx) {
      env.ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
      if (!env.ctx) {
        stoppedBy = 'snapshot_warming';
        break;
      }
    }
    preps_ += 1;
    const r = await runMetered({ userId: null, admin: false, action: PROJECT_CHECKS_ACTION, actionId: newActionId() }, () => prepCandidate(env, next));
    results.push({ what: describe(next), step: 'prep', outcome: r.outcome, error: r.error });
    if (r.outcome === 'skipped' || r.outcome === 'waiting') {
      // Not prepped, and not to be tried again this run.
      next.prep = { ...(next.prep ?? { price: next.price, preppedOn: null, photos: [], floorplans: [], facts: null, ceiling: null, outcome: null, failedDays: 0 }), lastFailedDay: today };
      if (r.error === 'out of time' || r.error === 'the day’s cap' || r.error?.startsWith('PROPERTYDATA')) {
        stoppedBy = r.error;
        break;
      }
    }
  }

  const outcomes: Record<string, number> = {};
  for (const r of results) outcomes[`${r.step}:${r.outcome}`] = (outcomes[`${r.step}:${r.outcome}`] ?? 0) + 1;
  const otherPence = Math.round(env.spent.otherPence * 100) / 100;
  const photoPence = Math.round(env.spent.photoPence * 100) / 100;
  Object.assign(summary, {
    recost,
    preps: preps_,
    photoChecks: env.spent.photoChecks,
    outcomes,
    otherPence,
    photoPence,
    soldLookups: env.spent.soldLookups,
    rawCostPence: Math.round((otherPence + photoPence) * 100) / 100,
    stoppedBy,
    results,
    ms: Date.now() - startedAt.getTime(),
  });
  await recordRun(admin, startedAt, summary);
  if (results.length > 0 || recost.recosted + recost.retired > 0) revalidateDeals();
  return done({ status: 200, body: summary });
}

// ── The admin view ──

export interface ProjectRunRow {
  id: string;
  started_at: string;
  summary: Record<string, unknown>;
}

export interface ProjectChecksView {
  /** project_checks.enabled. */
  enabled: boolean;
  /** Batch 16's DEAL_CHECKS_ENABLED: the hold needs it. */
  dealChecksOn: boolean;
  configured: { anthropic: boolean; propertydata: boolean };
  day: string;
  use: ProjectDayUse;
  allowance: ProjectSettingsRead['allowance'];
  soldLookupsPerDay: number;
  /** Held candidates: waiting on Batch 16's comparables check, and on this job. */
  waiting: { comparables: number; project: number };
  /** Live Project deals. */
  live: number;
  runs: ProjectRunRow[];
}

/** What /admin/deals shows of the Project checks. Null when the rows cannot be read. */
export async function projectChecksView(admin: Admin, settings: ProjectSettingsRead, now: Date = new Date()): Promise<ProjectChecksView | null> {
  const today = ukDay(now);
  const [held, dayRead, live, runs] = await Promise.all([
    loadHeld(admin),
    loadDayUse(admin, today, ukDayStart(now)),
    admin.from('marketplace_deals').select('canonical_url', { count: 'exact', head: true }).eq('status', 'live').not('project', 'is', null),
    admin.from('marketplace_runs').select('id, started_at, summary').eq('kind', PROJECT_CHECKS_KIND).eq('dry', false).order('started_at', { ascending: false }).limit(8),
  ]);
  if (!held) return null;
  const withCheck = held.filter((r) => checkOf(r.screening)).length;
  return {
    enabled: settings.checks.enabled,
    dealChecksOn: dealChecksEnabled(),
    configured: { anthropic: photoCheckConfigured(), propertydata: providerEnabled('propertydata') },
    day: today,
    use: dayRead?.use ?? emptyDayUse(),
    allowance: settings.allowance,
    soldLookupsPerDay: settings.checks.soldLookupsPerDay,
    waiting: { comparables: held.length - withCheck, project: withCheck },
    live: live.error ? 0 : live.count ?? 0,
    runs: ((runs.data ?? []) as { id: string; started_at: string; summary: Record<string, unknown> | null }[]).map((r) => ({ id: r.id, started_at: r.started_at, summary: r.summary ?? {} })),
  };
}
