import 'server-only';

import { unstable_cache } from 'next/cache';
import { buildAreaCards, pickSampleArea, type AreaCardData, type SampleArea } from './explorer';
import { getManagedAreas } from './managed-areas';

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

export async function getSampleArea(): Promise<SampleArea | null> {
  return pickSampleArea(await getAreaCards());
}
