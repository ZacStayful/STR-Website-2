import 'server-only';

/**
 * Batch 22e: the one call each screening job makes when it has finished (the
 * sweep, the daily picks after their broker queries, the low-entry search).
 * Recounts yesterday and today in listing_scan_days from sourced_listings;
 * a re-run overwrites, so it can never double a day. Dry runs return before
 * they reach it. Never throws: a failed count must not fail the job.
 */
import type { createAdminClient } from '../supabase/admin';
import { scanDaysToRecount } from './scan-days';

type Admin = ReturnType<typeof createAdminClient>;

export async function recordScanDays(admin: Admin, now: Date = new Date()): Promise<void> {
  try {
    const { error } = await admin.rpc('record_listing_scan_days', { p_days: scanDaysToRecount(now) });
    if (error) console.warn('[scan-days] recount failed:', error.message);
  } catch (err) {
    console.warn('[scan-days] recount failed:', err instanceof Error ? err.message : String(err));
  }
}
