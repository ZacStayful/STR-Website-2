import 'server-only';

import { unstable_cache } from 'next/cache';
import { buildExplorerData, pickSampleArea, type AreaCardData, type ExplorerData, type SampleArea } from './explorer';
import { buildSnapshot } from './aggregate';
import { loadPlanningSignals, loadReportRows } from './source';
import { getManagedAreas } from './managed-areas';
import { withTimeout } from '../timeout';
import { keepAlive } from '../keep-alive';
import type { MonthBucket } from './types';

/**
 * Hourly-cached entry point for everything the Market Explorer shows.
 *
 * One snapshot: the reports are loaded once, aggregated once (regions,
 * areas, districts, monthly series) and the cards built once, so every
 * figure, label and chart on the explorer comes from the same data. The
 * routes render per request (the access gate reads the session), so the
 * build — which calls PropertyData once per area — must not run per
 * request; `unstable_cache` keeps it to once an hour. An empty result
 * (no service role / query failed) is not treated as a hit, so a blip
 * doesn't blank the explorer for an hour. Kept separate from explorer.ts
 * so the pure logic stays runnable under `node --test`.
 */
const CACHE_SECONDS = 3600;
const TAG = 'market-area-cards';
// The data cache persists across deployments, so bump this key whenever the
// aggregation or card logic changes; otherwise the previous build's snapshot
// is served until it expires.
const CACHE_KEY = 'market-snapshot-v6';

const EMPTY: ExplorerData = { cards: [], regions: [], national: [], generatedAt: '', totalReports: 0 };

async function buildExplorerWithManaged(): Promise<ExplorerData> {
  const [rows, planning, managed] = await Promise.all([loadReportRows(), loadPlanningSignals(), getManagedAreas()]);
  if (rows.length === 0) return EMPTY;
  return buildExplorerData(buildSnapshot(rows, { planning }), { managedAreas: managed });
}

const cachedSnapshot = unstable_cache(buildExplorerWithManaged, [CACHE_KEY], { revalidate: CACHE_SECONDS, tags: [TAG] });

export async function getMarketSnapshot(): Promise<ExplorerData> {
  const data = await cachedSnapshot();
  return data.cards.length > 0 ? data : buildExplorerWithManaged();
}

export async function getAreaCards(): Promise<AreaCardData[]> {
  return (await getMarketSnapshot()).cards;
}

/** The nationwide monthly series (market pulse), from the same snapshot. */
export async function getNationalSeries(): Promise<MonthBucket[]> {
  return (await getMarketSnapshot()).national;
}

/**
 * The cards if they are ready within `ms`, `[]` if the build failed, and
 * `null` only when it is still running. On a cold cache the full build
 * (dozens of PropertyData calls) can take longer than an API request may
 * wait; the build is kept alive so it can still land in the cache for the
 * next caller (within the route's maxDuration; a /markets page render also
 * warms it), and this caller degrades to "no area context" instead of a
 * timeout.
 */
export async function getAreaCardsWithin(ms: number): Promise<AreaCardData[] | null> {
  const build = getAreaCards().catch((err) => {
    console.error('[market] area cards build failed:', err);
    return [] as AreaCardData[];
  });
  const cards = await withTimeout<AreaCardData[] | null>(build, ms, null);
  if (cards === null) keepAlive(build);
  return cards;
}

export async function getSampleArea(): Promise<SampleArea | null> {
  return pickSampleArea(await getAreaCards());
}
