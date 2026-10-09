import 'server-only';

/**
 * Batch 25: every text this batch sends (a deal call's link, a missed deal
 * call, a standout below the call floor, the slower-spender nudge) goes
 * through here, so each one:
 *   - goes only to a member whose texts are on: a verified UK mobile, the
 *     "Texts" switch on, no STOP (Batch 8's contactCanReceive), read again
 *     just before sending
 *   - is recorded in sms_messages (kind 'standout' or 'nudge') with Twilio's
 *     answer, like Batch 6's alert texts
 * Charging stays with the caller (Batch 23's claimCharge → send → settleText,
 * or releaseCharge when nothing went).
 */
import { createAdminClient } from '../supabase/admin';
import { siteUrl } from '../url';
import { sendSms } from '../sms/send';
import { getContact, insertMessage, stopNumber, updateMessage } from '../sms/store';
import { contactCanReceive } from '../sms/choose';

type Admin = ReturnType<typeof createAdminClient>;

export interface MemberTextResult {
  sent: boolean;
  /** Sent, or maybe sent (Twilio didn't answer): charge it, count it. */
  counted: boolean;
  reason?: string;
}

/** Whether this member can be texted now (texts on, verified, not stopped). */
export async function textsOnFor(admin: Admin, userId: string): Promise<boolean> {
  return contactCanReceive(await getContact(admin, userId).catch(() => null));
}

export async function sendMemberText(admin: Admin, o: { userId: string; body: string; kind: 'standout' | 'nudge'; purpose: string; dryRun?: boolean; now?: Date }): Promise<MemberTextResult> {
  const contact = await getContact(admin, o.userId).catch(() => null);
  if (!contactCanReceive(contact)) return { sent: false, counted: false, reason: 'texts_off' };
  const phone = contact.phone_e164;
  const messageId = await insertMessage(admin, { user_id: o.userId, direction: 'outbound', kind: o.kind, phone_e164: phone, body: o.body, dry_run: Boolean(o.dryRun), outcome: 'pending' });
  if (!messageId) return { sent: false, counted: false, reason: 'record_failed' };
  const r = await sendSms({ to: phone, body: o.body, purpose: o.purpose, messageId, statusCallback: siteUrl(`/api/twilio/status?m=${messageId}`), dryRun: o.dryRun });
  const outcome = r.sent ? 'accepted' : r.reason === 'unknown' ? 'unknown' : r.reason === 'dry_run' ? 'dry_run' : 'refused';
  await updateMessage(admin, messageId, { outcome, twilio_sid: r.sid ?? null, status: r.status ?? null, segments: r.segments ?? null, error_code: r.errorCode ?? null });
  if (r.reason === 'opted_out') await stopNumber(admin, phone, 'twilio', o.now ?? new Date());
  return { sent: r.sent, counted: r.sent || r.reason === 'unknown', reason: r.reason };
}
