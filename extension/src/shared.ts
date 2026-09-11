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
  /** The derived account status behind a no_access refusal, e.g. 'paused'. */
  reason?: string;
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

/** `me: null` means the token is stored but the site could not confirm it right now (retry, not a plan problem). */
export type StatusResult = { connected: false; site: string } | { connected: true; site: string; me: MeResponse } | { connected: true; site: string; me: null; error: string };

export type CheckResult = { ok: true; data: CheckResponse } | { ok: false; status: number; error: ApiError };

export type Reply = StatusResult | CheckResult | { ok: boolean; error?: string };

export function normaliseSite(raw: string | undefined | null): string {
  const s = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/.test(s) ? s : DEFAULT_SITE;
}

/** Escapes text for the panel/popup HTML (attribute values included). */
export function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Sends a message to the service worker and resolves with its reply. */
export function send<T>(message: Message): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
