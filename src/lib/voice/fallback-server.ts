import 'server-only';

/**
 * Batch 23: a missed outbound call (no answer, busy, voicemail) sends one
 * text AND one email saying "I tried to call you", with the same link the
 * call would have texted — once per call, however many webhooks arrive.
 * The text goes only to the member's own verified number on file, and never
 * after STOP; the email goes to their account email. Each is charged once
 * (22p / 20p); the missed call itself is free.
 */
import { createAdminClient } from '../supabase/admin';
import { siteUrl } from '../url';
import { sendSms } from '../sms/send';
import { getBillingSettings } from '../credit/unit-costs';
import { missedCallEmail as sendMissedEmail } from '../email/si-calls';
import { missedCallEmail, missedCallTemplate, missedCallText } from './templates';
import { memberFacts } from './member-server';
import { claimCharge, releaseCharge, settleEmail, settleText } from './charge-server';
import { callsDryRun } from './config';
import { claimCallSlot } from './cap-server';
import type { CallRow } from './store-server';

export async function sendMissedCallFallback(call: CallRow): Promise<{ text: boolean; email: boolean }> {
  const out = { text: false, email: false };
  if (call.direction !== 'outbound' || !call.user_id || (call.call_type !== 'intro' && call.call_type !== 'low_credit')) return out;
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
  const m = await memberFacts(call.user_id);
  if (!m) return out;
  const settings = await getBillingSettings();
  const type = call.call_type;
  const ctx = { base: siteUrl(), topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence };

  if (m.numberOk && m.phone) {
    const key = `call:${call.id}:text:${missedCallTemplate(type)}`;
    const guard = await claimCharge(key, call.id, m.userId, 'text');
    if (guard) {
      const r = await sendSms({ to: m.phone, body: missedCallText(type, ctx), purpose: 'si_missed_call', dryRun: callsDryRun() });
      if (r.sent || r.reason === 'unknown') {
        await settleText(guard, key, call.id, m.userId);
        await admin.from('si_calls_log').update({ texts_sent: call.texts_sent + 1 }).eq('id', call.id);
        out.text = true;
      } else {
        await releaseCharge(guard);
      }
    }
  }
  if (m.email) {
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
  await claimCallSlot(m.userId);
  return out;
}
