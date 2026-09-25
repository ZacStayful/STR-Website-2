/**
 * Signed, expiring URLs for things the browser may fetch without a session.
 *
 * The marketplace serves a deal's photo before the member has paid to open
 * it. A raw portal photo URL would give the property away (Rightmove's media
 * paths embed the listing id), so the page links to our own route with the
 * deal id and a signature. Anyone can fetch a signed URL until it expires,
 * which is the point — the CDN caches it — but nobody can mint one for a deal
 * they have not been shown, and an old link stops working.
 *
 * `signWith` / `verifyWith` take the key explicitly so they can be tested;
 * `signPayload` / `verifyPayload` read it from the environment. Same split as
 * `agent.ts`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DIGEST_BYTES = 16;

export function signWith(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url').slice(0, Math.ceil((DIGEST_BYTES * 4) / 3));
}

export function verifyWith(key: string, payload: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWith(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/** `id:exp` with `exp` in unix seconds; the payload the photo route signs. */
export function expiringPayload(id: string, expiresAtSeconds: number): string {
  return `${id}:${Math.floor(expiresAtSeconds)}`;
}

/**
 * Checks an `id:exp` payload's signature and that it has not expired. Never
 * throws: a malformed exp is simply invalid.
 */
export function verifyExpiring(key: string, id: string, exp: string | number | null | undefined, signature: string | null | undefined, now: Date = new Date()): boolean {
  const seconds = typeof exp === 'number' ? exp : Number(exp);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  if (seconds * 1000 < now.getTime()) return false;
  return verifyWith(key, expiringPayload(id, seconds), signature);
}

function keyFromEnv(): string | null {
  const key = process.env.DEALS_PHOTO_SECRET || process.env.INTERNAL_API_SECRET;
  return key && key.length >= 16 ? key : null;
}

/** True when a signing key is configured; the route should 404 otherwise. */
export function signingConfigured(): boolean {
  return keyFromEnv() !== null;
}

export function signPayload(payload: string): string | null {
  const key = keyFromEnv();
  return key ? signWith(key, payload) : null;
}

export function verifyExpiringFromEnv(id: string, exp: string | number | null | undefined, signature: string | null | undefined, now: Date = new Date()): boolean {
  const key = keyFromEnv();
  return key ? verifyExpiring(key, id, exp, signature, now) : false;
}
