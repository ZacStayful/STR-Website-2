import type { DetectedListing, ListingSource } from './types.ts';

/**
 * Recognises a pasted listing URL and reduces it to (source, id, canonical
 * URL). Tracking parameters, fragments and share-link decoration are dropped
 * so the same listing always maps to one canonical key.
 *
 * Returns null for anything that is not a supported listing page — search
 * result pages, agent pages, unrelated sites.
 */

const PATTERNS: { source: ListingSource; host: RegExp; path: RegExp; canonical: (id: string) => string }[] = [
  {
    source: 'rightmove',
    host: /(^|\.)rightmove\.co\.uk$/i,
    path: /^\/properties\/(\d+)(?:[/#?]|$)/i,
    canonical: (id) => `https://www.rightmove.co.uk/properties/${id}`,
  },
  {
    source: 'onthemarket',
    host: /(^|\.)onthemarket\.com$/i,
    path: /^\/details\/(\d+)(?:[/#?]|$)/i,
    canonical: (id) => `https://www.onthemarket.com/details/${id}/`,
  },
  {
    source: 'zoopla',
    host: /(^|\.)zoopla\.co\.uk$/i,
    path: /^\/(?:for-sale|to-rent|new-homes)\/details\/(\d+)(?:[/#?]|$)/i,
    canonical: (id) => `https://www.zoopla.co.uk/for-sale/details/${id}/`,
  },
  {
    source: 'airbnb',
    host: /(^|\.)airbnb\.(?:co\.uk|com|ie|fr|de|es|it|nl|com\.au|ca)$/i,
    path: /^\/rooms\/(?:plus\/)?(\d+)(?:[/#?]|$)/i,
    canonical: (id) => `https://www.airbnb.co.uk/rooms/${id}`,
  },
  {
    source: 'booking',
    host: /(^|\.)booking\.com$/i,
    path: /^\/hotel\/([a-z]{2}\/[a-z0-9-]+)(?:\.[a-z-]+)?\.html(?:[/#?]|$)/i,
    canonical: (id) => `https://www.booking.com/hotel/${id}.html`,
  },
];

export function detectListingUrl(raw: string): DetectedListing | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  for (const p of PATTERNS) {
    if (!p.host.test(host)) continue;
    const m = url.pathname.match(p.path);
    if (!m) return null;
    const id = m[1].toLowerCase();
    return { source: p.source, id, canonicalUrl: p.canonical(id) };
  }
  return null;
}

/** Sites we can fetch from our own servers today. Others need the extension. */
export const SERVER_FETCHABLE: ReadonlySet<ListingSource> = new Set(['rightmove', 'onthemarket', 'airbnb']);

export const SOURCE_LABELS: Record<ListingSource, string> = {
  rightmove: 'Rightmove',
  onthemarket: 'OnTheMarket',
  zoopla: 'Zoopla',
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};
