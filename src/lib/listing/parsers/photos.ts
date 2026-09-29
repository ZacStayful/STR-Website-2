/**
 * Batch 17: the photos and floorplans a Project deal's photo check looks at,
 * read from a fresh page read: up to `max` photos in the portal's own order
 * (the first is the lead photo), and the floorplans. URLs only, never copies;
 * they are kept in the private project tables and never shown before a deal
 * is opened. The stored snapshot keeps its own few (SNAPSHOT_PHOTO_LIMIT) and
 * never grows for this.
 *
 * Rightmove and OnTheMarket only: a Zoopla page cannot be read, so a Zoopla
 * listing is never photo-checked (it is retired as uncheckable instead).
 *
 * Pure: no network, no database, no server-only.
 */
import type { ListingSource } from '../types.ts';
import { toStr } from './shared.ts';
import { rightmovePageModel } from './rightmove.ts';
import { onTheMarketProperty } from './onthemarket.ts';

export interface ProjectPhotos {
  photos: string[];
  floorplans: string[];
}

const NONE: ProjectPhotos = { photos: [], floorplans: [] };

function urls(raw: unknown, keys: readonly string[], max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const url = keys.map((k) => toStr(item?.[k])).find((u): u is string => Boolean(u && /^https:\/\//i.test(u)));
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** The page's photos (up to `max`) and floorplans (up to 3), or none when the page cannot be read. */
export function projectPhotosFrom(source: ListingSource, html: string, max: number): ProjectPhotos {
  const limit = Math.max(0, Math.floor(max));
  if (source === 'rightmove') {
    const p = rightmovePageModel(html) as { images?: unknown; floorplans?: unknown } | null;
    if (!p) return NONE;
    return { photos: urls(p.images, ['url'], limit), floorplans: urls(p.floorplans, ['url'], 3) };
  }
  if (source === 'onthemarket') {
    const p = onTheMarketProperty(html);
    if (!p) return NONE;
    return { photos: urls(p.images, ['largeUrl', 'url'], limit), floorplans: urls(p.floorplans, ['largeUrl', 'url'], 3) };
  }
  return NONE;
}
