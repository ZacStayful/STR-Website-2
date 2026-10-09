import 'server-only';

/**
 * Batch 25: is a standout deal still on the market? One listing read through
 * the same pieces a paid open uses (loadScreenContext, fetchDealPage,
 * applyLiveResult in src/lib/marketplace), so the deal row is updated or
 * retired exactly as the hourly recheck would. House spend, never a member's.
 *
 * A deal whose source cannot be fetched (the feed-only portals) is "unknown":
 * the caller then relies on the feed's own sighting.
 */
import { loadDealById, loadScreenContext, loadSourcedListings, fetchDealPage, applyLiveResult, type Admin } from '../marketplace/server';
import { serverFetchEnabled } from '../listing/fetch';
import { runMetered } from '../credit/context';

export type RecheckResult = { result: 'live'; confirmedAt: string } | { result: 'gone' } | { result: 'unknown' };

/** The ledger action for the house-spend page read (credit/usage-label.ts). */
export const STANDOUT_VERIFY_ACTION = 'standout_verify';

export async function recheckDeal(admin: Admin, dealId: string, now: Date = new Date()): Promise<RecheckResult> {
  const deal = await loadDealById(admin, dealId);
  if (!deal || deal.status === 'retired') return { result: 'gone' };
  if (!serverFetchEnabled(deal.source)) return { result: 'unknown' };
  const ctx = await loadScreenContext(10_000);
  const sourced = (await loadSourcedListings(admin, [deal.canonical_url])).get(deal.canonical_url);
  if (!ctx || !sourced) return { result: 'unknown' };
  const res = await runMetered({ userId: null, admin: false, action: STANDOUT_VERIFY_ACTION, actionId: crypto.randomUUID() }, () => fetchDealPage(deal));
  if (!res) return { result: 'unknown' };
  const outcome = await applyLiveResult(admin, deal, sourced.listing, res, ctx, now);
  if (outcome.kind === 'retired') return { result: 'gone' };
  if (outcome.kind === 'live') return { result: 'live', confirmedAt: now.toISOString() };
  return { result: 'unknown' };
}

/** Ask the hourly recheck to take this deal first (what a paid open does when it can't read the page). */
export async function requestCheck(admin: Admin, dealId: string, now: Date = new Date()): Promise<void> {
  const iso = now.toISOString();
  const { error } = await admin.from('marketplace_deals').update({ check_requested_at: iso, next_check_due_at: iso, updated_at: iso }).eq('id', dealId).eq('status', 'live');
  if (error) console.error('[standout] check request failed:', error.message);
}
