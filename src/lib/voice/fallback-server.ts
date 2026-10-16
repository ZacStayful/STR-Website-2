import 'server-only';

/**
 * Batch 23: a missed outbound call (no answer, busy, voicemail) sends one
 * text AND one email saying "I tried to call you", with the same link the
 * call would have texted — once per call, however many webhooks arrive.
 * The text goes only to the member's own verified number on file, and never
 * after STOP; the email goes to their account email. Each is charged once
 * (22p / 20p); the missed call itself is free.
 *
 * Batch 25: a missed deal call's text and email name the deal (never its
 * address or price) and link to it in the app (/si/deal/<token>).
 *
 * Review R3: every follow-up text goes through sendMemberText (the Texts
 * switch, STOP and the sms_messages record; R3-78, R3-81); nothing goes once
 * calls are switched off (R3-82); a text is charged only when Twilio took it
 * (R3-5); and the once-per-call stamp is given back when nothing went, so a
 * later delivery tries again and the standout sync never reads it as told
 * (R3-59).
 */
import { createAdminClient } from '../supabase/admin';
import { siteUrl } from '../url';
import { getBillingSettings } from '../credit/unit-costs';
import { missedCallEmail as sendMissedEmail } from '../email/si-calls';
import { missedCallEmail, missedCallTemplate, missedCallText } from './templates';
import { memberFacts } from './member-server';
import { claimCharge, releaseCharge, settleEmail, settleText } from './charge-server';
import { textChargeStep } from './charge';
import { followUpChannels } from './fallback';
import { callsDryRun, isOutboundCallType } from './config';
import { claimCallSlot } from './cap-server';
import { dealCallFacts } from '../standout/calls-server';
import { sendMemberText } from '../standout/texts-server';
import type { CallRow } from './store-server';

export async function sendMissedCallFallback(call: CallRow): Promise<{ text: boolean; email: boolean }> {
  const out = { text: false, email: false };
  if (call.direction !== 'outbound' || !call.user_id || !isOutboundCallType(call.call_type)) return out;
  const admin = createAdminClient();
  // Once per call: only the request that stamps fallback_sent_at sends.
  const { data: won, error } = await admin
    .from('si_calls_log')
    .update({ fallback_sent_at: new Date().toISOString() })
    .eq('id', call.id)
    .in('status', ['missed', 'voicemail'])
    .is('fallback_sent_at', null)
    .select('id');
  if (error || (won ?? []).length !== 1) return out;
  // The stamp stays only when something went, or nothing ever could (calls off, nowhere to send): otherwise it is
  // given back in `finally` so a later delivery tries again (R3-59).
  let keepStamp = false;
  try {
    const m = await memberFacts(call.user_id);
    if (!m) return out;
    const ch = followUpChannels(m);
    if (!ch.text && !ch.email) {
      keepStamp = true;
      return out;
    }
    const settings = await getBillingSettings();
    const type = call.call_type;
    const deal = type === 'deal' ? (await dealCallFacts(admin, call))?.deal ?? null : null;
    const ctx = { base: siteUrl(), topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence, deal, callsPerMonth: settings.standout.callsPerMonth };

    if (ch.text) {
      const key = `call:${call.id}:text:${missedCallTemplate(type)}`;
      const guard = await claimCharge(key, call.id, m.userId, 'text');
      if (guard) {
        const r = await sendMemberText(admin, { userId: m.userId, body: missedCallText(type, ctx), kind: type === 'deal' ? 'standout' : 'call', purpose: 'si_missed_call', dryRun: callsDryRun() });
        const step = textChargeStep(r);
        if (step === 'settle') await settleText(guard, key, call.id, m.userId);
        if (step === 'release') await releaseCharge(guard);
        else {
          // Sent, or maybe sent: told either way, never again; charged only when Twilio took it.
          await admin.from('si_calls_log').update({ texts_sent: call.texts_sent + 1 }).eq('id', call.id);
          out.text = true;
        }
      }
    }
    if (ch.email && m.email) {
      const key = `call:${call.id}:email:fallback`;
      const guard = await claimCharge(key, call.id, m.userId, 'email');
      if (guard) {
        const sent = callsDryRun() ? false : await sendMissedEmail(m.email, missedCallEmail(type, ctx, m.firstName), `si-missed:${call.id}`);
        if (sent) {
          await settleEmail(guard, key, call.id, m.userId);
          out.email = true;
        } else {
          await releaseCharge(guard);
        }
      }
    }
    keepStamp = out.text || out.email;
    // The day's email slot is taken only by a follow-up that went (R3-59).
    if (keepStamp) await claimCallSlot(m.userId);
    return out;
  } finally {
    if (!keepStamp) {
      const { error: back } = await admin.from('si_calls_log').update({ fallback_sent_at: null }).eq('id', call.id);
      if (back) console.error('[voice] fallback stamp not given back:', back.message);
    }
  }
}
