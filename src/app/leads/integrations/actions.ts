'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ownerIdOrNull, leadScopeOrPaused } from '@/lib/leads/scope';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import {
  saveConnection, deleteConnection, testConnection, getConnection, resolveConnection,
} from '@/lib/crm/connections';
import { parseMondayConfig, type MondayFieldId } from '@/lib/crm/monday-map';
import { listMondayBoards, listMondayGroups, mondayProvider } from '@/lib/crm/providers/monday';
import { checkWebhookUrl } from '@/lib/crm/providers/webhook';
import { enqueueDelivery } from '@/lib/crm/deliver';
import { touchLeads } from '@/lib/leads/activity';
import type { CrmField } from '@/lib/crm/types';

/**
 * CRM connection management.
 *
 * Every action resolves the session itself and scopes by user id — the
 * `crm_connections` table has RLS on with no policy at all, so there is no
 * path from a browser to a row and nothing here may trust an id from a form
 * without checking who it belongs to.
 *
 * A credential never travels back to the browser. The forms post one in; the
 * pages read a shape that says only whether one is stored.
 */

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The signed-in OWNER. A team member gets null: funnels, integrations and API
 * keys belong to the account owner, and are refused to members here as well
 * as hidden from them in the UI.
 */
async function member(): Promise<{ id: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const ownerId = await ownerIdOrNull(user);
  return ownerId ? { id: ownerId } : null;
}

export interface CrmState {
  error?: string;
  saved?: boolean;
  /** A message worth showing on success — a test result, usually. */
  notice?: string;
  /** A freshly minted webhook secret. Shown once and never again. */
  secret?: string;
}

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

// ─── Monday ───────────────────────────────────────────────────────────

export async function saveMondayAction(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };

  const id = field(formData, 'id');
  const existing = id && UUID.test(id) ? await getConnection(who.id, id) : null;
  if (id && !existing) return { error: 'That connection no longer exists.' };

  const token = field(formData, 'token');
  if (!existing && token.length === 0) {
    return { error: 'Paste your Monday API token to connect.' };
  }

  // The stored config is the base, so saving the board on one screen cannot
  // wipe the column mapping done on another.
  const config = parseMondayConfig(existing?.config);
  const boardId = field(formData, 'boardId');
  if (boardId) config.boardId = boardId;
  const groupId = field(formData, 'groupId');
  config.groupId = groupId.length > 0 ? groupId : null;

  const yes = field(formData, 'labelYes');
  const no = field(formData, 'labelNo');
  if (yes) config.qualifiedLabels.yes = yes;
  if (no) config.qualifiedLabels.no = no;

  // Changing the board invalidates every mapped column: the ids belong to
  // the old board and would fail the whole push on the new one.
  if (boardId && existing && parseMondayConfig(existing.config).boardId !== boardId) {
    config.columns = {};
  }

  const result = await saveConnection({
    userId: who.id,
    id: existing?.id ?? null,
    provider: 'monday',
    config: config as unknown as Record<string, unknown>,
    credential: token.length > 0 ? token : null,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath('/leads/integrations');
  return { saved: true };
}

/**
 * Saves the field mapping. Each column arrives as `col_<field>` holding
 * `<columnId>|<type>` — the type is carried from the discovered board
 * because the value SHAPE Monday accepts depends on it, and guessing wrong
 * rejects the entire push rather than the one column.
 */
export async function saveMondayMappingAction(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };

  const id = field(formData, 'id');
  if (!UUID.test(id)) return { error: 'That connection no longer exists.' };
  const existing = await getConnection(who.id, id);
  if (!existing) return { error: 'That connection no longer exists.' };

  const config = parseMondayConfig(existing.config);
  const columns: Partial<Record<MondayFieldId, { id: string; type: string }>> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('col_')) continue;
    const fieldId = key.slice(4) as MondayFieldId;
    const raw = String(value).trim();
    if (raw.length === 0) continue;             // "Don't map this"
    const sep = raw.lastIndexOf('|');
    if (sep < 1) continue;
    columns[fieldId] = { id: raw.slice(0, sep), type: raw.slice(sep + 1) };
  }
  config.columns = columns;

  const result = await saveConnection({
    userId: who.id,
    id,
    provider: 'monday',
    config: config as unknown as Record<string, unknown>,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath('/leads/integrations');
  return { saved: true, notice: `Mapped ${Object.keys(columns).length} fields.` };
}

/** The customer's boards, so they choose one rather than pasting an id. */
export async function loadMondayBoards(connectionId: string): Promise<{ boards: Array<{ id: string; name: string }>; error?: string }> {
  const who = await member();
  if (!who) return { boards: [], error: 'Please sign in again.' };
  const conn = await resolveConnection(connectionId, who.id);
  if (!conn?.credential) return { boards: [], error: 'Add your Monday API token first.' };
  return listMondayBoards(conn.credential);
}

export async function loadMondayGroups(connectionId: string): Promise<{ groups: Array<{ id: string; title: string }>; error?: string }> {
  const who = await member();
  if (!who) return { groups: [], error: 'Please sign in again.' };
  const conn = await resolveConnection(connectionId, who.id);
  if (!conn?.credential) return { groups: [], error: 'Add your Monday API token first.' };
  const config = parseMondayConfig(conn.config);
  if (!config.boardId) return { groups: [], error: 'Choose a board first.' };
  return listMondayGroups(conn.credential, config.boardId);
}

/** The board's real columns, which is the only way a mapping can be correct. */
export async function loadMondayFields(connectionId: string): Promise<{ fields: CrmField[]; error?: string }> {
  const who = await member();
  if (!who) return { fields: [], error: 'Please sign in again.' };
  const conn = await resolveConnection(connectionId, who.id);
  if (!conn) return { fields: [], error: 'That connection no longer exists.' };
  return mondayProvider.discoverFields!(conn);
}

// ─── Webhook ──────────────────────────────────────────────────────────

export async function saveWebhookAction(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };

  const url = field(formData, 'url');
  const check = checkWebhookUrl(url);
  if (!check.ok) return { error: check.reason };

  const id = field(formData, 'id');
  const existing = id && UUID.test(id) ? await getConnection(who.id, id) : null;
  if (id && !existing) return { error: 'That connection no longer exists.' };

  const result = await saveConnection({
    userId: who.id,
    id: existing?.id ?? null,
    provider: 'webhook',
    config: { url },
    rotateSecret: formData.get('rotate') === '1',
  });
  if (!result.ok) return { error: result.error };

  revalidatePath('/leads/integrations');
  return {
    saved: true,
    secret: result.secret,
    notice: result.secret ? 'Copy your signing secret now — it is not shown again.' : undefined,
  };
}

