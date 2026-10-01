import 'server-only';

/**
 * Batch 23: reads and writes for si_calls_log and its guard tables
 * (supabase/schema.sql, "Batch 23: Stayful Intelligence calls"). Service
 * role only: every caller has already checked a secret, a signature or the
 * session.
 *
 * Reads that fail answer in the direction that places nothing: an
 * unreadable count is "already called today".
 */
import { createAdminClient } from '../supabase/admin';
import { ukDay } from './hours';
import type { BlockedReason, CallStatus, CallType } from './config';

export type Admin = ReturnType<typeof createAdminClient>;

export interface CallRow {
  id: string;
  user_id: string | null;
  direction: 'outbound' | 'inbound';
  call_type: CallType;
  status: CallStatus;
  blocked_reason: string | null;
  trigger_ref: string | null;
  context: string | null;
  uk_day: string | null;
  not_before: string | null;
  queued_at: string;
  placed_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  seconds: number | null;
  charged_pence: number;
  texts_sent: number;
  fallback_sent_at: string | null;
  handoff: boolean;
  el_conversation_id: string | null;
  twilio_call_sid: string | null;
  conversation_id: string | null;
  persona_version: string | null;
  error: string | null;
}

export const CALL_COLUMNS =
  'id, user_id, direction, call_type, status, blocked_reason, trigger_ref, context, uk_day, not_before, queued_at, placed_at, started_at, ended_at, seconds, charged_pence, texts_sent, fallback_sent_at, handoff, el_conversation_id, twilio_call_sid, conversation_id, persona_version, error';

/** Whether an error means the Batch 23 section of schema.sql has not been run. */
export function isSchemaMissing(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const m = err.message ?? '';
  return /si_calls_log|si_conversations|si_call_charges|si_webhook_events|si_tool_calls/.test(m) && /does not exist|schema cache|not find/i.test(m);
}

export async function callById(admin: Admin, id: string): Promise<CallRow | null> {
  const { data, error } = await admin.from('si_calls_log').select(CALL_COLUMNS).eq('id', id).maybeSingle();
  if (error) console.error('[voice] call read failed:', error.message);
  return (data as CallRow | null) ?? null;
}

export async function callByConversation(admin: Admin, conversationId: string | null, callSid: string | null): Promise<CallRow | null> {
  if (conversationId) {
    const { data, error } = await admin.from('si_calls_log').select(CALL_COLUMNS).eq('el_conversation_id', conversationId).maybeSingle();
    if (error) console.error('[voice] call read failed:', error.message);
    if (data) return data as CallRow;
  }
  if (callSid) {
    const { data, error } = await admin.from('si_calls_log').select(CALL_COLUMNS).eq('twilio_call_sid', callSid).maybeSingle();
    if (error) console.error('[voice] call read failed:', error.message);
    if (data) return data as CallRow;
  }
  return null;
}

export async function updateCall(admin: Admin, id: string, patch: Record<string, unknown>, onlyStatus?: readonly CallStatus[]): Promise<CallRow | null> {
  let q = admin.from('si_calls_log').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (onlyStatus) q = q.in('status', [...onlyStatus]);
  const { data, error } = await q.select(CALL_COLUMNS);
  if (error) {
    console.error('[voice] call update failed:', error.message);
    return null;
  }
  return ((data ?? [])[0] as CallRow | undefined) ?? null;
}

export interface NewCall {
  user_id: string | null;
  direction: 'outbound' | 'inbound';
  call_type: CallType;
  status: CallStatus;
  blocked_reason?: BlockedReason | null;
  trigger_ref?: string | null;
  context?: string | null;
  not_before?: string | null;
  persona_version?: string | null;
  el_conversation_id?: string | null;
  twilio_call_sid?: string | null;
  caller_hash?: string | null;
  started_at?: string | null;
  placed_at?: string | null;
}

/** Inserts a call; 'duplicate' when a unique index (a safety rule) refused it. */
export async function insertCall(admin: Admin, row: NewCall): Promise<{ ok: true; call: CallRow } | { ok: false; reason: 'duplicate' | 'error'; message?: string }> {
  const { data, error } = await admin.from('si_calls_log').insert(row).select(CALL_COLUMNS).single();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'duplicate', message: error.message };
    console.error('[voice] call insert failed:', error.message);
    return { ok: false, reason: 'error', message: error.message };
  }
  return { ok: true, call: data as CallRow };
}

export interface DayFacts {
  /** Outbound calls placed today (UK day), this one excluded. */
  placedToday: number;
  /** Another outbound call queued or ringing. */
  otherInFlight: boolean;
  /** The intro call was placed today. */
  introToday: boolean;
}

