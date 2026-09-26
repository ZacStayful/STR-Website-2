/**
 * Which numbers we text: UK mobiles only, in E.164.
 *
 * normaliseMobile (the welcome-credit key) is deliberately loose: it turns
 * any 9–15 digits into a +44 number, landlines included. A text needs a
 * mobile, and texting only UK mobiles also keeps us clear of the premium
 * international ranges SMS-pumping fraud relies on. So a number must
 * normalise AND be +447 followed by nine digits.
 *
 * Pure: no network, no database, no server-only.
 */
import { normaliseMobile } from '../credit/abuse.ts';

const UK_MOBILE = /^\+447\d{9}$/;

/** The number as +447xxxxxxxxx, or null when it is not a UK mobile. */
export function ukMobile(raw: string | null | undefined): string | null {
  const n = normaliseMobile(raw);
  return n && UK_MOBILE.test(n) ? n : null;
}

export function isUkMobile(e164: string | null | undefined): e164 is string {
  return typeof e164 === 'string' && UK_MOBILE.test(e164);
}

/** "+44 7••• •••123": enough for the member to recognise it, and for logs, without the whole number. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 6) return '•••';
  if (digits.startsWith('447')) return `+44 7••• •••${digits.slice(-3)}`;
  return `+${digits.slice(0, 2)} ••• •••${digits.slice(-3)}`;
}
