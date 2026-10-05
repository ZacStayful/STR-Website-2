/**
 * The Dry run's phone check: what happened to the last calls to the
 * Stayful Intelligence number, from both ends (Twilio and ElevenLabs), so
 * a refused call can be traced without either dashboard. Read only. No
 * caller's number is shown, only its last 3 digits.
 *
 * Pure: sync-server.ts fetches, these read and word.
 */

/** +447700 900123 / 07700-900123 style input to +447700900123; null when it isn't a number. */
export function normaliseE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[\s\-().]/g, '');
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

const UK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? UK.format(d) : '?');
const last3 = (n: unknown) => (typeof n === 'string' && n.replace(/\D/g, '').length >= 3 ? `…${n.replace(/\D/g, '').slice(-3)}` : 'withheld');

/** Twilio's Calls.json (newest first): when, status, length, who rang. */
export function twilioCallLines(json: unknown, limit = 3): string[] {
  const calls = json && typeof json === 'object' && Array.isArray((json as { calls?: unknown }).calls) ? ((json as { calls: Record<string, unknown>[] }).calls) : [];
  return calls.slice(0, limit).map((c) => {
    const at = typeof c.start_time === 'string' ? new Date(c.start_time) : typeof c.date_created === 'string' ? new Date(c.date_created) : null;
    return `${when(at)} ${String(c.status ?? '?')} ${Math.max(0, Number(c.duration) || 0)}s from ${last3(c.from)}`;
  });
}

/** ElevenLabs' conversations list (newest first): when, status, why it ended. */
export function conversationLines(json: unknown, limit = 3): string[] {
  const list = json && typeof json === 'object' && Array.isArray((json as { conversations?: unknown }).conversations) ? ((json as { conversations: Record<string, unknown>[] }).conversations) : [];
  return list.slice(0, limit).map((c) => {
    const at = typeof c.start_time_unix_secs === 'number' ? new Date(c.start_time_unix_secs * 1000) : null;
    const reason = typeof c.termination_reason === 'string' && c.termination_reason ? ` (${c.termination_reason.slice(0, 120)})` : '';
    return `${when(at)} ${String(c.status ?? '?')} ${Math.max(0, Number(c.call_duration_secs) || 0)}s${reason}`;
  });
}

export const listOrNone = (lines: string[]) => (lines.length ? lines.join('; ') : 'none');
