import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor } from '../team';
import { postcodeAreaOf } from '../listing/normalise';
import type { AnalysisInput } from '../analysis/input';
import type { AnalysisResult } from '../types';

/**
 * Saving an analysis run through the API into the member's own history.
 *
 * `saved_searches`, the same table the browser analyser writes to: an
 * analysis run through the API is still their report, and it must be
 * findable under /reports afterwards rather than existing only in whatever
 * the agent did with the response.
 *
 * The 200-row prune in /api/analyse is deliberately NOT repeated here. It
 * runs on a schedule of its own and trimming from two places would mean two
 * definitions of how much history a member keeps.
 */
export async function saveApiReport(
  userId: string,
  input: AnalysisInput,
  result: AnalysisResult,
): Promise<string | null> {
  if (!hasServiceRole()) return null;
  const { payerId: ownerId } = await payerFor(userId);
  const { data, error } = await createAdminClient()
    .from('saved_searches')
    .insert({
      user_id: userId,
      owner_id: ownerId,
      name: result.property.address,
      address: result.property.address,
      postcode: result.property.postcode,
      postcode_area: postcodeAreaOf(result.property.postcode),
      guest_count: result.property.guests,
      bedrooms: result.property.bedrooms,
      kind: input.rentPcm ? 'rent' : 'sale',
      result,
      deal: result.deal,
    })
    .select('id')
    .single();
  if (error || !data) {
    // Never fails the response: the caller has their analysis, and it has
    // already been paid for. Losing the history row is the lesser problem.
    console.error('[api] report save failed:', error?.message);
    return null;
  }
  return data.id as string;
}
