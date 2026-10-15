/**
 * Batch 23's missed-call follow-up ("I tried to call you"), the pure part.
 * Review R3 (R2-52 / R3-82): nobody is followed up once calls are switched
 * off; the call was consented to, the follow-up is not.
 *
 * Pure: no network, no database, no server-only.
 */

export interface FollowUpMember {
  callsOn: boolean;
  /** Verified, not stopped, a UK mobile. */
  numberOk: boolean;
  phone: string | null;
  email: string | null;
}

/** Where a missed call's text and email may go: nowhere once calls are off; a text only to a number that can take one; the email to the account's address. */
export function followUpChannels(m: FollowUpMember): { text: boolean; email: boolean } {
  if (!m.callsOn) return { text: false, email: false };
  return { text: Boolean(m.numberOk && m.phone), email: Boolean(m.email) };
}
