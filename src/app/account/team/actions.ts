'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { teamOf } from '@/lib/team';
import { createInvite, revokeInvite } from '@/lib/team/invites';
import { removeMember } from '@/lib/team/remove';

/**
 * Managing a team. Every action resolves the session and the person's role
 * itself: inviting, withdrawing and removing are the owner's; leaving is the
 * member's. Ids from the form are only ever matched within that team.
 */

const UUID = /^[0-9a-f-]{36}$/i;

export interface TeamState {
  error?: string;
  notice?: string;
}

async function me(): Promise<{ id: string; role: 'owner' | 'member'; ownerId: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const team = await teamOf(user.id);
  return { id: user.id, role: team.role, ownerId: team.ownerId };
}

export async function inviteAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const who = await me();
  if (!who) return { error: 'Please sign in again.' };
  if (who.role !== 'owner') return { error: 'Only the account owner can invite people.' };
  const error = await createInvite(who.id, formData.get('email'));
  if (error) return { error };
  revalidatePath('/account/team');
  return { notice: 'Invite sent. It works for 7 days.' };
}

export async function revokeInviteAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const who = await me();
  if (!who || who.role !== 'owner') return { error: 'Only the account owner can do that.' };
  const ok = await revokeInvite(who.id, String(formData.get('inviteId') ?? ''));
  revalidatePath('/account/team');
  return ok ? { notice: 'Invite withdrawn.' } : { error: 'That invite is no longer open.' };
}

export async function removeMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const who = await me();
  if (!who || who.role !== 'owner') return { error: 'Only the account owner can do that.' };
  const memberId = String(formData.get('memberId') ?? '');
  if (!UUID.test(memberId)) return { error: 'They are not on this team.' };
  if (String(formData.get('confirm') ?? '').trim().toLowerCase() !== 'remove') {
    return { error: 'Type REMOVE to confirm.' };
  }
  const result = await removeMember({ ownerId: who.id, memberId, by: 'owner' });
  revalidatePath('/account/team');
  if (!result.ok) return { error: result.error ?? 'That did not work.' };
  return { notice: result.loginDeleted ? 'Removed, and their team login deleted.' : 'Removed from your team.' };
}

export async function leaveTeamAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const who = await me();
  if (!who) return { error: 'Please sign in again.' };
  if (who.role !== 'member') return { error: 'You are not on anyone else’s team.' };
  if (String(formData.get('confirm') ?? '').trim().toLowerCase() !== 'leave') {
    return { error: 'Type LEAVE to confirm.' };
  }
  const result = await removeMember({ ownerId: who.ownerId, memberId: who.id, by: 'member' });
  if (!result.ok) return { error: result.error ?? 'That did not work.' };
  if (result.loginDeleted) {
    // The login is gone; the session cookie now points at nobody.
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect('/');
  }
  revalidatePath('/account/team');
  return { notice: 'You have left the team.' };
}
