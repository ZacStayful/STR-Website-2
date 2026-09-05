import 'server-only';

import type { MarketTrendsResponse } from './types';

/**
 * Server-side client for the internal `/api/market-trends` endpoint. Same
 * secret + host as market-stats; null on any failure so pages degrade to
 * "no trend data" rather than erroring. Cached for an hour like the stats.
 */

const REVALIDATE_SECONDS = 3600;

function baseUrl(): string {
  return (process.env.MARKET_STATS_API_URL ?? 'https://stayful-str-estimate-software.vercel.app').replace(/\/$/, '');
}

export async function fetchMarketTrends(options: { months?: number } = {}): Promise<MarketTrendsResponse | null> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  const url = new URL(`${baseUrl()}/api/market-trends`);
  url.searchParams.set('months', String(options.months ?? 12));
  try {
    const res = await fetch(url.toString(), { headers: { 'x-internal-secret': secret }, next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) {
      console.warn(`[market] market-trends HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as MarketTrendsResponse;
    if (!data || !Array.isArray(data.months) || !Array.isArray(data.national)) return null;
    return data;
  } catch (err) {
    console.warn('[market] market-trends fetch failed:', err);
    return null;
  }
}
