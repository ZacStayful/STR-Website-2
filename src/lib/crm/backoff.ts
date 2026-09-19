/**
 * When to try a failed delivery again.
 *
 * Pure, and tested, because getting it wrong is silent in both directions: a
 * schedule that is too eager hammers a customer's endpoint while it is
 * already struggling, and one that is too slow leaves a lead sitting in our
 * database for hours while they are waiting for it in their CRM.
 *
 * The shape is 1, 5, 25 minutes then an hourly ceiling — fast enough that a
 * blip costs a minute, patient enough that a real outage is not a flood, and
 * capped so a long one still recovers within the hour of coming back.
 */

/** Attempts before a delivery is given up on and the error left visible. */
export const MAX_ATTEMPTS = 6;

/** Nothing retries more than hourly, however long the outage. */
export const MAX_BACKOFF_MINUTES = 60;

/** Minutes to wait after `attempts` failures. `attempts` is 1 for the first. */
export function backoffMinutes(attempts: number): number {
  // A non-finite count would propagate a NaN into the timestamp and produce
  // a delivery that is never due again. Treat anything unusable as the first
  // attempt: retrying a minute early is recoverable, never retrying is not.
  const n = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(MAX_BACKOFF_MINUTES, 5 ** (n - 1));
}

/**
 * Whether this delivery gets another go.
 *
 * `retryable === false` beats the attempt count every time: a revoked token
 * or a deleted board fails identically for ever, and five more attempts only
 * bury the error the customer needs to read.
 */
export function shouldRetry(attempts: number, retryable: boolean | undefined): boolean {
  if (retryable === false) return false;
  return attempts < MAX_ATTEMPTS;
}

/** The timestamp to store, or null when the delivery is done trying. */
export function nextAttemptAt(attempts: number, retryable: boolean | undefined, now = Date.now()): string | null {
  if (!shouldRetry(attempts, retryable)) return null;
  return new Date(now + backoffMinutes(attempts) * 60_000).toISOString();
}
