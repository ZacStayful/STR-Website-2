/**
 * Signing the outbound webhook.
 *
 * A customer's n8n or Zapier endpoint is a public URL. Without a signature
 * anyone who learns it can post fabricated leads into their CRM, so every
 * delivery carries an HMAC-SHA256 over the body under a shared secret only
 * they and we hold.
 *
 * Three details matter and are each easy to get wrong:
 *
 *   The timestamp is INSIDE the signed string, not just beside it. Signing
 *   the body alone lets an attacker replay a captured delivery for ever with
 *   a fresh timestamp; signing `${timestamp}.${body}` binds the two so a
 *   replay has to reuse the old timestamp and falls outside the window.
 *
 *   Verification is constant-time. A byte-by-byte `===` leaks how much of a
 *   guess was right through how long the comparison took, which is enough to
 *   forge a signature a byte at a time.
 *
 *   The window is checked in BOTH directions. A clock ahead of ours is as
 *   much a sign of a forged timestamp as one behind.
 *
 * The header format is Stripe's, because it is the one every integration
 * author has already met: `t=<unix seconds>,v1=<hex>`.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-stayful-signature';
export const TIMESTAMP_HEADER = 'x-stayful-timestamp';

/** How far a delivery's timestamp may be from the receiver's clock. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Raw hex digest over `${timestamp}.${body}`. */
export function signBody(secret: string, body: string, timestampSeconds: number): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

/** The full `x-stayful-signature` header value. */
export function signatureHeader(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${signBody(secret, body, timestampSeconds)}`;
}

export interface ParsedSignature {
  timestamp: number | null;
  signatures: string[];
}

/**
 * Reads a signature header. Tolerant of extra schemes and whitespace, since
 * a future v2 must not break a v1 receiver — unknown keys are ignored rather
 * than making the whole header unparseable.
 */
export function parseSignatureHeader(header: string | null | undefined): ParsedSignature {
  const out: ParsedSignature = { timestamp: null, signatures: [] };
  if (typeof header !== 'string') return out;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) out.timestamp = n;
    } else if (key === 'v1' && /^[0-9a-f]+$/i.test(value)) {
      out.signatures.push(value.toLowerCase());
    }
  }
  return out;
}

/** Constant-time hex compare. Different lengths are unequal without leaking where. */
export function signaturesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type VerifyFailure =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'timestamp_out_of_range'
  | 'no_match';

export interface VerifyResult {
  ok: boolean;
  reason?: VerifyFailure;
}

/**
 * Verifies a delivery. Exported so the guide can point a customer at the
 * exact algorithm, and so our own tests prove a replay and a tampered body
 * are both refused.
 */
export function verifySignature(input: {
  secret: string;
  body: string;
  header: string | null | undefined;
  /** Unix seconds; defaults to now. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}): VerifyResult {
  const parsed = parseSignatureHeader(input.header);
  if (parsed.signatures.length === 0) return { ok: false, reason: 'missing_signature' };
  if (parsed.timestamp === null) return { ok: false, reason: 'missing_timestamp' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_range' };
  }

  const expected = signBody(input.secret, input.body, parsed.timestamp);
  // Every offered v1 is checked, so rotating a secret by sending two
  // signatures stays possible without changing this.
  const matched = parsed.signatures.some((s) => signaturesMatch(s, expected));
  return matched ? { ok: true } : { ok: false, reason: 'no_match' };
}

/** A fresh webhook secret. Shown to the customer once, stored encrypted. */
export function mintWebhookSecret(): string {
  // Hex rather than base64url: this gets pasted into n8n, Zapier and shell
  // snippets, and hex has nothing in it that needs escaping anywhere.
  return `whsec_${randomBytes(24).toString('hex')}`;
}
