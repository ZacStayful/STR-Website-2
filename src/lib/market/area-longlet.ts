/**
 * Fetches an area-average long-let monthly rent for the Market Explorer
 * verdict, reusing the EXISTING PropertyData client (`getLongLetData`) rather
 * than a new one. Server-only (PropertyData key).
 *
 * Uses the area's representative central postcode and its modal (most-sampled)
 * bedroom count. Returns null when the area has no representative postcode or
 * the estimate is unusable — the verdict then degrades gracefully.
 */

import { getLongLetData } from '../apis/propertydata.ts';
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

export async function getAreaLongLetRent(area: MarketArea): Promise<number | null> {
  const postcode = AREA_REPRESENTATIVE_POSTCODE[area.postcode_area.toUpperCase()];
  if (!postcode) return null;

  const bedrooms = modalBedrooms(area) ?? 2;
  try {
    const data = await getLongLetData(postcode, bedrooms);
    return data.monthlyRent > 0 ? data.monthlyRent : null;
  } catch {
    return null;
  }
}
