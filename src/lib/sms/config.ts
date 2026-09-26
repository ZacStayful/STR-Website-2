/**
 * The SMS switches, read from the environment in one place.
 *
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN   the account. The auth token also
 *                                            signs every webhook Twilio sends us.
 *   TWILIO_MESSAGING_SERVICE_SID             the sender: the Messaging Service
 *                                            holding our UK mobile number.
 *   TWILIO_FROM_NUMBER                       fallback sender, a bare +447 number.
 *   SMS_DRY_RUN=true                         log every text instead of sending it.
 *   SMS_ALERTS_ENABLED=true                  the alert cron may send (off by default;
 *                                            verification works without it).
 *
 * Nothing here throws: a missing variable reads as "not configured" and every
 * sender logs and skips.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  from: string | null;
}

const env = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

/** The account and a sender, or null when any part is missing. */
export function twilioConfig(): TwilioConfig | null {
  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');
  const messagingServiceSid = env('TWILIO_MESSAGING_SERVICE_SID');
  const from = env('TWILIO_FROM_NUMBER');
  if (!accountSid || !authToken || (!messagingServiceSid && !from)) return null;
  return { accountSid, authToken, messagingServiceSid, from };
}

export function isSmsConfigured(): boolean {
  return twilioConfig() !== null;
}

/** The key Twilio signs webhooks with. Webhooks are refused without it. */
export function twilioAuthToken(): string | null {
  return env('TWILIO_AUTH_TOKEN');
}

export function isSmsDryRun(): boolean {
  return process.env.SMS_DRY_RUN === 'true';
}

export function smsAlertsEnabled(): boolean {
  return process.env.SMS_ALERTS_ENABLED === 'true';
}
