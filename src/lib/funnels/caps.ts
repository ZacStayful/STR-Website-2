import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { dayWindow, minuteWindow, ipBucket, IP_ATTEMPTS_PER_WINDOW, type CapVerdict } from './windows';

/**
 * Rate limiting and the daily ceilings for a public funnel.
 *
 * Every check goes through a SQL function that counts and decides in one
 * statement. The members-only equivalent (`resolvesToday` in
 * src/lib/listing/server.ts) counts rows and then checks the count, which is
 * fine when the member is one person clicking a button — but on a public
 * endpoint concurrent requests all read the same count and all pass it, so a
 * count-then-check caps nothing. Proven under 30-way concurrency against a
 * real PostgreSQL: with a cap of 5, exactly 5 are allowed.
 */

export { dayWindow, minuteWindow, ipBucket, capMessage, IP_WINDOW_MINUTES, IP_ATTEMPTS_PER_WINDOW } from './windows';
export type { CapVerdict } from './windows';

async function hit(funnelId: string, bucket: string, window: string, limit: number): Promise<number> {
  if (!hasServiceRole()) return -1;
  const { data, error } = await createAdminClient().rpc('funnel_hit', {
    p_funnel: funnelId,
    p_bucket: bucket,
    p_window: window,
    p_limit: limit,
  });
  if (error) {
    // Fail closed: a counter we cannot reach is not permission to spend.
    console.error('[funnels] funnel_hit failed:', error.message);
    return -1;
  }
  return typeof data === 'number' ? data : -1;
}

/**
 * Counts one attempt against both the per-IP window and the funnel's daily
 * cap. The IP check runs first so a single abuser cannot burn a customer's
 * daily allowance before the daily counter even sees it.
 */
export async function countAttempt(funnelId: string, ip: string, dailyCap: number): Promise<CapVerdict> {
  if (!hasServiceRole()) return 'unavailable';
  const perIp = await hit(funnelId, ipBucket(ip), minuteWindow(), IP_ATTEMPTS_PER_WINDOW);
  if (perIp < 0) return 'ip_throttle';
  const daily = await hit(funnelId, 'funnel', dayWindow(), dailyCap);
  if (daily < 0) return 'daily_cap';
  return 'ok';
}

/**
 * Claims `basePence` of today's spend ceiling at the run's WORST case, before
 * the run. Returns false without changing anything when that would breach the
 * cap. Always pair with `settleSpend` so unused headroom goes back.
 */
export async function reserveSpend(funnelId: string, basePence: number, capPence: number): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient().rpc('funnel_spend_reserve', {
    p_funnel: funnelId,
    p_window: dayWindow(),
    p_base_pence: basePence,
    p_cap: capPence,
  });
  if (error) {
    console.error('[funnels] funnel_spend_reserve failed:', error.message);
    return false;
  }
  return data === true;
}

/** Swaps the worst-case reservation for what the run actually cost. */
export async function settleSpend(funnelId: string, reservedPence: number, actualPence: number): Promise<void> {
  if (!hasServiceRole()) return;
  const { error } = await createAdminClient().rpc('funnel_spend_settle', {
    p_funnel: funnelId,
    p_window: dayWindow(),
    p_reserved: reservedPence,
    p_actual: actualPence,
  });
  if (error) console.error('[funnels] funnel_spend_settle failed:', error.message);
}

/**
 * Address lookups one IP may make against one funnel inside a window.
 *
 * Deliberately generous. The field debounces at 300ms with a three-character
 * minimum, so entering one address costs a handful of requests — but a shared
 * office or campus NAT puts many prospects behind one address, and refusing a
 * real one to slow an attacker down would be the wrong trade. The hard money
 * guard is the funnel's daily spend ceiling, which bounds the day's loss
 * whatever the rate; this only stops one IP burning through it in seconds.
 */
export const AUTOCOMPLETE_PER_IP_PER_WINDOW = 300;

/**
 * Counts one address lookup on a funnel, per IP.
 *
 * A DIFFERENT bucket from `countAttempt`'s, deliberately. Autocomplete fires
 * per keystroke, so counting it against the prospect's five-submissions-per-ten-
 * minutes or the funnel's daily LEAD cap would have somebody typing their own
 * address lock themselves out of the form before they could ever submit it.
 *
 * Fails closed, for the same reason `hit` does: the lookup spends the funnel
 * owner's money, and a counter we cannot reach is not permission to spend it.
 */
export async function countAutocomplete(funnelId: string, ip: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  return (await hit(funnelId, `ac:${ipBucket(ip)}`, minuteWindow(), AUTOCOMPLETE_PER_IP_PER_WINDOW)) >= 0;
}
