// ─── Text messages (Twilio's Messages API over plain fetch, no SDK) ───
//
// The one function that sends a text. Modelled on src/lib/email/send.ts: it
// never throws, and a missing configuration is logged and skipped rather
// than an error — callers decide what that means.
//
// It refuses, before anything leaves the building:
//   - a number that is not a UK mobile (+447…)
//   - a body that is not one plain GSM-7 segment (≤160, no emoji or curly quotes)
//   - a body that does not end with the opt-out line
// and in a dry run (SMS_DRY_RUN=true, or dryRun) it logs the text instead.
//
// Every real call goes through meter() as house spend, so each text lands in
// provider_calls at the twilio:sms unit cost. Texts are free to members.
//
// There is no retry. Twilio's Messages API has no idempotency key, so a
// second attempt after a dropped connection could send the text twice; the
// caller records such a send as "unknown" and treats it as sent.

import { meter } from '../credit/meter.ts';
import { twilioConfig, isSmsDryRun } from './config.ts';
import { gsmLength, MAX_SMS_LENGTH, OPT_OUT_LINE } from './gsm.ts';
import { isUkMobile, maskPhone } from './phone.ts';
import { buildSendRequest, parseSendResponse } from './twilio.ts';

const TIMEOUT_MS = 10_000;

export type SmsFailure = 'not_configured' | 'dry_run' | 'invalid_number' | 'not_gsm' | 'too_long' | 'no_opt_out' | 'opted_out' | 'refused' | 'unknown';

export interface SmsResult {
  sent: boolean;
  /** Twilio's message sid, when it took the text. */
  sid?: string;
  status?: string;
  segments?: number | null;
  reason?: SmsFailure;
  /** Twilio's error code on a refusal. */
  errorCode?: number | null;
}

/** Why a body cannot be sent as it is, or null when it can. */
export function bodyProblem(body: string): Extract<SmsFailure, 'not_gsm' | 'too_long' | 'no_opt_out'> | null {
  const n = gsmLength(body);
  if (n === null) return 'not_gsm';
  if (n === 0 || n > MAX_SMS_LENGTH) return 'too_long';
  if (!body.endsWith(OPT_OUT_LINE)) return 'no_opt_out';
  return null;
}

export async function sendSms(params: {
  to: string;
  body: string;
  /** Where Twilio reports delivery (src/app/api/twilio/status). Only an https URL is passed on. */
  statusCallback?: string | null;
  dryRun?: boolean;
  /** For the logs and provider_calls: 'verify' | 'alert'. */
  purpose: string;
  /** sms_messages.id, so provider_calls can be joined to the text. */
  messageId?: string;
}): Promise<SmsResult> {
  const { to, body, purpose } = params;
  if (!isUkMobile(to)) {
    console.warn(`[sms] refused (${purpose}): not a UK mobile`);
    return { sent: false, reason: 'invalid_number' };
  }
  const problem = bodyProblem(body);
  if (problem) {
    console.error(`[sms] refused (${purpose}): ${problem} — ${JSON.stringify(body.slice(0, 200))}`);
    return { sent: false, reason: problem };
  }
  if (params.dryRun || isSmsDryRun()) {
    console.log(`[sms] dry run (${purpose}) → ${maskPhone(to)}: ${body}`);
    return { sent: false, reason: 'dry_run' };
  }
  const config = twilioConfig();
  if (!config) {
    console.warn('[sms] not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID) — skipping send');
    return { sent: false, reason: 'not_configured' };
  }

  const statusCallback = params.statusCallback && params.statusCallback.startsWith('https://') ? params.statusCallback : null;
  const { url, init } = buildSendRequest({ ...config, to, body, statusCallback });

  return meter<SmsResult>(
    {
      provider: 'twilio',
      unit: 'sms',
      quantityFrom: (r) => r.segments ?? 1,
      failed: (r) => !r.sent,
      description: `Text (${purpose})`,
      question: `sms.${purpose}`,
      key: params.messageId,
      skipPreflight: true,
    },
    async () => {
      let res: Response;
      try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        // Twilio may or may not have the text: the caller counts it as sent.
        console.error(`[sms] send failed (${purpose}) → ${maskPhone(to)}:`, err);
        return { sent: false, reason: 'unknown' };
      }
      const json = await res.json().catch(() => null);
      const outcome = parseSendResponse(res.status, json);
      if (outcome.ok) return { sent: true, sid: outcome.sid, status: outcome.status, segments: outcome.segments };
      // A 5xx is ambiguous in the same way a dropped connection is.
      if (res.status >= 500) {
        console.error(`[sms] Twilio HTTP ${res.status} (${purpose}) → ${maskPhone(to)}: ${outcome.message}`);
        return { sent: false, reason: 'unknown', errorCode: outcome.code };
      }
      console.error(`[sms] Twilio refused (${purpose}) → ${maskPhone(to)}: ${outcome.code ?? res.status} ${outcome.message}`);
      return { sent: false, reason: outcome.optedOut ? 'opted_out' : outcome.invalidNumber ? 'invalid_number' : 'refused', errorCode: outcome.code };
    },
    // Texts are house spend: never charged to a member.
    { userId: null, admin: false, action: `sms:${purpose}`, actionId: params.messageId ?? `sms-${Date.now()}` },
  );
}
