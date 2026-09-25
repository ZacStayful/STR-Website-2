'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { acceptInvite } from '@/lib/team/invites';

export interface JoinState {
  error?: string;
}

export async function acceptInviteAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in first.' };
  const token = String(formData.get('token') ?? '');
  const result = await acceptInvite({ id: user.id, email: user.email ?? null }, token);
  if (!result.ok) return { error: result.error };
  redirect('/leads');
}
