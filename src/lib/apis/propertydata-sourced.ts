/**
 * PropertyData /sourced-properties — the motivated-seller cohorts.
 *
 * Everything else in the motivation read is inferred from a listing. This is a
 * data provider naming properties that have been continuously marketed for
 * over a year, or cut by more than fifteen percent, or repossessed. Those are
 * measurements, so they carry more weight than anything we can work out from
 * an advert.
 *
 * One API credit per call, up to 500 results a page, so a handful of calls
 * covers an area's whole back catalogue for about a penny.
 *
 * Two things about this endpoint are NOT documented, and the code is built so
 * that neither can break it:
 *
 *   - The `list` slugs are given inconsistently across PropertyData's own
 *     pages. Each cohort therefore carries several candidate slugs; the first
 *     the API accepts is remembered, and a slug it rejects is dropped with one
 *     warning rather than retried on every run.
 *   - The response shape is undocumented, so the rows are read tolerantly in
 *     cohorts.ts and a row we cannot identify is skipped.
 *
 * Run `node scripts/probe-sourced-properties.mjs <postcode>` against a real key
 * to print the true shape, then tighten cohorts.ts against it.
 *
 * Like the rest of this file's neighbours: never throws, never blocks a run.
 */
import 'server-only';

import { meter } from '../credit/meter.ts';
import { COHORT_SLUGS, DEFAULT_COHORTS, isCohortKey, parseCohortRow, mergeCohortMembers, type CohortKey, type CohortMember } from '../listing/cohorts.ts';

const BASE = 'https://api.propertydata.co.uk/sourced-properties';
const TIMEOUT_MS = 15_000;
/** The endpoint caps a page at 500; a whole area's back catalogue fits well inside one. */
const RESULTS_PER_CALL = 500;

/**
 * Slugs the API has accepted, and ones it has rejected, for this process.
 * PropertyData renames these occasionally and a wrong slug returns a 200 with
 * `status: "error"`, so remembering the answer turns a permanent daily waste of
 * credits into one wasted call.
 */
const acceptedSlug = new Map<CohortKey, string>();
const rejectedSlugs = new Set<string>();

