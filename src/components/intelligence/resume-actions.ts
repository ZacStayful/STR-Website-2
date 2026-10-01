'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { createResumeIntent, resumeDecisionFor } from '@/lib/billing/resume-server';
import type { ResumeDecision, ResumeItem } from '@/lib/billing/resume-rules';

/** Saves what the member ticked before they top up; the top-up brings them back to it. */
export async function saveResumeIntentAction(items: ResumeItem[], returnPath: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !Array.isArray(items)) return null;
  return createResumeIntent(user.id, items, returnPath);
}

/** Back from paying: quoted again; start only if every price still matches. */
export async function resumeAction(id: string): Promise<ResumeDecision> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || typeof id !== 'string') return { kind: 'expired' };
  return resumeDecisionFor(user.id, supabase, isAdminEmail(user.email), id);
}
