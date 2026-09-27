import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { earliestPricingDateFrom } from './deal-pricing';

/**
 * When the members' pricing notice last went out (profiles.pricing_notice_sent_at,
 * src/lib/credit/pricing-notice-run.ts), or null when it has not, or the
 * column is not there yet (schema.sql not run): then no notice has gone.
 */
export async function latestPricingNoticeAt(): Promise<Date | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('pricing_notice_sent_at')
    .not('pricing_notice_sent_at', 'is', null)
    .order('pricing_notice_sent_at', { ascending: false })
    .limit(1);
  if (error) {
    console.warn('[pricing] notice read failed (schema behind?):', error.message);
    return null;
  }
  const at = (data?.[0] as { pricing_notice_sent_at?: string } | undefined)?.pricing_notice_sent_at;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
}

/** The earliest new-pricing date that still gives every member 14 days' notice. */
export async function earliestPricingDate(now: Date = new Date()): Promise<Date> {
  return earliestPricingDateFrom(await latestPricingNoticeAt(), now);
}
