'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { leadScope, type LeadScope } from '@/lib/leads/scope';
import { touchLeads } from '@/lib/leads/activity';
import { parseStage, STAGE_LABELS } from '@/lib/leads/stage';
import { purgeAfter, retentionDate } from '@/lib/leads/retention';

/**
 * Stage, archive and restore for a customer's own leads.
 *
 * `leads` grants `authenticated` nothing but SELECT, so every write goes
 * through the service role, scoped by the owner id `leadScope` resolves from
 * the session. An id from someone else's account matches no row and writes
 * nothing — and is answered exactly like an id that does not exist.
 */

const UUID = /^[0-9a-f-]{36}$/i;
/** Enough for a page of bulk selection; more is not a click, it is a script. */
const MAX_BATCH = 200;

async function scope(): Promise<LeadScope | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? leadScope(user) : null;
}

function ids(formData: FormData): string[] {
  const out = new Set<string>();
  for (const v of formData.getAll('leadId')) {
    const id = String(v);
    if (UUID.test(id)) out.add(id);
  }
  return [...out].slice(0, MAX_BATCH);
}

export interface LeadActionState {
  error?: string;
  notice?: string;
}

/**
 * Archives leads. They are deleted 7 days later unless restored.
 *
 * The customer is told on screen, here, so the deletion date is set now —
 * unlike an inactivity archive, which waits for its email to be sent.
 */
export async function archiveLeadsAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const s = await scope();
  if (!s) return { error: 'Please sign in again.' };
  if (!hasServiceRole()) return { error: 'That is not available just now.' };
  const leadIds = ids(formData);
  if (leadIds.length === 0) return { error: 'Choose at least one lead.' };

  const now = new Date();
  const { data, error } = await createAdminClient()
    .from('leads')
    .update({
      archived_at: now.toISOString(),
      archive_reason: 'manual',
      purge_after: purgeAfter(now).toISOString(),
      archive_warned_at: null,
    })
    .eq('user_id', s.ownerId)
    .in('id', leadIds)
    .is('archived_at', null)
    .select('id');
  if (error) {
    console.error('[leads] archive failed:', error.message);
    return { error: 'We could not archive that just now. Please try again.' };
  }

  revalidatePath('/leads');
  for (const id of leadIds) revalidatePath(`/leads/${id}`);
  const n = (data ?? []).length;
  return {
    notice: `${n} lead${n === 1 ? '' : 's'} archived. ${n === 1 ? 'It' : 'They'} will be deleted permanently on ${retentionDate(purgeAfter(now))} unless restored.`,
  };
}

/** Brings archived leads back, with a fresh six months on the clock. */
export async function restoreLeadsAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const s = await scope();
  if (!s) return { error: 'Please sign in again.' };
  if (!hasServiceRole()) return { error: 'That is not available just now.' };
  const leadIds = ids(formData);
  if (leadIds.length === 0) return { error: 'Choose at least one lead.' };

  const { data, error } = await createAdminClient()
    .from('leads')
    .update({
      archived_at: null,
      archive_reason: null,
      archive_notified_at: null,
      archive_warned_at: null,
      purge_after: null,
      // Restoring is the clearest possible "I am using this" — without it a
      // lead archived for inactivity would be archived again the next night.
      last_activity_at: new Date().toISOString(),
    })
    .eq('user_id', s.ownerId)
    .in('id', leadIds)
    .not('archived_at', 'is', null)
    .select('id');
  if (error) {
    console.error('[leads] restore failed:', error.message);
    return { error: 'We could not restore that just now. Please try again.' };
  }

  revalidatePath('/leads');
  for (const id of leadIds) revalidatePath(`/leads/${id}`);
  const n = (data ?? []).length;
  return { notice: `${n} lead${n === 1 ? '' : 's'} restored.` };
}

export async function setLeadStageAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const s = await scope();
  if (!s) return { error: 'Please sign in again.' };
  if (!hasServiceRole()) return { error: 'That is not available just now.' };
  const [leadId] = ids(formData);
  const stage = parseStage(formData.get('stage'));
  if (!leadId || !stage) return { error: 'That did not work. Please try again.' };

  const { data, error } = await createAdminClient()
    .from('leads')
    .update({ stage, stage_changed_at: new Date().toISOString() })
    .eq('user_id', s.ownerId)
    .eq('id', leadId)
    .select('id');
  if (error || (data ?? []).length === 0) {
    if (error) console.error('[leads] stage failed:', error.message);
    return { error: 'That lead no longer exists.' };
  }

  await touchLeads(s.ownerId, [leadId]);
  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);
  return { notice: `Moved to ${STAGE_LABELS[stage]}.` };
}

/**
 * The customer opened a lead. Called from the page once it has rendered in a
 * browser — not during the server render, which a link prefetch can trigger
 * without anybody looking at anything.
 */
export async function markLeadOpenedAction(leadId: string): Promise<void> {
  if (!UUID.test(leadId)) return;
  const s = await scope();
  if (!s) return;
  await touchLeads(s.ownerId, [leadId]);
}
