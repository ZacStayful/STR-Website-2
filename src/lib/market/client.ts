/**
 * Server-side client for the internal `/api/market-stats` endpoint.
 *
 * SERVER ONLY — sends the INTERNAL_API_SECRET header, so this module must never
 * be imported into a client component. Returns `null` on any failure (missing
 * config, non-200, parse error) so pages can render a graceful empty state
 * rather than throwing.
 *
 * Responses are cached with Next's fetch revalidation (1h) — the underlying
 * data is a slowly growing snapshot, not real-time.
 *
 * This module reads INTERNAL_API_SECRET and must only be imported from server
 * code (server components / route handlers), never a client component.
 */

import type { MarketStatsResponse } from './types';

const REVALIDATE_SECONDS = 3600;

function baseUrl(): string {
  return (process.env.MARKET_STATS_API_URL ?? 'https://stayful-str-estimate-software.vercel.app').replace(/\/$/, '');
}

interface FetchOptions {
  area?: string;
  bedrooms?: number;
  minSamples?: number;
}

export async function fetchMarketStats(options: FetchOptions = {}): Promise<MarketStatsResponse | null> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.warn('[market] INTERNAL_API_SECRET not set — market-stats unavailable');
    return null;
  }

  const url = new URL(`${baseUrl()}/api/market-stats`);
  if (options.area) url.searchParams.set('area', options.area);
  if (options.bedrooms !== undefined) url.searchParams.set('bedrooms', String(options.bedrooms));
  if (options.minSamples !== undefined) url.searchParams.set('min_samples', String(options.minSamples));

  try {
    const res = await fetch(url.toString(), {
      headers: { 'x-internal-secret': secret },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      console.warn(`[market] market-stats HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as MarketStatsResponse;
    if (!data || !Array.isArray(data.areas)) {
      console.warn('[market] market-stats: unexpected response shape');
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[market] market-stats fetch failed:', err);
    return null;
  }
}

/** Convenience: fetch a single area, or null if it isn't in the response. */
export async function fetchMarketArea(area: string, minSamples?: number) {
  const data = await fetchMarketStats({ area, minSamples });
  if (!data) return null;
  return data.areas.find((a) => a.postcode_area.toUpperCase() === area.toUpperCase()) ?? null;
}
