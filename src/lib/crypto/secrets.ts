/**
 * Encryption at rest for third-party credentials — a customer's Monday API
 * key, a webhook signing secret. These are keys to someone else's system,
 * so they never sit in the database in plaintext.
 *
 * AES-256-GCM, stored as `iv:tag:ciphertext` in base64url. GCM is
 * authenticated, so a row edited in the Supabase dashboard fails to decrypt
 * rather than silently returning corrupted bytes.
 *
 * The key comes from CRM_ENCRYPTION_KEY: 32 bytes, base64 or hex. The
 * `*With` functions take the key explicitly so they can be unit tested; the
 * env-reading wrappers are what application code calls.
 *
 * Rotation: decrypt with the old key, re-encrypt with the new one, in that
 * order. There is no key id in the format, so both keys cannot be live at
 * once — rotate in a single migration, not gradually.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const TAG_BYTES = 16;

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretKeyError';
  }
}

/**
 * Parses a 32-byte key from base64 or hex. Returns null for anything else,
 * including a key of the wrong length — a short key would otherwise be
 * silently padded and weaken every secret encrypted with it.
 */
export function parseKey(raw: string | undefined | null): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  for (const encoding of ['base64', 'hex'] as const) {
    try {
      const buf = Buffer.from(trimmed, encoding);
      if (buf.length === KEY_BYTES) return buf;
    } catch {
      // try the next encoding
    }
  }
  return null;
}

export function loadKey(): Buffer | null {
  return parseKey(process.env.CRM_ENCRYPTION_KEY);
}

export function secretsConfigured(): boolean {
  return loadKey() !== null;
}

/** Generates a key in the format CRM_ENCRYPTION_KEY expects. */
export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

export function encryptWith(key: Buffer, plaintext: string): string {
  if (key.length !== KEY_BYTES) throw new SecretKeyError(`key must be ${KEY_BYTES} bytes, got ${key.length}`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

/**
 * Returns null for anything that does not decrypt cleanly — wrong key,
 * tampered ciphertext, malformed value. Callers treat that as "this
 * connection needs reconnecting", never as an empty credential.
 */
export function decryptWith(key: Buffer, stored: string): string | null {
  if (key.length !== KEY_BYTES || typeof stored !== 'string') return null;
  const parts = stored.split(':');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Bad tag, bad key, bad base64 — all indistinguishable on purpose.
    return null;
  }
}

/** Throws when no key is configured: storing a credential in the clear is not a fallback. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) throw new SecretKeyError('CRM_ENCRYPTION_KEY is not set or is not a 32-byte base64/hex key');
  return encryptWith(key, plaintext);
}

export function decryptSecret(stored: string | null | undefined): string | null {
  const key = loadKey();
  if (!key || !stored) return null;
  return decryptWith(key, stored);
}

/** Constant-time compare for webhook signatures. */
export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
