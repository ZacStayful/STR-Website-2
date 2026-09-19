import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';

/**
 * The minimum automatic-top-up trigger for an account with a live funnel.
 *
 * £20 is not a round number picked for looking sensible. A worst-case
 * enhanced funnel lead reserves £6.32, and a public funnel can have three
 * arriving at once — £18.96. Below that, the balance can cross the trigger
 * and be overshot before the charge has time to land, which is exactly the
 * situation the trigger exists to prevent.
 *
 * It is a floor, not a default: an account with no funnel is one person
 * clicking a button and has no need of it.
 */
export const FUNNEL_TOPUP_FLOOR_PENCE = 2000;

/**
 * What an account that has never set one is shown and charged against.
 *
 * Matches the schema's column default. Kept here as well because three
 * places read it as a fallback — the settings route, the summary the billing
 * page renders, and `maybeAutoTopup` — and three literals drift.
 */
export const DEFAULT_TOPUP_THRESHOLD_PENCE = 2000;

/** Whether this account has at least one funnel currently accepting leads. */
export async function hasLiveFunnel(userId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient()
    .from('funnels')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .limit(1);
  if (error) {
    // Fail OPEN. This gates a settings change, not spending: refusing a
    // customer's billing edit because a query blipped would be worse than
    // briefly allowing a lower trigger.
    console.error('[credit] live funnel check failed:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}
