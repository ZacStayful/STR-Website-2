import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { toCheckedListingRow, type CheckedListingRow } from './pipeline';
import { dealVisible } from '../marketplace/visibility';
import { publicDealVisibility } from '../marketplace/tier';

export type SharedListing = Omit<CheckedListingRow, 'notes' | 'analysedReportId' | 'shareToken' | 'status'> & {
  /**
   * Batch 21 (C19): the listing is a feed deal still inside the public
   * early-access window, so the address, postcode, photo and listing link are
   * held back (the figures stay), exactly as /d/<token> holds them back. A
   * share link is never a way round the delay, whoever shared it.
   */
  withheld: boolean;
};

/**
 * Public read of one shared listing by its token. Uses the service role
 * (the page has no member session) and returns only the trimmed row: never
 * the owner's id, notes or report id.
 */
export async function sharedListingByToken(token: string): Promise<SharedListing | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data } = await createAdminClient()
    .from('checked_listings')
    .select('id, canonical_url, source, kind, postcode, postcode_area, lat, lng, snapshot, quick_estimate, deal, listing_status, updated_at')
    .eq('share_token', token)
    .maybeSingle();
  if (!data) return null;
  const row = toCheckedListingRow(data as Record<string, unknown>);
  if (!row) return null;
  const { notes: _n, analysedReportId: _r, shareToken: _t, status: _s, ...pub } = row;
  void _n; void _r; void _t; void _s;
  const { data: deal } = await createAdminClient().from('marketplace_deals').select('status, live_since').eq('canonical_url', pub.canonicalUrl).maybeSingle();
  const d = deal as { status: string; live_since: string | null } | null;
  if (d && d.status !== 'retired' && (d.status !== 'live' || !dealVisible(d.live_since, (await publicDealVisibility()).cutoffIso))) {
    return { ...pub, withheld: true, title: 'A short-let deal in early access', displayAddress: null, postcode: null, lat: null, lng: null, photo: null, canonicalUrl: '' };
  }
  return { ...pub, withheld: false };
}
