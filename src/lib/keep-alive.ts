import 'server-only';

import { after } from 'next/server';

/**
 * Keeps a promise running after the response is sent. Used when a request
 * stops waiting for a slow lookup (see withTimeout) but the lookup should
 * still finish: the provider has been paid, and its cache write and spend
 * ledger only happen when it settles. Bounded by the route's maxDuration;
 * outside a request scope (tests, scripts) it is a no-op.
 */
export function keepAlive(promise: Promise<unknown>): void {
  try {
    after(() => promise.catch(() => undefined));
  } catch {
    // Not inside a request: nothing to extend.
  }
}
