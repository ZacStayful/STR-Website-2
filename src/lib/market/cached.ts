import 'server-only';

import { unstable_cache } from 'next/cache';
import { buildAreaCards, pickSampleArea, type AreaCardData, type SampleArea } from './explorer';
import { getManagedAreas } from './managed-areas';
import { withTimeout } from '../timeout';
import { keepAlive } from '../keep-alive';

/**
 * Hourly-cached entry points for the /markets pages.
 *
 * The routes render per request (the access gate reads the session), so the
 * card build — which calls PropertyData once per area — must not run per
 * request. `unstable_cache` keeps it to once an hour. An empty result
 * (upstream down / not configured) is not treated as a hit, so a blip doesn't
 * blank the explorer for an hour. Kept separate from explorer.ts so the pure
 * logic stays runnable under `node --test`.
 */
const CACHE_SECONDS = 3600;
const TAG = 'market-area-cards';

async function buildCardsWithManaged(): Promise<AreaCardData[]> {
  const managed = await getManagedAreas();
  return buildAreaCards({ managedAreas: managed });
}

const cachedAreaCards = unstable_cache(buildCardsWithManaged, ['market-area-cards-v2'], { revalidate: CACHE_SECONDS, tags: [TAG] });

export async function getAreaCards(): Promise<AreaCardData[]> {
  const cards = await cachedAreaCards();
  return cards.length > 0 ? cards : buildCardsWithManaged();
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
