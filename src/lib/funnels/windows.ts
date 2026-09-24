/**
 * Window keys and verdicts for funnel rate limiting.
 *
 * Pure half of the caps (no I/O, no `server-only`, relative `.ts` imports) so
 * it runs under `node --test`. The half that talks to Postgres lives in
 * `caps.ts`, which imports this — the same split as picks.ts / picks-server.ts.
 */

/** Attempts one IP may make against one funnel inside a window. */
export const IP_WINDOW_MINUTES = 10;
export const IP_ATTEMPTS_PER_WINDOW = 5;

export type CapVerdict = 'ok' | 'daily_cap' | 'ip_throttle' | 'spend_cap' | 'unavailable';

/** UTC midnight — the window the daily caps are counted against. */
export function dayWindow(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Start of the current fixed N-minute window. Fixed rather than rolling, so
 * every request inside the window shares one counter row and the check stays
 * a single statement.
 */
export function minuteWindow(minutes = IP_WINDOW_MINUTES, now = new Date()): string {
  const ms = minutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
}

/** An IP is only ever a bucket key, never a column of its own. */
export function ipBucket(ip: string): string {
  return `ip:${ip.slice(0, 64)}`;
}

/**
 * What the prospect is told. Deliberately says nothing about the customer's
 * balance, spend or limits — that is the customer's business, not a
 * stranger's.
 */
export function capMessage(verdict: Exclude<CapVerdict, 'ok'>): string {
  switch (verdict) {
    case 'ip_throttle':
      return 'You have sent a few requests in a row. Please wait a few minutes and try again.';
    case 'unavailable':
      // Our end failed, not a limit of theirs. Telling someone the form is
      // full for the day when it is not sends them away for good.
      return 'We could not accept that just now. Please try again in a moment.';
    default:
      return 'This form has reached its limit for today. Please try again tomorrow.';
  }
}
