import 'server-only';

/**
 * Batch 23, Part E: a text to the Stayful Intelligence number that is not
 * STOP / START / HELP (those stay exactly as Batch 8 built them, handled
 * first in /api/twilio/inbound).
 *
 *   "who is this?" (and close variants) → the Stayful Intelligence line
 *   anything else → "Thanks, I've passed that on…" and a copy forwarded to
 *                   the handoff address (feedback_admin_email)
 *
 * Wording: src/lib/voice/templates.ts. Every inbound text goes into the
 * conversation log (channel sms) for Batch 24. A reply is charged 22p to a
 * recognised member, once per message (keyed on the MessageSid); unknown
 * numbers are free. A number that sent STOP gets no reply. At most
 * si_sms_auto_replies_per_number_day replies a number a UK day, so two
 * auto-responders can never text each other forever.
 */
import { createAdminClient } from '../supabase/admin';
import { maskPhone } from '../sms/phone';
import { getBillingSettings } from '../credit/unit-costs';
import { feedbackSettings } from '../feedback/settings-server';
import { textForwardEmail } from '../email/si-calls';
import { addTurns, recordQuestion, startConversation } from '../conversations/log-server';
import { SMS_REPLY_OTHER, SMS_REPLY_WHO } from './templates';
import { replyKind } from './sms-replies';
import { ukDay } from './hours';
import { claimEvent } from './store-server';
import { callerHash } from './inbound-server';
import { claimCharge, settleText } from './charge-server';
import { memberFacts } from './member-server';
import { callsEnabled } from './config';

export async function replyToText(o: { phone: string; body: string; messageSid: string | null; now?: Date }): Promise<string | null> {
  const now = o.now ?? new Date();
  const text = o.body.trim();
  // Until calls are live, "ring me on this number" would be wrong: no reply, as before.
  if (!text || !o.messageSid || !callsEnabled()) return null;
  const admin = createAdminClient();
  // Once per message, however often Twilio delivers it.
  if ((await claimEvent(admin, 'twilio_sms', o.messageSid)) !== 'new') return null;

  const { data: contacts } = await admin.from('sms_contacts').select('user_id, verified_at, stopped_at').eq('phone_e164', o.phone);
  const rows = (contacts ?? []) as { user_id: string; verified_at: string | null; stopped_at: string | null }[];
  const member = rows.find((r) => r.verified_at && !r.stopped_at) ?? null;
  const stopped = rows.length > 0 && rows.every((r) => r.stopped_at);
  const userId = member?.user_id ?? null;
  const kind = replyKind(text);

  const conversationId = await startConversation({ channel: 'sms', userId, startedAt: now });
  const settings = await getBillingSettings();

  // The daily cap on automatic replies to this number.
  let canReply = !stopped && settings.voice.smsAutoRepliesPerNumberDay > 0;
  if (canReply) {
    canReply = false;
    const hash = callerHash(o.phone);
    for (let n = 0; n < settings.voice.smsAutoRepliesPerNumberDay; n++) {
      if ((await claimEvent(admin, 'twilio_sms_reply', `${hash}:${ukDay(now)}:${n}`)) === 'new') {
        canReply = true;
        break;
      }
    }
  }
  let reply: string | null = canReply ? (kind === 'who' ? SMS_REPLY_WHO : SMS_REPLY_OTHER) : null;
  // A recognised member pays for the reply; the guard makes it once per message.
  if (reply && userId) {
    const key = `sms:${o.messageSid}`;
    const guard = await claimCharge(key, null, userId, 'text');
    if (guard) await settleText(guard, key, null, userId);
    else reply = null;
  }

  if (conversationId) {
    await addTurns(conversationId, [{ role: 'member', text, at: now }, ...(reply ? [{ role: 'agent' as const, text: reply, at: now }] : [])]);
    await recordQuestion(conversationId, { question: text, outcome: kind === 'who' ? 'answered' : 'handed_off', source: 'sms' });
  }

  if (kind === 'other') {
    const m = userId ? await memberFacts(userId) : null;
    const { adminEmail } = await feedbackSettings();
    if (adminEmail) {
      await textForwardEmail(adminEmail, {
        member: m ? `${m.firstName ?? 'Member'} (${m.email ?? userId})` : stopped ? 'Unknown (number sent STOP)' : 'Unknown number',
        from: maskPhone(o.phone),
        body: text.slice(0, 2000),
        messageSid: o.messageSid,
        conversationId,
      }).catch(() => false);
    }
  }
  return reply;
}

