import 'server-only';

/**
 * Batch 27: who the eye is acting for, always from the signed-in session
 * (Batch 26's chatMemberFor: the payer for a team member, admins never
 * charged). Nothing a page or a model sends can name another member.
 */
import type { User } from '@supabase/supabase-js';
import { chatMemberFor } from '../chat/turns-server';
import type { ActingMember } from './steps-server';

export async function actingMemberFor(user: Pick<User, 'id' | 'email'>): Promise<{ member: ActingMember; seatPaused: boolean }> {
  const c = await chatMemberFor(user);
  return { member: { userId: c.userId, email: user.email ?? null, payerId: c.payerId, admin: c.admin, teamMember: c.teamMember }, seatPaused: c.seatPaused };
}