/** The member's calls today and in flight. Unreadable → as if the day's call were used. */
export async function dayFacts(admin: Admin, userId: string, now: Date, exceptId: string | null = null): Promise<DayFacts> {
  const today = ukDay(now);
  const [placed, flight] = await Promise.all([
    admin.from('si_calls_log').select('id, call_type').eq('user_id', userId).eq('direction', 'outbound').eq('uk_day', today),
    admin.from('si_calls_log').select('id').eq('user_id', userId).eq('direction', 'outbound').in('status', ['queued', 'ringing']),
  ]);
  if (placed.error || flight.error) {
    console.error('[voice] day facts unreadable:', placed.error?.message ?? flight.error?.message);
    return { placedToday: 99, otherInFlight: true, introToday: true };
  }
  const placedRows = ((placed.data ?? []) as { id: string; call_type: string }[]).filter((r) => r.id !== exceptId);
  return {
    placedToday: placedRows.length,
    otherInFlight: ((flight.data ?? []) as { id: string }[]).some((r) => r.id !== exceptId),
    introToday: placedRows.some((r) => r.call_type === 'intro'),
  };
}

/** The member's most recent outbound call in the last `withinMs` (what a callback picks up from). */
export async function lastOutbound(admin: Admin, userId: string, withinMs: number, now: Date = new Date()): Promise<CallRow | null> {
  const { data, error } = await admin
    .from('si_calls_log')
    .select(CALL_COLUMNS)
    .eq('user_id', userId)
    .eq('direction', 'outbound')
    .not('placed_at', 'is', null)
    .gte('placed_at', new Date(now.getTime() - withinMs).toISOString())
    .order('placed_at', { ascending: false })
    .limit(1);
  if (error) console.error('[voice] last call read failed:', error.message);
  return ((data ?? [])[0] as CallRow | undefined) ?? null;
}

/** Whether the contact card was ever texted to this member by a call. */
export async function contactCardSent(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('si_call_charges').select('id').eq('user_id', userId).eq('kind', 'text').like('charge_key', '%:text:contact_card').limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/** The last link-template text a call sent this member (for "resend the last link"). */
export async function lastTemplateSent(admin: Admin, userId: string): Promise<'contact_card' | 'auto_topup_link' | null> {
  const { data, error } = await admin
    .from('si_call_charges')
    .select('charge_key')
    .eq('user_id', userId)
    .eq('kind', 'text')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return null;
  for (const r of (data ?? []) as { charge_key: string }[]) {
    if (r.charge_key.endsWith(':auto_topup_link')) return 'auto_topup_link';
    if (r.charge_key.endsWith(':contact_card')) return 'contact_card';
  }
  return null;
}

/** Claim a webhook event once: 'new' the first time, 'done' when already processed, 'busy' while another delivery has it. */
export async function claimEvent(admin: Admin, provider: string, key: string): Promise<'new' | 'done' | 'busy' | 'retry' | 'unavailable'> {
  const { error } = await admin.from('si_webhook_events').insert({ provider, event_key: key });
  if (!error) return 'new';
  if (error.code !== '23505') {
    console.error('[voice] event claim failed:', error.message);
    return 'unavailable';
  }
  const { data } = await admin.from('si_webhook_events').select('processed_at, error, received_at').eq('provider', provider).eq('event_key', key).maybeSingle();
  const row = data as { processed_at: string | null; error: string | null; received_at: string } | null;
  if (row?.processed_at) return 'done';
  // A claim younger than two minutes with no error: another delivery is working on it.
  if (row && !row.error && Date.now() - Date.parse(row.received_at) < 2 * 60_000) return 'busy';
  await admin.from('si_webhook_events').update({ received_at: new Date().toISOString(), error: null }).eq('provider', provider).eq('event_key', key);
  return 'retry';
}

export async function finishEvent(admin: Admin, provider: string, key: string, error: string | null): Promise<void> {
  const patch = error ? { error: error.slice(0, 500) } : { processed_at: new Date().toISOString(), error: null };
  const { error: e } = await admin.from('si_webhook_events').update(patch).eq('provider', provider).eq('event_key', key);
  if (e) console.error('[voice] event finish failed:', e.message);
}

export async function logTool(admin: Admin, callId: string | null, tool: string, ok: boolean, detail: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('si_tool_calls').insert({ call_id: callId, tool, ok, detail });
  if (error) console.error('[voice] tool log failed:', error.message);
}

export async function toolCount(admin: Admin, callId: string, tool: string): Promise<number> {
  const { count, error } = await admin.from('si_tool_calls').select('id', { count: 'exact', head: true }).eq('call_id', callId).eq('tool', tool).eq('ok', true);
  if (error) return Number.MAX_SAFE_INTEGER;
  return count ?? 0;
}
