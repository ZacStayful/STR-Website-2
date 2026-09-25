import 'server-only';

import { cache } from 'react';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { TeamRole } from './rules';

/**
 * Who a signed-in person works for.
 *
 * An owner has no row in `team_members`; a member has exactly one (it is the
 * primary key), so this is a single lookup — cached per request, because a
 * page and its layout and its actions all ask.
 */
export interface Team {
  ownerId: string;
  role: TeamRole;
  /** A member whose seat renewal could not be paid. Owners are never suspended. */
  suspended: boolean;
}

export const teamOf = cache(async (userId: string): Promise<Team> => {
  if (!hasServiceRole()) return { ownerId: userId, role: 'owner', suspended: false };
  const { data, error } = await createAdminClient()
    .from('team_members')
    .select('owner_id, suspended_at')
    .eq('member_id', userId)
    .maybeSingle();
  if (error) {
    // The table not existing yet (schema not applied) must not lock anyone
    // out of their own account: fall back to "owner of yourself".
    console.error('[team] membership lookup failed:', error.message);
    return { ownerId: userId, role: 'owner', suspended: false };
  }
  if (!data) return { ownerId: userId, role: 'owner', suspended: false };
  const row = data as { owner_id: string; suspended_at: string | null };
  return { ownerId: row.owner_id, role: 'member', suspended: Boolean(row.suspended_at) };
});

interface ProfileName {
  full_name: string | null;
  email: string | null;
}

/** A person's name for emails and lists: their name, else their email. */
export function personName(p: ProfileName | null | undefined): string {
  return p?.full_name?.trim() || p?.email?.trim() || 'A team member';
}

/**
 * What a team is called: the company name on the owner's first funnel, else
 * the owner's own name. The funnel's company name is what the customer
 * already calls themselves in front of their prospects.
 */
export async function teamName(ownerId: string): Promise<string> {
  if (!hasServiceRole()) return 'your team';
  const admin = createAdminClient();
  const [{ data: funnels }, { data: owner }] = await Promise.all([
    admin.from('funnels').select('brand').eq('user_id', ownerId).order('created_at', { ascending: true }).limit(5),
    admin.from('profiles').select('full_name, email').eq('id', ownerId).maybeSingle(),
  ]);
  for (const f of (funnels ?? []) as Array<{ brand: { companyName?: unknown } | null }>) {
    const name = typeof f.brand?.companyName === 'string' ? f.brand.companyName.trim() : '';
    if (name) return name;
  }
  return `${personName(owner as ProfileName | null)}'s team`;
}

export async function profileNames(ids: string[]): Promise<Map<string, ProfileName>> {
  const out = new Map<string, ProfileName>();
  if (ids.length === 0 || !hasServiceRole()) return out;
  const { data } = await createAdminClient().from('profiles').select('id, full_name, email').in('id', ids);
  for (const p of (data ?? []) as Array<ProfileName & { id: string }>) out.set(p.id, p);
  return out;
}

/** True when this person is a member of any team, or has an open invite to one. */
export async function isTeamBound(userId: string, email: string | null): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data: m } = await createAdminClient().from('team_members').select('member_id').eq('member_id', userId).maybeSingle();
  if (m) return true;
  return hasOpenInvite(email);
}

/** An unexpired, unused invite exists for this address. */
export async function hasOpenInvite(email: string | null): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  const { data: inv } = await createAdminClient()
    .from('team_invites')
    .select('id')
    .eq('email', e)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  return (inv ?? []).length > 0;
}
