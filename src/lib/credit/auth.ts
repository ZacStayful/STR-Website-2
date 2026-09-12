import 'server-only';

import { createSupabaseServerClient } from '../supabase/server';
import { isAdminEmail } from '../admin';

/** The signed-in member for a credit / billing route, or null. */
export async function currentMember(): Promise<{ id: string; email: string | null; admin: boolean } | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, admin: isAdminEmail(data.user.email) };
  } catch {
    return null;
  }
}
