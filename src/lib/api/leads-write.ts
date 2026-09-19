import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';

/**
 * Writes against a lead.
 *
 * Every one carries its own `user_id` filter. An API key is not a session,
 * so there is no `auth.uid()` for RLS to match — the filter IS the boundary,
 * and a write without it would let any valid key reach any customer's rows.
 */

/**
 * Erases a lead outright.
 *
 * The customer is the data controller for everyone who fills in their funnel
 * and needs a working way to honour a deletion request. A soft delete would
 * leave the person's name, email and home address in the table, which is not
 * erasure whatever the UI calls it. `crm_deliveries` cascades from here.
 */
export async function deleteLead(userId: string, leadId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient()
    .from('leads')
    .delete()
    .eq('user_id', userId)
    .eq('id', leadId)
    .select('id');
  if (error) {
    console.error('[api] lead delete failed:', error.message);
    return false;
  }
  // An empty result means no row matched BOTH filters — a lead that does not
  // exist and one belonging to someone else are answered identically, so a
  // key cannot probe for other customers' ids.
  return (data ?? []).length > 0;
}
