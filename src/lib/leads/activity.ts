import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { isFunnelToken } from '../funnels';

/**
 * Recording that a lead is still in use, which resets its retention clock
 * (retention.ts).
 *
 * What counts: the customer opening it or its PDF, changing its stage, a
 * single-lead API or MCP read, pushing it to the CRM, and the prospect
 * reopening their own report. What deliberately does NOT: listing, counting
 * or exporting leads. An integration that polls the list every few minutes
 * would otherwise keep every lead alive forever and nothing would ever be
 * cleaned up.
 *
 * An archived lead is left alone — reading it is not a decision to keep it.
 * Only Restore brings one back.
 *
 * Never throws: this is bookkeeping on the side of something the person
 * actually asked for, and must not break it.
 */

const UUID = /^[0-9a-f-]{36}$/i;

function touchPatch() {
  // Clearing the warning means a lead that was about to be archived, and
  // then used, gets a fresh warning next time rather than being archived on
  // the strength of an old one.
  return { last_activity_at: new Date().toISOString(), archive_warned_at: null };
}

/** Marks leads as used. `ownerId` scopes the write; ids outside it are ignored. */
export async function touchLeads(ownerId: string, leadIds: readonly string[]): Promise<void> {
  const ids = leadIds.filter((id) => UUID.test(id));
  if (ids.length === 0 || !hasServiceRole()) return;
  try {
    const { error } = await createAdminClient()
      .from('leads')
      .update(touchPatch())
      .eq('user_id', ownerId)
      .in('id', ids)
      .is('archived_at', null);
    if (error) console.error('[leads] touch failed:', error.message);
  } catch (err) {
    console.error('[leads] touch failed:', (err as Error).message);
  }
}

/** The same, for the prospect's own report link, which knows only its token. */
export async function touchLeadByReportToken(token: string): Promise<void> {
  if (!isFunnelToken(token) || !hasServiceRole()) return;
  try {
    const { error } = await createAdminClient()
      .from('leads')
      .update(touchPatch())
      .eq('report_token', token)
      .is('archived_at', null);
    if (error) console.error('[leads] touch by token failed:', error.message);
  } catch (err) {
    console.error('[leads] touch by token failed:', (err as Error).message);
  }
}

/** For internal callers that already hold a verified lead id (CRM delivery). */
export async function touchLeadById(leadId: string): Promise<void> {
  if (!UUID.test(leadId) || !hasServiceRole()) return;
  try {
    const { error } = await createAdminClient()
      .from('leads')
      .update(touchPatch())
      .eq('id', leadId)
      .is('archived_at', null);
    if (error) console.error('[leads] touch by id failed:', error.message);
  } catch (err) {
    console.error('[leads] touch by id failed:', (err as Error).message);
  }
}
