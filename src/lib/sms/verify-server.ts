import 'server-only';

/**
 * Verifying a member's mobile (the rules are in ./verify.ts).
 *
 *   requestCode  a UK mobile not verified on another account, within the
 *                resend limits: a new code, texted from our own sender. Any
 *                earlier open code for the member is superseded.
 *   checkCode    one guess, counted in the database first. A match makes
 *                the number the member's texting number. On a member's
 *                FIRST verified number every text switch turns on (they can
 *                turn each off after); a change of number keeps their choices.
 *
 * The code itself is never stored or logged outside a dry run: only its HMAC.
 */
import { randomUUID } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { signingConfigured, signPayload } from '../crypto/sign';
import { SMS_NOTIFICATION_KEYS } from '../notifications/registry';
import { setNotifications } from '../notifications/server';
import { siteUrl } from '../url';
import { isSmsConfigured, isSmsDryRun } from './config';
import { maskPhone, ukMobile } from './phone';
import { sendSms } from './send';
import { getContact, insertMessage, recentCodeSends, saveVerifiedNumber, stopNumber, updateMessage, verifiedElsewhere } from './store';
import { CODE_TTL_MS, codePayload, codeText, MAX_ATTEMPTS, newCode, normaliseCode, resendMessage, resendVerdict, sameHash } from './verify';

const UNAVAILABLE = 'Texts are not available just now. Please try again later.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestCodeResult =
  | { ok: true; verificationId: string; masked: string; dryRun: boolean }
  | { ok: false; error: string };

export async function requestCode(userId: string, rawPhone: string, now: Date = new Date()): Promise<RequestCodeResult> {
  const phone = ukMobile(rawPhone);
  if (!phone) return { ok: false, error: 'Enter a UK mobile number, starting 07 or +447.' };
  if (!hasServiceRole() || !signingConfigured()) {
    console.error('[sms] verification unavailable: service role or signing key missing');
    return { ok: false, error: UNAVAILABLE };
  }
  if (!isSmsConfigured() && !isSmsDryRun()) {
    console.warn('[sms] verification refused: Twilio is not configured');
    return { ok: false, error: UNAVAILABLE };
  }
  const admin = createAdminClient();

  const current = await getContact(admin, userId);
  if (current?.verified_at && current.phone_e164 === phone && !current.stopped_at) return { ok: false, error: 'That number is already verified.' };
  const taken = await verifiedElsewhere(admin, phone, userId);
  if (taken === null) return { ok: false, error: UNAVAILABLE };
  if (taken) return { ok: false, error: 'That number already gets our texts on another account.' };

  const history = await recentCodeSends(admin, userId, phone, now);
  if (!history) return { ok: false, error: UNAVAILABLE };
  const verdict = resendVerdict(history.user, history.number, now);
  if (!verdict.ok) return { ok: false, error: resendMessage(verdict) };

  // Only the newest code works.
  await admin.from('sms_verifications').update({ superseded_at: now.toISOString() }).eq('user_id', userId).is('verified_at', null).is('superseded_at', null);

  const verificationId = randomUUID();
  const code = newCode();
  const hash = signPayload(codePayload(verificationId, code));
  if (!hash) return { ok: false, error: UNAVAILABLE };
  const { error: insertError } = await admin.from('sms_verifications').insert({
    id: verificationId,
    user_id: userId,
    phone_e164: phone,
    code_hash: hash,
    expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  });
  if (insertError) {
    console.error('[sms] verification insert failed:', insertError.message);
    return { ok: false, error: UNAVAILABLE };
  }

  const dryRun = isSmsDryRun();
  // The stored body never carries the code.
  const messageId = await insertMessage(admin, { user_id: userId, direction: 'outbound', kind: 'verify', phone_e164: phone, body: codeText('******'), dry_run: dryRun, outcome: 'pending' });
  if (!messageId) {
    await admin.from('sms_verifications').update({ superseded_at: now.toISOString() }).eq('id', verificationId);
    return { ok: false, error: UNAVAILABLE };
  }
  const result = await sendSms({ to: phone, body: codeText(code), purpose: 'verify', messageId, statusCallback: siteUrl(`/api/twilio/status?m=${messageId}`), dryRun });
  const outcome = result.sent ? 'accepted' : result.reason === 'dry_run' ? 'dry_run' : result.reason === 'unknown' ? 'unknown' : 'refused';
  await updateMessage(admin, messageId, { outcome, twilio_sid: result.sid ?? null, status: result.status ?? null, segments: result.segments ?? null, error_code: result.errorCode ?? null });

  if (result.sent || result.reason === 'dry_run' || result.reason === 'unknown') {
    // "unknown": the text may well have arrived, so the code stays usable.
    return { ok: true, verificationId, masked: maskPhone(phone), dryRun: result.reason === 'dry_run' };
  }
  await admin.from('sms_verifications').update({ superseded_at: now.toISOString() }).eq('id', verificationId);
  if (result.reason === 'opted_out') {
    await stopNumber(admin, phone, 'twilio', now);
    return { ok: false, error: 'This number replied STOP to our texts. Text START to the number that texted you before, then try again.' };
  }
  if (result.reason === 'invalid_number') return { ok: false, error: 'We could not text that number. Please check it is a UK mobile.' };
  return { ok: false, error: UNAVAILABLE };
}

export type CheckCodeResult = { ok: true; firstNumber: boolean } | { ok: false; error: string; expired?: boolean };

export async function checkCode(userId: string, verificationId: string, rawCode: unknown, consentSource: 'signup' | 'account', now: Date = new Date()): Promise<CheckCodeResult> {
  const code = normaliseCode(rawCode);
  if (!code) return { ok: false, error: 'Enter the 6-digit code from the text.' };
  if (!UUID.test(verificationId)) return { ok: false, error: 'Send a new code and try again.', expired: true };
  if (!hasServiceRole() || !signingConfigured()) return { ok: false, error: UNAVAILABLE };
  const admin = createAdminClient();

  // Counts the guess before anything is compared; nothing comes back once the
  // code has expired, been used, been replaced or had five guesses.
  const { data, error } = await admin.rpc('sms_verification_attempt', { p_id: verificationId, p_user: userId });
  if (error) {
    console.error('[sms] verification attempt failed (schema behind?):', error.message);
    return { ok: false, error: UNAVAILABLE };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { code_hash: string; phone_e164: string; attempts: number } | undefined;
  if (!row) return { ok: false, error: 'That code has expired or had too many wrong tries. Send a new one.', expired: true };

  if (!sameHash(signPayload(codePayload(verificationId, code)), row.code_hash)) {
    const left = MAX_ATTEMPTS - row.attempts;
    return left > 0
      ? { ok: false, error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` }
      : { ok: false, error: 'That code is not right, and that was the last try. Send a new one.', expired: true };
  }

  const { data: used, error: useError } = await admin.from('sms_verifications').update({ verified_at: now.toISOString() }).eq('id', verificationId).is('verified_at', null).select('id');
  if (useError || (used?.length ?? 0) !== 1) return { ok: false, error: 'That code has already been used. Send a new one.', expired: true };

  const before = await getContact(admin, userId);
  const firstNumber = !before?.verified_at;
  const saved = await saveVerifiedNumber(admin, userId, row.phone_e164, consentSource, now);
  if (saved === 'taken') return { ok: false, error: 'That number already gets our texts on another account.', expired: true };
  if (saved === 'error') return { ok: false, error: UNAVAILABLE };
  // A member's first number: every text alert on (they asked for texts by verifying).
  if (firstNumber) await setNotifications(userId, SMS_NOTIFICATION_KEYS, true);
  return { ok: true, firstNumber };
}
