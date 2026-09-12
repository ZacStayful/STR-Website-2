/**
 * Welcome-credit abuse controls (pure, tested): disposable email domains and
 * a normalised mobile key so one number can only ever collect one £20 grant.
 */

import { DISPOSABLE_EMAIL_DOMAINS } from './disposable-domains.ts';

export function emailDomain(email: string | null | undefined): string | null {
  const m = (email ?? '').trim().toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1] : null;
}

export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  // Sub-domains of a listed domain (mail.tempmail.com) count too.
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) if (DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join('.'))) return true;
  return false;
}

/**
 * Normalises a UK-ish mobile number to a stable key: digits only, leading 0
 * swapped for +44, +44 kept. Returns null when it doesn't look like a number.
 */
export function normaliseMobile(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  let digits = mobile.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (digits.startsWith('+')) digits = `+${digits.slice(1).replace(/\D/g, '')}`;
  else if (digits.startsWith('0')) digits = `+44${digits.slice(1)}`;
  else if (/^44\d{9,10}$/.test(digits)) digits = `+${digits}`;
  else digits = `+44${digits}`;
  const n = digits.replace(/\D/g, '');
  if (n.length < 9 || n.length > 15) return null;
  return `+${n}`;
}
