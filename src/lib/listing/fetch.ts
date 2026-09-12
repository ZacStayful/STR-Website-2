import 'server-only';

import type { ListingSource } from './types';
import { SERVER_FETCHABLE } from './detect';
import { brokerStore } from '../broker/store';
import { meter } from '../credit/meter';

/**
 * Fetches one listing page from our servers. Deliberately narrow:
 *   - only the sources we know are fetchable today (Rightmove, OnTheMarket, Airbnb);
 *   - a browser User-Agent, 12 s timeout, 2 MB cap, redirects kept on-host;
 *   - a per-site circuit breaker: three consecutive blocks pause the site for
 *     six hours (shared across instances via the broker cache) so we stop
 *     hammering a site that has started challenging us;
 *   - a kill switch (LISTING_SERVER_FETCH=false) and per-site allow-list
 *     (LISTING_SOURCES=rightmove,onthemarket,airbnb).
 * HTML is returned to the parser and never stored.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2 * 1024 * 1024;
const BREAKER_THRESHOLD = 3;
const BREAKER_PAUSE_MS = 6 * 60 * 60 * 1000;

export type FetchOutcome =
  | { ok: true; html: string; status: number }
  | { ok: false; reason: 'disabled' | 'unsupported' | 'paused' | 'blocked' | 'not_found' | 'too_large' | 'timeout' | 'error'; status?: number };

export function serverFetchEnabled(source: ListingSource): boolean {
  if (process.env.LISTING_SERVER_FETCH === 'false') return false;
  if (!SERVER_FETCHABLE.has(source)) return false;
  const allow = process.env.LISTING_SOURCES;
  if (allow) return allow.split(',').map((s) => s.trim()).includes(source);
  return true;
}

interface BreakerState {
  failures: number;
  pausedUntil: string | null;
}

async function readBreaker(source: ListingSource): Promise<BreakerState> {
  const hit = await brokerStore().get<BreakerState>('listingBreaker', source).catch(() => null);
  return hit?.value ?? { failures: 0, pausedUntil: null };
}

async function writeBreaker(source: ListingSource, state: BreakerState): Promise<void> {
  const now = new Date();
  await brokerStore()
    .set('listingBreaker', source, { value: state, provider: 'internal', level: 1, fetchedAt: now.toISOString(), expiresAt: new Date(now.getTime() + BREAKER_PAUSE_MS).toISOString() })
    .catch(() => {});
}

function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503 || status === 202) return true;
  const head = html.slice(0, 4000).toLowerCase();
  return /just a moment|challenge-platform|cf-chl|access denied|captcha|awswaf|are you a human|unusual traffic/.test(head);
}

export async function fetchListingHtml(source: ListingSource, url: string, opts: { unit?: 'listing_page' | 'search_page' } = {}): Promise<FetchOutcome> {
  if (!SERVER_FETCHABLE.has(source)) return { ok: false, reason: 'unsupported' };
  if (!serverFetchEnabled(source)) return { ok: false, reason: 'disabled' };
  const breaker = await readBreaker(source);
  if (breaker.pausedUntil && new Date(breaker.pausedUntil).getTime() > Date.now()) return { ok: false, reason: 'paused' };
  // Nominal bandwidth cost per page, metered against whoever is running the action.
  return meter({ provider: 'onthemarket', unit: opts.unit ?? 'listing_page', key: url, failed: (r) => !r.ok }, () => fetchListingHtmlRaw(source, url, breaker));
}

async function fetchListingHtmlRaw(source: ListingSource, url: string, breaker: BreakerState): Promise<FetchOutcome> {

  const host = new URL(url).hostname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (new URL(res.url).hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) return { ok: false, reason: 'error', status: res.status };
    if (res.status === 404 || res.status === 410) {
      await writeBreaker(source, { failures: 0, pausedUntil: null });
      return { ok: false, reason: 'not_found', status: res.status };
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) return { ok: false, reason: 'too_large', status: res.status };
    const html = await readCapped(res, MAX_BYTES);
    if (html === null) return { ok: false, reason: 'too_large', status: res.status };
    if (!res.ok || looksBlocked(res.status, html)) {
      const failures = breaker.failures + 1;
      const paused = failures >= BREAKER_THRESHOLD;
      await writeBreaker(source, { failures: paused ? 0 : failures, pausedUntil: paused ? new Date(Date.now() + BREAKER_PAUSE_MS).toISOString() : null });
      if (paused) console.warn(`[listing] ${source} paused for 6h after ${failures} consecutive blocks`);
      return { ok: false, reason: 'blocked', status: res.status };
    }
    if (breaker.failures > 0) await writeBreaker(source, { failures: 0, pausedUntil: null });
    return { ok: true, html, status: res.status };
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { ok: false, reason: 'timeout' };
    console.error(`[listing] fetch ${source} failed:`, err);
    return { ok: false, reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
