import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';

/**
 * Does this account own at least one funnel, live or paused? Decides only
 * whether Leads stays in the nav for existing funnel customers; it never
 * gates the Leads pages themselves. Any failure reads as "no".
 */
export async function ownsAnyFunnel(userId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { count, error } = await createAdminClient().from('funnels').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) {
    console.error('[funnels] ownership check failed:', error.message);
    return false;
  }
  return (count ?? 0) > 0;
}
