'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { syncChecklist, type ChecklistView } from '@/lib/today/checklist-server';

/**
 * Brings the first-week checklist up to date after something on Today (a
 * Keep) may have completed a step, and returns what the card should now
 * show. The session decides whose checklist: nothing is taken from the
 * request. Null when signed out.
 */
export async function refreshChecklistAction(): Promise<ChecklistView | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return syncChecklist(user.id, { markSeen: true });
}
