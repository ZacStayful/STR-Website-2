/**
 * Types and message shapes shared by the service worker, content script and
 * popup. Listing types come straight from the website's library so the
 * extension and the site never disagree about a snapshot.
 */
import type { ListingSnapshot } from '../../src/lib/listing/types.ts';
import type { QuickEstimate } from '../../src/lib/listing/quick-types.ts';
import type { AnalyserPrefill } from '../../src/lib/listing/normalise.ts';

export const DEFAULT_SITE = 'https://intelligence.stayful.co.uk';

/** Extension-local storage. */
export interface Settings {
  token: string | null;
  site: string;
}

export interface CheckResponse {
  snapshot: ListingSnapshot;
  prefill: AnalyserPrefill;
  warnings: string[];
  quick: QuickEstimate;
  checkedListingId: string | null;
  fromCache: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
  upgradeUrl?: string;
}

export interface MeResponse {
  email: string | null;
  state: 'ok' | 'blocked';
  plan: 'free' | 'pro' | null;
  runsRemaining: number | null;
}

export type Message =
  | { type: 'status' }
  | { type: 'check'; url: string; html: string; save?: boolean }
  | { type: 'setToken'; token: string; site?: string }
  | { type: 'disconnect' };

export type StatusResult = { connected: false; site: string } | { connected: true; site: string; me: MeResponse };

export type CheckResult = { ok: true; data: CheckResponse } | { ok: false; status: number; error: ApiError };

export type Reply = StatusResult | CheckResult | { ok: boolean; error?: string };

export function normaliseSite(raw: string | undefined | null): string {
  const s = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/.test(s) ? s : DEFAULT_SITE;
}
