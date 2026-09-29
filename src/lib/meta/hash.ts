/**
 * The SHA-256 rules Meta asks for, used for both the Conversions API and the
 * pixel's manual advanced matching, so the two always agree:
 *
 *   em           the email, trimmed and lower-cased, then SHA-256 (hex)
 *   external_id  our user id, trimmed and lower-cased, then SHA-256 (hex)
 *
 * Nothing else about a member is ever hashed or sent (no name, phone or
 * address). Pure apart from node:crypto; never imported by browser code.
 */
import { createHash } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** The email as Meta normalises it, or null when it is not an email. */
export function normaliseEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const v = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function hashEmail(email: string | null | undefined): string | null {
  const v = normaliseEmail(email);
  return v ? sha256Hex(v) : null;
}

export function hashExternalId(userId: string | null | undefined): string | null {
  if (typeof userId !== 'string') return null;
  const v = userId.trim().toLowerCase();
  return v ? sha256Hex(v) : null;
}
