import 'server-only';

/**
 * The one-off Project backfill of live deals (Batch 17, Q16). The entry hold
 * only ever sees listings coming in, and the hourly recheck never flips a
 * live deal, so the sales that went live before the hold was switched on,
 * and whose own words say they need work, are sent through the same
 * decision (hold.ts) here, once, by hand:
 *
 *   held      back on the shortlist in the Project stream, keeping any
 *             comparables check (then the Project check decides it)
 *   retired   project_excluded / project_uncheckable / not_project, as a
 *             newcomer would be: never shown again
 *   left      not worded as needing work, or an auction lot
 *
 * The wording is the card's and, where its page has been read, the page's
 * (the stored snapshot); nothing is fetched and nothing is spent. A deal an
 * earlier Project check let go (an auction lot, or its photos said ready to
 * go) is left alone. A real run needs the Project checks on
 * (project_checks.enabled and DEAL_CHECKS_ENABLED), or the held deals would
 * wait for a check that never runs, and every page is read and decided
 * before anything is written (paged by id, so nothing is skipped as rows
 * move). The held deals wait on the shortlist for Batch 16's expiry plus a
 * day for each day's allowance of them, so the photo checks can reach them
 * all. `?dry=1` reports what it would do and writes no deal (the run itself
 * is logged). Each write is conditional on the deal still being live; a run
 * stops inside ~45 seconds and the next carries on (idempotent: a moved
 * deal is no longer live). Every run is recorded in marketplace_runs (kind
 * project_backfill).
 */
import { createAdminClient } from '../supabase/admin';
import { SERVER_FETCHABLE } from '../listing/detect';
import { listingNeedsWork, type SourcedListing } from '../listing/sourcing';
import { loadSourcedListings, revalidateDeals, writeWithoutMissing, type Admin } from '../marketplace/server';
import { shortlistExpiryAt } from '../deal-quality/checks';
import { readDealQualitySettings } from '../deal-quality/settings-server';
import { projectChecksOn, readProjectSettings } from './settings-server';
import { projectClearedUrls, projectColumnsFor } from './read-server';
import { projectHoldFor, type HoldDecision } from './hold';
import { projectFactsOf } from './check-plan';
import { mergeNeedsWork, type NeedsWork } from './needs-work';

export const PROJECT_BACKFILL_KIND = 'project_backfill';
/** Reading and deciding stops here; the writes that follow stop at TIME_BUDGET_MS (a run that stops carries on next time). */
const READ_BUDGET_MS = 25_000;
const TIME_BUDGET_MS = 45_000;
const PAGE = 500;
const SAMPLE = 40;

export interface ProjectBackfillResult {
  status: number;
  body: Record<string, unknown>;
}

interface LiveRow {
  canonical_url: string;
  id: string;
  source: SourcedListing['source'];
  kind: 'sale' | 'rent';
  postcode_area: string | null;
  bedrooms: number | null;
  raw_type: string | null;
  price_amount: number | string | null;
}

async function recordRun(admin: Admin, dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: PROJECT_BACKFILL_KIND, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[project-backfill] run record failed:', error.message);
}

