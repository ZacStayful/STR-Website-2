import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { toCheckedListingRow, type CheckedListingRow } from './pipeline';

/**
 * Public read of one shared listing by its token. Uses the service role
 * (the page has no member session) and returns only the trimmed row: never
 * the owner's id, notes or report id.
 */
export async function sharedListingByToken(token: string): Promise<Omit<CheckedListingRow, 'notes' | 'analysedReportId' | 'shareToken'> | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data } = await createAdminClient()
    .from('checked_listings')
    .select('id, canonical_url, source, kind, postcode, postcode_area, lat, lng, snapshot, quick_estimate, deal, status, listing_status, updated_at')
    .eq('share_token', token)
    .maybeSingle();
  if (!data) return null;
  const row = toCheckedListingRow(data as Record<string, unknown>);
  if (!row) return null;
  const { notes: _n, analysedReportId: _r, shareToken: _t, ...pub } = row;
  void _n; void _r; void _t;
  return pub;
}