// ─── Shared ───────────────────────────────────────────────────────────

/**
 * Round-trips to the provider. For a webhook this posts a real, signed
 * request with a payload shaped like a lead, so a customer can build their
 * whole workflow against it before a prospect ever fills in the form.
 */
export async function testConnectionAction(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = field(formData, 'id');
  if (!UUID.test(id)) return { error: 'That connection no longer exists.' };

  const result = await testConnection(who.id, id);
  revalidatePath('/leads/integrations');
  if (!result.ok) return { error: result.error ?? 'That did not work.' };
  return { saved: true, notice: 'Connected. Leads will be delivered here.' };
}

export async function deleteConnectionAction(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = field(formData, 'id');
  if (!UUID.test(id)) return { error: 'That connection no longer exists.' };

  const ok = await deleteConnection(who.id, id);
  revalidatePath('/leads/integrations');
  return ok ? { saved: true, notice: 'Disconnected. Your leads are untouched.' } : { error: 'Could not disconnect that.' };
}

/**
 * Sends a held lead on by hand. This is the promise behind the 'hold'
 * policy: a lead that missed the filter is still theirs to promote later.
 */
export async function pushLeadAction(_prev: CrmState, formData: FormData): Promise<CrmState> {
  // Team members may push too — working the leads is their job — so this
  // one resolves the team's owner rather than requiring the owner.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in again.' };
  const scope = await leadScopeOrPaused(user);
  if (scope === 'paused') return { error: 'Your team access is paused.' };
  const leadId = field(formData, 'leadId');
  if (!UUID.test(leadId)) return { error: 'That lead no longer exists.' };

  // Ownership is checked against the team owner explicitly: a lead id from
  // another account matches no row and reads as missing.
  if (!hasServiceRole()) return { error: 'That is not available just now.' };
  const { data } = await createAdminClient()
    .from('leads')
    .select('id, archived_at')
    .eq('user_id', scope.ownerId)
    .eq('id', leadId)
    .maybeSingle();
  if (!data) return { error: 'That lead no longer exists.' };
  if ((data as { archived_at: string | null }).archived_at) return { error: 'Restore this lead before sending it.' };

  await touchLeads(scope.ownerId, [leadId]);

  const outcome = await enqueueDelivery({ leadId, immediate: true });
  revalidatePath('/leads');
  if (!outcome.queued) return { error: 'Connect a CRM first, under Integrations.' };
  if (outcome.delivered && !outcome.delivered.ok) {
    // Still queued, so it will retry; the customer should know why it did
    // not go straight away rather than being told it worked.
    return { error: `${outcome.delivered.error ?? 'That did not work.'} We will keep trying.` };
  }
  return { saved: true, notice: 'Sent to your CRM.' };
}