export async function runProjectBackfill(opts: { dry: boolean; triggeredBy: string }): Promise<ProjectBackfillResult> {
  const startedAt = new Date();
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const [settings, dq] = await Promise.all([readProjectSettings(admin), readDealQualitySettings(admin)]);
  const on = projectChecksOn(settings);
  if (!opts.dry && !on) return { status: 409, body: { error: 'The Project checks are off (project_checks.enabled, and DEAL_CHECKS_ENABLED): switch them on first, or the held deals would wait for a check that never runs.' } };
  const nowIso = startedAt.toISOString();

  const counts = { read: 0, flagged: 0, held: 0, left: 0, retired: {} as Record<string, number>, written: 0, changedMeanwhile: 0, alreadyProject: 0, alreadyCleared: 0 };
  const sample: string[] = [];
  let outOfTime = false;
  const decisions: { url: string; decision: Exclude<HoldDecision, { kind: 'none' }>; needsWork: NeedsWork }[] = [];

  // Every page is read and decided before anything is written: paging by id, never by offset, while rows move out of live.
  let after: string | null = null;
  for (;;) {
    if (Date.now() - startedAt.getTime() > READ_BUDGET_MS) {
      outOfTime = true;
      break;
    }
    let q = admin.from('marketplace_deals').select('canonical_url, id, source, kind, postcode_area, bedrooms, raw_type, price_amount').eq('status', 'live').eq('kind', 'sale').order('id', { ascending: true }).limit(PAGE);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) {
      console.error('[project-backfill] live deals unreadable:', error.message);
      return { status: 500, body: { error: 'Could not read the live deals' } };
    }
    const rows = (data ?? []) as unknown as LiveRow[];
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    counts.read += rows.length;
    const urls = rows.map((r) => r.canonical_url);
    const [listings, columns, cleared] = await Promise.all([loadSourcedListings(admin, urls), projectColumnsFor(admin, urls), projectClearedUrls(admin, urls)]);
    for (const row of rows) {
      const cols = columns.get(row.canonical_url);
      if (cols?.project) {
        counts.alreadyProject += 1;
        continue;
      }
      // Let go into the ordinary flow by an earlier Project check (an auction lot, or its photos said ready to go).
      if (cleared.has(row.canonical_url)) {
        counts.alreadyCleared += 1;
        continue;
      }
      const listing = listings.get(row.canonical_url)?.listing ?? null;
      const needsWork: NeedsWork | null = listing ? mergeNeedsWork(cols?.needsWork ?? null, listingNeedsWork(listing)) : cols?.needsWork ?? null;
      if (!needsWork?.flag) {
        counts.left += 1;
        continue;
      }
      counts.flagged += 1;
      const price = row.price_amount === null ? null : Number(row.price_amount);
      const decision: HoldDecision = projectHoldFor(
        {
          kind: 'sale',
          needsWork,
          auction: listing?.auction ?? null,
          fetchable: SERVER_FETCHABLE.has(row.source),
          pageExclusion: listing?.projectExclusion,
          texts: listing ? [listing.title, listing.priceQualifier, ...(listing.features ?? [])] : [],
          tenure: listing?.tenure ?? null,
          yearsRemainingOnLease: listing?.yearsRemainingOnLease ?? null,
          listedFlag: listing?.listedBuilding ?? null,
          price: price !== null && Number.isFinite(price) ? price : null,
          facts: listing ? projectFactsOf(listing) : projectFactsOf({ bedrooms: row.bedrooms, rawType: row.raw_type }),
        },
        settings,
      );
      if (decision.kind === 'none') {
        counts.left += 1;
        continue;
      }
      if (decision.kind === 'hold') counts.held += 1;
      else counts.retired[decision.reason] = (counts.retired[decision.reason] ?? 0) + 1;
      decisions.push({ url: row.canonical_url, decision, needsWork });
      if (sample.length < SAMPLE) sample.push(`${row.postcode_area ?? '?'} · ${row.bedrooms ?? '?'} bed ${row.raw_type ?? 'sale'} · ${needsWork.phrases.slice(0, 3).join(', ')} → ${decision.kind === 'hold' ? 'held for its Project check' : `retired ${decision.reason} (${decision.detail})`}`);
    }
    if (rows.length < PAGE) break;
  }

  // The held deals wait on the shortlist until the day's photo checks can reach them all: Batch 16's
  // expiry, plus a day for every day's allowance of them, so a batch this size never simply expires.
  const perDay = Math.max(1, settings.allowance.photoChecks);
  const waitDays = Math.ceil(counts.held / perDay);
  const expiry = new Date(new Date(shortlistExpiryAt(startedAt, dq.checks)).getTime() + waitDays * 86_400_000).toISOString();

  if (!opts.dry) {
    for (const d of decisions) {
      if (Date.now() - startedAt.getTime() > TIME_BUDGET_MS) {
        outOfTime = true;
        break;
      }
      const update: Record<string, unknown> =
        d.decision.kind === 'hold'
          ? { status: 'pending_check', stream: 'project', needs_work: d.needsWork, next_check_due_at: expiry, check_failures: 0, updated_at: nowIso }
          : { status: 'retired', retired_reason: d.decision.reason, retired_at: nowIso, next_check_due_at: null, needs_work: d.needsWork, updated_at: nowIso };
      const { data: moved, error: moveErr } = await writeWithoutMissing(update, (u) => admin.from('marketplace_deals').update(u).eq('canonical_url', d.url).eq('status', 'live').select('canonical_url'), 'project-backfill');
      if (moveErr) console.error('[project-backfill] write failed:', moveErr.message);
      else if (((moved as unknown[] | null)?.length ?? 0) > 0) counts.written += 1;
      else counts.changedMeanwhile += 1;
    }
  }

  const summary: Record<string, unknown> = { dry: opts.dry, projectChecksOn: on, triggeredBy: opts.triggeredBy, ...counts, heldExpiry: counts.held > 0 ? expiry.slice(0, 10) : null, outOfTime, sample, ms: Date.now() - startedAt.getTime() };
  await recordRun(admin, opts.dry, startedAt, summary);
  if (!opts.dry && counts.written > 0) revalidateDeals();
  return { status: 200, body: summary };
}
