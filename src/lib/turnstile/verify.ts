import 'server-only';

import {
  readSiteverify, missingToken, notConfigured, unreachable, turnstileConfigured,
  type SiteverifyResponse, type TurnstileOutcome,
} from './verdict.ts';

/**
 * Asking Cloudflare whether a funnel submission came from a person.
 *
 * The decision logic lives in verdict.ts and is tested; this half only does
 * the network call. Bounded at 5 seconds — a prospect is watching a spinner,
 * and a slow anti-bot check that costs us the lead has defeated itself.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

export function turnstileEnabled(): boolean {
  return turnstileConfigured(process.env.TURNSTILE_SECRET_KEY, process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export async function verifyTurnstile(token: string | null | undefined, ip?: string | null): Promise<TurnstileOutcome> {
  // Unconfigured is a no-op rather than a wall: funnels that were live
  // before the keys were set must keep collecting leads.
  if (!turnstileEnabled()) return notConfigured();

  const response = typeof token === 'string' ? token.trim() : '';
  if (response.length === 0) return missingToken();

  const form = new URLSearchParams({
    secret: String(process.env.TURNSTILE_SECRET_KEY),
    response,
  });
  // Cloudflare cross-checks the IP the challenge was solved from. 'unknown'
  // is what the route uses when there is no forwarded header, and sending
  // that would be worse than sending nothing.
  if (ip && ip !== 'unknown') form.set('remoteip', ip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      // A 5xx from Cloudflare is their problem, not the prospect's.
      console.error(`[turnstile] siteverify HTTP ${res.status}`);
      return unreachable();
    }
    return readSiteverify((await res.json()) as SiteverifyResponse);
  } catch (err) {
    // Timeout or network failure. Fails OPEN — see verdict.ts for why that
    // is safe here and would not be elsewhere.
    console.error('[turnstile] siteverify unreachable:', err instanceof Error ? err.message : err);
    return unreachable();
  }
}
