/**
 * Review R3 (R3-17, R3-50 / R2-25 to R2-29): who an inbound call is from, as
 * far as the app will say. A member is identified (and charged) only with
 * calls switched on (Account → Calls: their consent), never on a dry-run
 * deployment, and only for a call Twilio placed (a real call sid: a forged
 * initiation POST never gets member data). Everyone else is an unknown
 * caller: what Stayful Intelligence is and the website, uncharged.
 *
 * Pure: no network, no database, no server-only.
 */
export const TWILIO_CALL_SID = /^CA[0-9a-f]{32}$/i;

export type InboundIdentity = { kind: 'member'; userId: string; callSid: string } | { kind: 'unknown'; reason: 'no_member' | 'dry_run' | 'no_call_sid' | 'no_consent' };

export function inboundIdentity(i: { userId: string | null; callsOn: boolean | null; dryRun: boolean; callSid: unknown }): InboundIdentity {
  if (!i.userId) return { kind: 'unknown', reason: 'no_member' };
  if (i.dryRun) return { kind: 'unknown', reason: 'dry_run' };
  if (typeof i.callSid !== 'string' || !TWILIO_CALL_SID.test(i.callSid)) return { kind: 'unknown', reason: 'no_call_sid' };
  if (i.callsOn !== true) return { kind: 'unknown', reason: 'no_consent' };
  return { kind: 'member', userId: i.userId, callSid: i.callSid };
}
