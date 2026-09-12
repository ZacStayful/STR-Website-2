import 'server-only';

import { fetchListingHtml } from '../../listing/fetch';
import { parseOnTheMarketSearch, onTheMarketSearchUrl, type SourcedListing, type SourcingQuery } from '../../listing/sourcing';

/**
 * Fallback sourcing rung: one OnTheMarket results page per (kind, area,
 * budget, bedrooms) query, shared by every member whose goals match it and
 * refreshed at most daily by the broker cache. Goes through the same fetch
 * path as pasted listings, so the kill switches, per-site allow-list and
 * circuit breaker all apply. Returns null when the page could not be read
 * so the ladder reports "unavailable" rather than caching an empty answer.
 */
export async function fetchOnTheMarketSearch(q: SourcingQuery): Promise<SourcedListing[] | null> {
  const url = onTheMarketSearchUrl(q);
  if (!url) return null;
  const res = await fetchListingHtml('onthemarket', url, { unit: 'search_page' });
  if (!res.ok) return null;
  const list = parseOnTheMarketSearch(res.html, q.kind);
  return list.length > 0 ? list : null;
}
