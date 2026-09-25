/**
 * Fetches an area-average long-let monthly rent for the Market Explorer
 * verdict, through the PropertyData client's single-attempt lookup
 * (`getLongLetOnce`). Server-only (PropertyData key).
 *
 * Uses the area's representative central postcode and its modal (most-sampled)
 * bedroom count. Returns null when the area has no representative postcode or
 * the estimate is unusable — the verdict then degrades gracefully.
 */

import { getLongLetOnce } from '../apis/propertydata.ts';
import { areaRentCacheKey, cachedAreaRent, type CachedRent } from '../apis/propertydata-guard.ts';
import type { MarketArea } from './types.ts';
import { AREA_REPRESENTATIVE_POSTCODE } from './area-postcodes.ts';

/** The bedroom count with the most samples in this area (drives the rent lookup). */
export function modalBedrooms(area: MarketArea): number | null {
  let best: number | null = null;
  let bestN = -1;
  for (const g of area.by_bedrooms) {
    if (g.sample_count > bestN) {
      bestN = g.sample_count;
      best = g.bedrooms;
    }
  }
  return best;
}

/**
 * Cached for a month per postcode and bedrooms (a miss for a day), and one
 * bounded attempt that returns null rather than the national median: the
 * snapshot rebuilds hourly for every area, and this used to cost up to six
 * uncached calls each time.
 */
export async function getAreaLongLetRent(area: MarketArea): Promise<number | null> {
  const postcode = AREA_REPRESENTATIVE_POSTCODE[area.postcode_area.toUpperCase()];
  if (!postcode) return null;

  const bedrooms = modalBedrooms(area) ?? 2;
  return cachedAreaRent(areaRentCacheKey(postcode, bedrooms), {
    get: async (key) => {
      const { brokerStore } = await import('../broker/store.ts');
      const hit = await brokerStore().get<{ monthlyRent: number | null }>('areaLongLetRent', key);
      return hit ? { monthlyRent: hit.value?.monthlyRent ?? null, expiresAt: hit.expiresAt } : null;
    },
    set: async (key, value: CachedRent) => {
      const { brokerStore } = await import('../broker/store.ts');
      await brokerStore().set('areaLongLetRent', key, {
        value: { monthlyRent: value.monthlyRent },
        provider: 'propertydata',
        level: 3,
        fetchedAt: new Date().toISOString(),
        expiresAt: value.expiresAt,
      });
    },
    fetchRent: async () => (await getLongLetOnce(postcode, bedrooms))?.monthlyRent ?? null,
  });
}
