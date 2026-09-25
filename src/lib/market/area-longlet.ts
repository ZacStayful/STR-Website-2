import 'server-only';

import { ask, pdLongLetRent } from '../broker';
import { brokerStore } from '../broker/store';
import { areaRentCacheKey, cachedAreaRent, type CachedRent } from '../apis/propertydata-guard';
import type { MarketArea } from './types';
import { AREA_REPRESENTATIVE_POSTCODE } from './area-postcodes';

/**
 * Area-average long-let monthly rent for the Market Explorer verdict, from
 * PropertyData's rental valuation through the broker, as house spend (the
 * cron and the cache build run outside any member's meter context).
 *
 * Uses the area's representative central postcode and its modal (most
 * sampled) bedroom count. Null when the area has no representative postcode
 * or PropertyData cannot value it, so the verdict degrades to "not enough
 * data" instead of quoting the national median as if it were local.
 *
 * The lookup is one bounded attempt, and its answer — a miss included — is
 * remembered in `broker_cache` (a month for a rent, a day for a miss): the
 * snapshot rebuilds hourly for every area, and in September 2026 that cost
 * up to six uncached calls per area per build until the monthly plan was
 * spent. The broker's own cache only ever holds rents it was given, so the
 * miss cache lives here.
 */

/** One attempt's budget; a cron pass has about sixty seconds in total. */
export const AREA_RENT_TIMEOUT_MS = 3_500;

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

export async function getAreaLongLetRent(area: MarketArea): Promise<number | null> {
  const postcode = AREA_REPRESENTATIVE_POSTCODE[area.postcode_area.toUpperCase()];
  if (!postcode) return null;
  const bedrooms = modalBedrooms(area) ?? 2;
  return cachedAreaRent(areaRentCacheKey(postcode, bedrooms), {
    get: async (key) => {
      const hit = await brokerStore().get<{ monthlyRent: number | null }>('areaLongLetRent', key);
      return hit ? { monthlyRent: hit.value?.monthlyRent ?? null, expiresAt: hit.expiresAt } : null;
    },
    set: async (key, value: CachedRent) => {
      await brokerStore().set('areaLongLetRent', key, {
        value: { monthlyRent: value.monthlyRent },
        provider: 'propertydata',
        level: 3,
        fetchedAt: new Date().toISOString(),
        expiresAt: value.expiresAt,
      });
    },
    fetchRent: async () => {
      // A rent a member's report already bought for this postcode and size is
      // served from the broker's cache without a call.
      const r = await ask(pdLongLetRent, { postcode, bedrooms, maxAttempts: 1, timeoutMs: AREA_RENT_TIMEOUT_MS }, { mode: 'cron' });
      return r.value && r.value.monthlyRent > 0 ? r.value.monthlyRent : null;
    },
  });
}
