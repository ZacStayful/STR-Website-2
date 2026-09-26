import 'server-only';

/**
 * Reads and writes for the SMS tables (supabase/schema.sql, "Batch 8: sms").
 * Service role only: every caller has already checked the session, the
 * cron secret or Twilio's signature.
 *
 * Reads that fail return "nothing" in the direction that sends nothing: an
 * unreadable contact is not verified, an unreadable history is treated as
 * the limit already reached. Never text on a guess.
 */
import type { createAdminClient } from '../supabase/admin';

export type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;

export interface SmsContact {
  user_id: string;
  phone_e164: string | null;
  verified_at: string | null;
  enabled: boolean;
  consent_at: string | null;
  consent_source: string | null;
  stopped_at: string | null;
  stop_source: string | null;
}

const CONTACT_COLUMNS = 'user_id, phone_e164, verified_at, enabled, consent_at, consent_source, stopped_at, stop_source';

/** Whether texts may go to this contact at all (the per-type switches are separate). */
export function contactCanReceive(c: Pick<SmsContact, 'phone_e164' | 'verified_at' | 'enabled' | 'stopped_at'> | null | undefined): boolean {
  return Boolean(c && c.phone_e164 && c.verified_at && c.enabled && !c.stopped_at);
}

export async function getContact(admin: Admin, userId: string): Promise<SmsContact | null> {
  const { data, error } = await admin.from('sms_contacts').select(CONTACT_COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) console.warn('[sms] contact read failed (schema behind?):', error.message);
  return (data as SmsContact | null) ?? null;
}

