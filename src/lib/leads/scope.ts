import 'server-only';

import type { User } from '@supabase/supabase-js';
import { teamOf } from '../team';
import { can, type Capability, type TeamRole } from '../team/rules';

/**
 * Whose leads a signed-in person is looking at, and what they may do there.
 *
 * An owner sees their own; a team member sees their owner's. Every leads
 * page, action and route asks this rather than using `user.id` directly, and
 * reads through the service role filtered by `ownerId` — RLS's `auth.uid()`
 * would only ever match the owner.
 */
export interface LeadScope {
  /** The account that owns the funnels and the leads. */
  ownerId: string;
  role: TeamRole;
}

/** A member whose seat is paused sees nothing of the team until it is paid. */
export class SeatPausedError extends Error {
  constructor() {
    super('seat_paused');
  }
}

export async function leadScope(user: Pick<User, 'id'>): Promise<LeadScope> {
  const team = await teamOf(user.id);
  if (team.role === 'member' && team.suspended) throw new SeatPausedError();
  return { ownerId: team.ownerId, role: team.role };
}

/** For pages: null instead of throwing, so the page can say why. */
export async function leadScopeOrPaused(user: Pick<User, 'id'>): Promise<LeadScope | 'paused'> {
  try {
    return await leadScope(user);
  } catch (err) {
    if (err instanceof SeatPausedError) return 'paused';
    throw err;
  }
}

export function allowed(scope: LeadScope, what: Capability): boolean {
  return can(scope.role, what);
}

/**
 * For the owner-only corners of Leads (funnels, integrations, API keys): the
 * signed-in person's id when they own their account, null for a team member.
 * A member's own account id must never reach these — it would create
 * funnels and keys on an account that has no leads.
 */
export async function ownerIdOrNull(user: Pick<User, 'id'> | null): Promise<string | null> {
  if (!user) return null;
  const team = await teamOf(user.id);
  return team.role === 'owner' ? user.id : null;
}
