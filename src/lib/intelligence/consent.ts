import 'server-only';

/**
 * Batch 22, Part C: "Calls from Stayful Intelligence". One place for the call
 * choice, which the calls batch reads:
 *   - the switch: profiles.si_calls (+ si_calls_changed_at)
 *   - its history: si_call_consents, every change with the wording version
 *   - the number: sms_contacts (a verified mobile is needed to switch it on)
 * Off by default; switched on only by the member ticking the box.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getContact } from '../sms/store';
import { logActivity } from '../activity/log';
import { CALL_CONSENT_VERSION } from './config';

export type SiCallsResult = { ok: true; on: boolean } | { ok: false; reason: 'no_number' | 'failed' };

/** Is a verified, not-stopped mobile on file? (Calls need one.) */
export async function hasVerifiedMobile(userId: string): Promise<{ verified: boolean; phone: string | null }> {
  if (!hasServiceRole()) return { verified: false, phone: null };
  const c = await getContact(createAdminClient(), userId).catch(() => null);
  return { verified: Boolean(c?.verified_at && !c.stopped_at), phone: c?.phone_e164 ?? null };
}

export async function siCallsOn(userId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient().from('profiles').select('si_calls').eq('id', userId).maybeSingle();
  if (error) return false;
  return (data as { si_calls?: boolean } | null)?.si_calls === true;
}

/** Switches calls on or off, records the consent with its wording version, and logs the setting. */
export async function setSiCalls(userId: string, on: boolean, source: 'welcome' | 'settings', now: Date = new Date()): Promise<SiCallsResult> {
  if (!hasServiceRole()) return { ok: false, reason: 'failed' };
  if (on && !(await hasVerifiedMobile(userId)).verified) return { ok: false, reason: 'no_number' };
  const admin = createAdminClient();
  const { error } = await admin.from('profiles').update({ si_calls: on, si_calls_changed_at: now.toISOString() }).eq('id', userId);
  if (error) {
    console.error('[si-calls] switch failed (schema behind?):', error.message);
    return { ok: false, reason: 'failed' };
  }
  const { error: recErr } = await admin.from('si_call_consents').insert({ user_id: userId, choice: on ? 'on' : 'off', source, version: CALL_CONSENT_VERSION, created_at: now.toISOString() });
  if (recErr) console.error('[si-calls] consent record failed:', recErr.message);
  logActivity(userId, 'notification_settings', { extras: { key: 'si_calls', on, source } });
  return { ok: true, on };
}
