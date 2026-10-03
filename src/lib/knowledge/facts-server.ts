import 'server-only';

/**
 * Batch 24: what Stayful Intelligence remembers about a member, only after
 * they said yes to "Want me to remember that?".
 *
 *   rememberFact(...)          save one confirmed fact (the call agent's
 *                              remember_fact tool; Batch 26's chat)
 *   rememberedFactsFor(userId) the member's own facts, newest first
 *   deleteFact / deleteAllFacts  for good, the member's own only
 *
 * Every read and delete is filtered by the member's own id: a team owner
 * never sees a member's facts, nor one member another's. The table is
 * service role only; nothing here reads a request's input as a user id.
 */
import { createAdminClient } from '../supabase/admin';
import { recordActivity } from '../activity/log';
import type { FactChannel } from './config';
import { checkFact, type FactRefusal } from './facts-rules';
import { isSchemaMissing, readKnowledgeSettings, type Admin } from './store-server';

export interface RememberedFact {
  id: string;
  fact: string;
  channel: FactChannel;
  confirmedAt: string;
}

export type RememberResult = { ok: true; id: string } | { ok: false; reason: FactRefusal | 'duplicate' | 'cap' | 'error'; detail?: string };

export interface RememberInput {
  userId: string;
  fact: string;
  /** The question the member said yes to. */
  asked: string | null;
  /** Must be true: the member said yes. */
  confirmed: boolean;
  channel: FactChannel;
  confirmedVia: 'call_yes' | 'chat_yes' | 'app';
  conversationId?: string | null;
}

export async function rememberFact(i: RememberInput, admin: Admin = createAdminClient()): Promise<RememberResult> {
  const c = checkFact({ fact: i.fact, asked: i.asked, confirmed: i.confirmed });
  if (!c.ok) return { ok: false, reason: c.reason, detail: c.detail };
  const settings = await readKnowledgeSettings(admin);
  const { data, error } = await admin.rpc('si_fact_remember', {
    p: { user_id: i.userId, fact: c.fact, asked: c.asked, channel: i.channel, confirmed_via: i.confirmedVia, conversation_id: i.conversationId ?? null, max: settings.factsMax },
  });
  if (error) {
    if (!isSchemaMissing(error)) console.error('[knowledge] remember failed:', error.message);
    return { ok: false, reason: 'error' };
  }
  const r = data as { id?: string; refused?: string };
  if (!r.id) return { ok: false, reason: r.refused === 'duplicate' ? 'duplicate' : r.refused === 'cap' ? 'cap' : 'error' };
  await recordActivity(i.userId, 'si_fact_confirmed', { extras: { channel: i.channel }, source: i.channel === 'call' ? 'system' : 'web' });
  return { ok: true, id: r.id };
}

/** The member's own facts, newest first. Empty (not an error) when the schema has not been run. */
export async function rememberedFactsFor(userId: string, admin: Admin = createAdminClient()): Promise<RememberedFact[]> {
  const { data, error } = await admin.from('si_member_facts').select('id, fact, channel, confirmed_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (!isSchemaMissing(error)) console.error('[knowledge] facts read failed:', error.message);
    return [];
  }
  return ((data ?? []) as { id: string; fact: string; channel: FactChannel; confirmed_at: string }[]).map((r) => ({ id: r.id, fact: r.fact, channel: r.channel, confirmedAt: r.confirmed_at }));
}

/** Delete one of the member's own facts, for good. False when there was no such fact of theirs. */
export async function deleteFact(userId: string, factId: string, admin: Admin = createAdminClient()): Promise<boolean> {
  const { data, error } = await admin.from('si_member_facts').delete().eq('id', factId).eq('user_id', userId).select('id');
  if (error) {
    console.error('[knowledge] fact delete failed:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/** Delete every fact the member has, for good. The number deleted. */
export async function deleteAllFacts(userId: string, admin: Admin = createAdminClient()): Promise<number> {
  const { data, error } = await admin.from('si_member_facts').delete().eq('user_id', userId).select('id');
  if (error) {
    console.error('[knowledge] facts delete failed:', error.message);
    return 0;
  }
  return (data ?? []).length;
}