/** An operator override for when a slug changes: PROPERTYDATA_LIST_SLOW_TO_SELL=new-slug */
function overrideFor(cohort: CohortKey): string | null {
  const v = process.env[`PROPERTYDATA_LIST_${cohort.toUpperCase()}`];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function slugsToTry(cohort: CohortKey): string[] {
  const override = overrideFor(cohort);
  if (override) return [override];
  const known = acceptedSlug.get(cohort);
  if (known) return [known];
  return COHORT_SLUGS[cohort].filter((s) => !rejectedSlugs.has(s));
}

/** Which cohorts to ask for. PROPERTYDATA_COHORTS overrides; unknown names are ignored. */
export function enabledCohorts(): CohortKey[] {
  const raw = process.env.PROPERTYDATA_COHORTS;
  if (!raw?.trim()) return [...DEFAULT_COHORTS];
  const picked = raw.split(',').map((s) => s.trim()).filter(isCohortKey);
  return picked.length > 0 ? picked : [...DEFAULT_COHORTS];
}

/**
 * Opt-in, not on-by-default.
 *
 * A key alone is not consent to spend on this: the analyser's own endpoints
 * already draw on the same monthly allowance, and a full pass here is one
 * credit per cohort per area — 60 a run, ~1,800 a month at a daily cadence.
 * On a 5,000-credit plan that is a third of the budget, so it has to be turned
 * on deliberately by someone who has checked there is room.
 */
export function sourcedPropertiesConfigured(): boolean {
  return Boolean(process.env.PROPERTYDATA_API_KEY) && process.env.PROPERTYDATA_SOURCED_ENABLED === 'true';
}

/**
 * Set when the account itself says no — out of credits, bad key, plan does not
 * include this endpoint. None of that is per-slug or per-area, so the whole
 * pass stops rather than working through a hundred more calls that will fail
 * identically. Cleared on the next process, and on the cooldown below.
 */
let accountBlockedUntil = 0;
const ACCOUNT_BLOCK_MS = 6 * 60 * 60 * 1000;

type CallOutcome =
  | { kind: 'rows'; rows: unknown[] }
  /** The API answered and said this list does not exist. Try the next slug. */
  | { kind: 'bad_slug'; message: string }
  /** Credits, key or plan. Nothing to retry until something changes. */
  | { kind: 'account'; message: string }
  | { kind: 'transient'; message: string };

/** Out of credits, unauthorised, or the plan does not cover it — never a slug problem. */
const ACCOUNT_ERROR = /plan limit|api credits?|credits? (?:exceeded|remaining|limit)|quota|exceeded|unauthori[sz]ed|forbidden|invalid key|api key|subscription/i;
/** The list name itself is wrong. Checked second, so a quota message never reads as one. */
const SLUG_ERROR = /list|not found|invalid|unknown/i;

/** Where to search. The endpoint takes a postcode or a lat/lng; we mostly have centroids. */
export type CohortWhere = { postcode: string } | { lat: number; lng: number };

function whereKey(where: CohortWhere): string {
  return 'postcode' in where ? where.postcode : `${where.lat.toFixed(3)},${where.lng.toFixed(3)}`;
}

async function callOnce(apiKey: string, slug: string, where: CohortWhere, radiusMiles: number): Promise<CallOutcome> {
  const url = new URL(BASE);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('list', slug);
  if ('postcode' in where) url.searchParams.set('postcode', where.postcode);
  else url.searchParams.set('location', `${where.lat},${where.lng}`);
  url.searchParams.set('radius', String(radiusMiles));
  url.searchParams.set('results', String(RESULTS_PER_CALL));
  // A property already under offer cannot be bought, so it is never worth a credit.
  url.searchParams.set('exclude_sstc', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // The metered call parses as well as fetches, so `failed` can judge the body.
    // This endpoint reports being out of credits as HTTP 200 with an error
    // payload, and metering that as a success would bill us for a call that
    // returned nothing.
    return await meter<CallOutcome>(
      { provider: 'propertydata', unit: 'sourced_properties', key: `${slug}|${whereKey(where)}`, failed: (o) => o.kind !== 'rows' },
      async () => {
        const res = await fetch(url.toString(), { cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
          const message = `HTTP ${res.status}`;
          console.log(`[propertydata] /sourced-properties ${message} for list=${slug}`);
          // 401/403 is the key or the plan, not this list.
          return res.status === 401 || res.status === 403 ? { kind: 'account', message } : { kind: 'transient', message };
        }
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object') return { kind: 'transient', message: 'unparseable body' };
        const body = data as Record<string, unknown>;
        if (body.status === 'error') {
          const message = typeof body.message === 'string' ? body.message : 'unknown';
          console.log(`[propertydata] /sourced-properties error for list=${slug}: ${message}`);
          if (ACCOUNT_ERROR.test(message)) return { kind: 'account', message };
          return SLUG_ERROR.test(message) ? { kind: 'bad_slug', message } : { kind: 'transient', message };
        }
        const rows = body.properties ?? body.data ?? body.results ?? body.result;
        return { kind: 'rows', rows: Array.isArray(rows) ? rows : [] };
      },
    );
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.log('[propertydata] /sourced-properties fetch error:', message);
    return { kind: 'transient', message };
  } finally {
    clearTimeout(timer);
  }
}

/** One cohort near one postcode. Null when the cohort could not be asked for at all. */
export async function fetchCohort(cohort: CohortKey, where: CohortWhere, radiusMiles = 10): Promise<CohortMember[] | null> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  if (!apiKey || Date.now() < accountBlockedUntil) return null;
  for (const slug of slugsToTry(cohort)) {
    const outcome = await callOnce(apiKey, slug, where, radiusMiles);
    if (outcome.kind === 'account') {
      accountBlockedUntil = Date.now() + ACCOUNT_BLOCK_MS;
      console.warn(`[propertydata] account cannot serve /sourced-properties (${outcome.message}); pausing for ${ACCOUNT_BLOCK_MS / 3_600_000}h`);
      return null;
    }
    if (outcome.kind === 'bad_slug') {
      // Remember, so the next run spends its credits on a slug that works.
      rejectedSlugs.add(slug);
      console.warn(`[propertydata] list slug "${slug}" rejected; set PROPERTYDATA_LIST_${cohort.toUpperCase()} to override`);
      continue;
    }
    // A slug is only known-good once a call with it actually returned. Caching
    // it off a quota failure would pin whichever name we happened to try first.
    if (outcome.kind !== 'rows') return null;
    acceptedSlug.set(cohort, slug);
    return outcome.rows.map((r) => parseCohortRow(r, cohort)).filter((m): m is CohortMember => m !== null);
  }
  return null;
}

/**
 * Every enabled cohort near one postcode, folded into one entry per property.
 * Costs one credit per cohort, so five cohorts over five areas is 25 credits —
 * well inside the smallest plan's monthly allowance at a daily cadence.
 */
export async function fetchCohorts(where: CohortWhere, radiusMiles = 10, cohorts = enabledCohorts()): Promise<CohortMember[]> {
  if (!sourcedPropertiesConfigured()) return [];
  const all: CohortMember[] = [];
  for (const cohort of cohorts) {
    if (Date.now() < accountBlockedUntil) break;
    const rows = await fetchCohort(cohort, where, radiusMiles);
    if (rows) all.push(...rows);
  }
  return mergeCohortMembers(all);
}