/** Every contact that can receive texts now: verified, on, not stopped. */
export async function receivingContacts(admin: Admin, onlyUserIds?: readonly string[]): Promise<SmsContact[] | null> {
  const out: SmsContact[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = admin.from('sms_contacts').select(CONTACT_COLUMNS).eq('enabled', true).not('verified_at', 'is', null).is('stopped_at', null);
    if (onlyUserIds) q = q.in('user_id', [...onlyUserIds]);
    const { data, error } = await q.order('user_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.warn('[sms] contacts read failed (schema behind?):', error.message);
      return null;
    }
    out.push(...((data ?? []) as SmsContact[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out.filter(contactCanReceive);
}

/** The account (if any) that has this number verified, other than `exceptUserId`. */
export async function verifiedElsewhere(admin: Admin, phone: string, exceptUserId: string): Promise<boolean | null> {
  const { data, error } = await admin.from('sms_contacts').select('user_id').eq('phone_e164', phone).not('verified_at', 'is', null).neq('user_id', exceptUserId).limit(1);
  if (error) {
    console.warn('[sms] number check failed:', error.message);
    return null;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * The number is proved: it becomes the member's texting number, texts are on,
 * and any earlier STOP on it is cleared — verifying is a fresh yes, and the
 * code could only arrive because Twilio no longer blocks the number.
 */
export async function saveVerifiedNumber(admin: Admin, userId: string, phone: string, consentSource: 'signup' | 'account', now: Date = new Date()): Promise<'ok' | 'taken' | 'error'> {
  const at = now.toISOString();
  const existing = await getContact(admin, userId);
  const row = {
    user_id: userId,
    phone_e164: phone,
    verified_at: at,
    enabled: true,
    consent_at: existing?.consent_at && existing.phone_e164 === phone ? existing.consent_at : at,
    consent_source: consentSource,
    stopped_at: null,
    stop_source: null,
    updated_at: at,
  };
  const { error } = await admin.from('sms_contacts').upsert(row, { onConflict: 'user_id' });
  if (error) {
    // The unique index on verified numbers: someone else verified it first.
    if (error.code === '23505') return 'taken';
    console.error('[sms] save verified number failed:', error.message);
    return 'error';
  }
  return 'ok';
}

export async function setContactEnabled(admin: Admin, userId: string, on: boolean): Promise<boolean> {
  const { data, error } = await admin.from('sms_contacts').update({ enabled: on, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id');
  if (error) console.error('[sms] enable write failed:', error.message);
  return !error && (data?.length ?? 0) === 1;
}

/** STOP: every account with this number stops receiving, at once. Returns how many rows changed. */
export async function stopNumber(admin: Admin, phone: string, source: 'keyword' | 'twilio' | 'admin', now: Date = new Date()): Promise<number | null> {
  const { data, error } = await admin
    .from('sms_contacts')
    .update({ stopped_at: now.toISOString(), stop_source: source, updated_at: now.toISOString() })
    .eq('phone_e164', phone)
    .is('stopped_at', null)
    .select('user_id');
  if (error) {
    console.error('[sms] stop write failed:', error.message);
    return null;
  }
  return data?.length ?? 0;
}

/** START: texts may go to this number again (each account's own switches still apply). */
export async function startNumber(admin: Admin, phone: string, now: Date = new Date()): Promise<number | null> {
  const { data, error } = await admin
    .from('sms_contacts')
    .update({ stopped_at: null, stop_source: null, updated_at: now.toISOString() })
    .eq('phone_e164', phone)
    .not('stopped_at', 'is', null)
    .select('user_id');
  if (error) {
    console.error('[sms] start write failed:', error.message);
    return null;
  }
  return data?.length ?? 0;
}

// ── sms_messages ──

export type Outcome = 'pending' | 'accepted' | 'refused' | 'unknown' | 'dry_run' | 'received';

export interface MessageInsert {
  user_id: string | null;
  direction: 'outbound' | 'inbound';
  kind: 'verify' | 'alert' | 'keyword';
  phone_e164: string;
  body: string | null;
  alert_ids?: string[];
  send_id?: string | null;
  dry_run?: boolean;
  outcome?: Outcome;
  twilio_sid?: string | null;
  status?: string | null;
}

export async function insertMessage(admin: Admin, row: MessageInsert): Promise<string | null> {
  const { data, error } = await admin.from('sms_messages').insert(row).select('id').single();
  if (error) {
    // A repeat inbound delivery (same MessageSid) is not an error worth a log line.
    if (error.code !== '23505') console.error('[sms] message insert failed:', error.message);
    return null;
  }
  return String((data as { id: string }).id);
}

export async function updateMessage(admin: Admin, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin.from('sms_messages').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error('[sms] message update failed:', error.message);
  return !error;
}

export interface MessageRow {
  id: string;
  user_id: string | null;
  phone_e164: string;
  kind: string;
  outcome: Outcome;
  twilio_sid: string | null;
  status: string | null;
}

export async function messageById(admin: Admin, id: string): Promise<MessageRow | null> {
  const { data, error } = await admin.from('sms_messages').select('id, user_id, phone_e164, kind, outcome, twilio_sid, status').eq('id', id).maybeSingle();
  if (error) console.warn('[sms] message read failed:', error.message);
  return (data as MessageRow | null) ?? null;
}

/**
 * Code texts in the last day, by this member and to this number (any
 * account): the resend limits count both. Null when unreadable, which the
 * caller treats as "limit reached".
 */
export async function recentCodeSends(admin: Admin, userId: string, phone: string, now: Date = new Date()): Promise<{ user: string[]; number: string[] } | null> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [mine, theirs] = await Promise.all([
    admin.from('sms_messages').select('created_at').eq('user_id', userId).eq('kind', 'verify').gte('created_at', since),
    admin.from('sms_messages').select('created_at').eq('phone_e164', phone).eq('kind', 'verify').gte('created_at', since),
  ]);
  if (mine.error || theirs.error) {
    console.warn('[sms] code history read failed:', (mine.error ?? theirs.error)?.message);
    return null;
  }
  const at = (rows: unknown) => ((rows ?? []) as { created_at: string }[]).map((r) => r.created_at);
  return { user: at(mine.data), number: at(theirs.data) };
}

/**
 * Every alert already texted to these members (accepted, or possibly sent),
 * within `sinceMs`: an alert is never texted twice. Null when unreadable,
 * which the caller treats as "send nothing".
 */
export async function textedAlertIds(admin: Admin, userIds: readonly string[], sinceMs: number, now: Date = new Date()): Promise<Map<string, Set<string>> | null> {
  const out = new Map<string, Set<string>>();
  const since = new Date(now.getTime() - sinceMs).toISOString();
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from('sms_messages')
      .select('user_id, alert_ids')
      .in('user_id', userIds.slice(i, i + ID_CHUNK))
      .eq('kind', 'alert')
      .in('outcome', ['pending', 'accepted', 'unknown'])
      .gte('created_at', since);
    if (error) {
      console.warn('[sms] texted alerts read failed (schema behind?):', error.message);
      return null;
    }
    for (const r of (data ?? []) as { user_id: string; alert_ids: string[] | null }[]) {
      const set = out.get(r.user_id) ?? new Set<string>();
      for (const id of r.alert_ids ?? []) set.add(id);
      out.set(r.user_id, set);
    }
  }
  return out;
}

/** Outbound texts Twilio took that have no price yet, oldest first, at least an hour old. */
export async function unpricedMessages(admin: Admin, limit: number, now: Date = new Date()): Promise<{ id: string; twilio_sid: string }[]> {
  const before = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('sms_messages')
    .select('id, twilio_sid')
    .eq('direction', 'outbound')
    .not('twilio_sid', 'is', null)
    .is('price', null)
    .lt('created_at', before)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    console.warn('[sms] unpriced read failed:', error.message);
    return [];
  }
  return (data ?? []) as { id: string; twilio_sid: string }[];
}

/** The most texts a member may get in a UK calendar month (billing_settings.sms_monthly_cap; 8 unless changed). */
export const DEFAULT_MONTHLY_CAP = 8;

export async function smsMonthlyCap(admin: Admin): Promise<number> {
  const { data, error } = await admin.from('billing_settings').select('value').eq('key', 'sms_monthly_cap').maybeSingle();
  if (error) console.warn('[sms] monthly cap read failed, using the default:', error.message);
  const n = Number((data as { value: unknown } | null)?.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MONTHLY_CAP;
}
