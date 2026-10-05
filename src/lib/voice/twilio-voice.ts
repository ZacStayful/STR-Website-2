import 'server-only';

/**
 * Batch 23: the Twilio voice calls the code makes itself — hang up a call
 * that reached voicemail, read a call's final state when no webhook came, and
 * (for the Sync's Dry run) read where the number's incoming calls are sent.
 * ElevenLabs places and answers the calls; these reuse Batch 8's Twilio
 * credentials (src/lib/sms/config.ts).
 */
import { twilioConfig } from '../sms/config';
import { TWILIO_API_BASE, basicAuth } from '../sms/twilio';

const TIMEOUT_MS = 8_000;

function callUrl(accountSid: string, callSid: string): string {
  return `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`;
}

/** End a call now (Status=completed). Nothing is said or left. */
export async function hangUp(callSid: string): Promise<boolean> {
  const config = twilioConfig();
  if (!config || !/^CA[0-9a-f]{32}$/i.test(callSid)) return false;
  try {
    const res = await fetch(callUrl(config.accountSid, callSid), {
      method: 'POST',
      headers: { authorization: basicAuth(config.accountSid, config.authToken), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ Status: 'completed' }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error('[voice] hang-up refused:', res.status);
    return res.ok;
  } catch (err) {
    console.error('[voice] hang-up failed:', err);
    return false;
  }
}

export interface TwilioCall {
  status: string;
  durationSecs: number;
  answeredBy: string | null;
}

/** A call's state from Twilio, or null when it can't be read. */
export async function fetchCall(callSid: string): Promise<TwilioCall | null> {
  const config = twilioConfig();
  if (!config || !/^CA[0-9a-f]{32}$/i.test(callSid)) return null;
  try {
    const res = await fetch(callUrl(config.accountSid, callSid), { headers: { authorization: basicAuth(config.accountSid, config.authToken) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const j = (await res.json()) as { status?: string; duration?: string | number | null; answered_by?: string | null };
    return { status: String(j.status ?? 'unknown'), durationSecs: Math.max(0, Number(j.duration) || 0), answeredBy: j.answered_by ?? null };
  } catch {
    return null;
  }
}

/** Twilio's final statuses, as ours. */
export function statusFromTwilio(c: TwilioCall): 'answered' | 'missed' | 'voicemail' | 'failed' | null {
  if (c.answeredBy && /^(machine|fax)/i.test(c.answeredBy)) return 'voicemail';
  if (c.status === 'completed') return c.durationSecs > 0 ? 'answered' : 'missed';
  if (c.status === 'busy' || c.status === 'no-answer' || c.status === 'canceled') return 'missed';
  if (c.status === 'failed') return 'failed';
  return null; // still queued, ringing or in progress
}

/** A read-only Twilio GET for the Dry run's phone check: the JSON, or why it couldn't be read. */
async function twilioGet(path: string): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  const config = twilioConfig();
  if (!config) return { ok: false, reason: 'Twilio is not configured here' };
  try {
    const res = await fetch(`${TWILIO_API_BASE}/Accounts/${encodeURIComponent(config.accountSid)}${path}`, { headers: { authorization: basicAuth(config.accountSid, config.authToken) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, reason: String((err as Error)?.message ?? err).slice(0, 80) };
  }
}

/** Where Twilio sends a number's incoming calls (its Voice URL; null when none), or why it couldn't be read. */
export async function numberVoiceUrl(phoneNumber: string): Promise<{ ok: true; voiceUrl: string | null } | { ok: false; reason: string }> {
  const r = await twilioGet(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`);
  if (!r.ok) return r;
  const n = (r.json as { incoming_phone_numbers?: { voice_url?: string | null }[] }).incoming_phone_numbers?.[0];
  return n ? { ok: true, voiceUrl: n.voice_url || null } : { ok: false, reason: 'not in this Twilio account' };
}

/** Twilio's last calls to a number (Calls.json, newest first), or why they couldn't be read. */
export async function recentCallsTo(phoneNumber: string, limit = 3): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  return twilioGet(`/Calls.json?To=${encodeURIComponent(phoneNumber)}&PageSize=${limit}`);
}

/** Twilio's last errors and warnings on the account (Notifications.json, newest first), or why they couldn't be read. */
export async function recentTwilioAlerts(limit = 3): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  return twilioGet(`/Notifications.json?PageSize=${limit}`);
}
