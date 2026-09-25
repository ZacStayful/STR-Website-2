import 'server-only';

import { ask, pdLongLetRent } from '../broker';
import type { MarketArea } from './types';
import { AREA_REPRESENTATIVE_POSTCODE } from './area-postcodes';

/**
 * Area-average long-let monthly rent for the Market Explorer verdict, from
 * PropertyData's rental valuation through the broker: one call per area per
 * month, cached in `broker_cache` and house spend (the cron and the cache
 * build run outside any member's meter context).
 *
 * Uses the area's representative central postcode and its modal (most
 * sampled) bedroom count. Null when the area has no representative postcode
 * or PropertyData cannot value it, so the verdict degrades to "not enough
 * data" instead of quoting the national median as if it were local.
 */

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
  const r = await ask(pdLongLetRent, { postcode, bedrooms }, { mode: 'cron' });
  return r.value && r.value.monthlyRent > 0 ? r.value.monthlyRent : null;
}
