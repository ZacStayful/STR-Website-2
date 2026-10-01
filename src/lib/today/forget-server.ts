import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { todayKey } from './day';

/**
 * Forgets the member's stored Today lists for the current Today-day, so the
 * next visit chooses again (Batch 21, C32). Used when the account's tier
 * changes mid-day: the first top-up or the starter pack lifts the early-access
 * delay (hasEverPaid), but the morning's list was chosen as a free member and
 * would keep the free-tier selection until 07:00 UTC. Answered deals are
 * excluded from the new choice as they always are.
 */
export async function forgetTodayLists(userId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  const admin = createAdminClient();
  const day = todayKey(now);
  const [a, b] = await Promise.all([
    admin.from('today_selections').delete().eq('user_id', userId).eq('day', day),
    admin.from('profile_today_lists').delete().eq('user_id', userId).eq('day', day),
  ]);
  if (a.error) console.error('[today] forgetting the day list failed:', a.error.message);
  if (b.error) console.error('[today] forgetting the profile lists failed:', b.error.message);
}
