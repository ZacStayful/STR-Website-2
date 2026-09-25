import 'server-only';

import type { User } from '@supabase/supabase-js';

/**
 * Whose leads a signed-in person is looking at, and what they may do there.
 *
 * Today that is always their own, as the owner. It is its own function so
 * that team access can change the answer in ONE place: every leads page,
 * action and route below asks this rather than using `user.id` directly,
 * and reads through the service role filtered by `ownerId` rather than by
 * RLS's `auth.uid()` — which would only ever match the owner.
 */
export interface LeadScope {
  /** The account that owns the funnels and the leads. */
  ownerId: string;
  role: 'owner';
}

export async function leadScope(user: Pick<User, 'id'>): Promise<LeadScope> {
  return { ownerId: user.id, role: 'owner' };
}
