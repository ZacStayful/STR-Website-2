/**
 * Review R3 (R3-25 / R2-34): a call placed with no ids. When ElevenLabs never
 * answered the outbound-call request (a timeout, a dropped connection) Twilio
 * may still have started the call. The reconcile (run.ts step 3) adopts the
 * outbound call Twilio made to the member's number right after the row was
 * placed, by its sid, so the call is settled like any other (its minutes
 * charged, its missed-call follow-up sent) instead of failed while Twilio
 * was still ringing.
 *
 * Pure: no network, no database, no server-only.
 */

/** How long after placed_at Twilio's call may have started (the request's 15 s timeout, with room). */
export const ADOPT_WINDOW_MS = 3 * 60_000;
/** Clock skew allowed between Twilio's start time and ours. */
const SKEW_MS = 30_000;

/**
 * The sid of the newest outbound call in Twilio's Calls.json (newest first)
 * that started inside the window after `placedAtMs`, or null. Inbound calls
 * and calls outside the window are never adopted.
 */
export function adoptableCallSid(json: unknown, placedAtMs: number, windowMs = ADOPT_WINDOW_MS): string | null {
  const calls = json && typeof json === 'object' && Array.isArray((json as { calls?: unknown }).calls) ? (json as { calls: Record<string, unknown>[] }).calls : [];
  for (const c of calls) {
    const sid = typeof c.sid === 'string' && /^CA[0-9a-f]{32}$/i.test(c.sid) ? c.sid : null;
    if (!sid) continue;
    if (typeof c.direction === 'string' && !c.direction.startsWith('outbound')) continue;
    const raw = typeof c.start_time === 'string' && c.start_time ? c.start_time : typeof c.date_created === 'string' ? c.date_created : null;
    const at = raw ? Date.parse(raw) : Number.NaN;
    if (!Number.isFinite(at)) continue;
    if (at < placedAtMs - SKEW_MS || at > placedAtMs + windowMs) continue;
    return sid;
  }
  return null;
}
