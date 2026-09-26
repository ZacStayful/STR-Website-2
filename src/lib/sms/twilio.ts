/**
 * Twilio's Messages API and webhook signatures, as plain functions.
 *
 * No SDK: sending is one form POST with Basic auth, and checking a webhook is
 * one HMAC. Both are small enough to own, and owning them keeps them testable
 * under node --test without a bundler.
 *
 *   buildSendRequest   the POST to /Accounts/{sid}/Messages.json
 *   parseSendResponse  accepted (a sid) or refused (Twilio's error code)
 *   twilioSignature    X-Twilio-Signature: HMAC-SHA1 of the URL followed by
 *                      every form field, sorted by name, as name+value, keyed
 *                      by the account's auth token, base64
 *   signatureValid     the header against each URL the request may have been
 *                      signed for, in constant time
 *
 * Pure: no network, no database, no server-only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/** The recipient replied STOP to our sender: Twilio will refuse every send until they reply START. */
export const ERROR_OPTED_OUT = 21610;

/** Codes that mean the number itself cannot take a text from us. */
export const INVALID_NUMBER_ERRORS: ReadonlySet<number> = new Set([
  21211, // invalid To
  21214, // To cannot be reached
  21408, // region not enabled (Geo Permissions)
  21612, // To/From pair cannot be routed
  21614, // To is not a mobile number
]);

export interface SendRequest {
  accountSid: string;
  authToken: string;
  to: string;
  body: string;
  /** The Messaging Service (sender pool, opt-out handling). Preferred over `from`. */
  messagingServiceSid?: string | null;
  from?: string | null;
  statusCallback?: string | null;
}

export function messagesUrl(accountSid: string): string {
  return `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
}

export function buildSendRequest(r: SendRequest): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const form = new URLSearchParams();
  form.set('To', r.to);
  form.set('Body', r.body);
  if (r.messagingServiceSid) form.set('MessagingServiceSid', r.messagingServiceSid);
  else if (r.from) form.set('From', r.from);
  if (r.statusCallback) form.set('StatusCallback', r.statusCallback);
  return {
    url: messagesUrl(r.accountSid),
    init: {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${r.accountSid}:${r.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    },
  };
}

export type SendOutcome =
  | { ok: true; sid: string; status: string; segments: number | null }
  | { ok: false; httpStatus: number; code: number | null; message: string; optedOut: boolean; invalidNumber: boolean };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Twilio answers 201 with the message (sid, status "queued"/"accepted") when
 * it has taken the text, and 4xx with { code, message } when it will not.
 * Anything else — a 2xx without a sid, a 5xx — is a refusal we did not
 * understand, and is treated as not sent.
 */
export function parseSendResponse(httpStatus: number, json: unknown): SendOutcome {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const sid = typeof o.sid === 'string' ? o.sid : null;
  if (httpStatus >= 200 && httpStatus < 300 && sid && /^(SM|MM)[0-9a-f]{32}$/i.test(sid)) {
    return { ok: true, sid, status: typeof o.status === 'string' ? o.status : 'queued', segments: num(o.num_segments) };
  }
  const code = num(o.code) ?? num(o.error_code);
  const message = typeof o.message === 'string' ? o.message.slice(0, 300) : typeof o.error_message === 'string' ? o.error_message.slice(0, 300) : `HTTP ${httpStatus}`;
  return { ok: false, httpStatus, code, message, optedOut: code === ERROR_OPTED_OUT, invalidNumber: code !== null && INVALID_NUMBER_ERRORS.has(code) };
}

// ── Delivery status ──

/**
 * How far along a message is. Twilio's status callbacks can arrive out of
 * order; a later callback only replaces the stored status when it is further
 * along, so a late "sent" can never overwrite "delivered".
 */
const STATUS_RANK: Readonly<Record<string, number>> = {
  scheduled: 1,
  accepted: 1,
  queued: 2,
  sending: 3,
  sent: 4,
  delivered: 5,
  undelivered: 5,
  failed: 5,
  canceled: 5,
  read: 6,
};

export function isKnownStatus(status: unknown): status is string {
  return typeof status === 'string' && status in STATUS_RANK;
}

export function statusAdvances(current: string | null | undefined, next: string): boolean {
  if (!isKnownStatus(next)) return false;
  if (!current || !isKnownStatus(current)) return true;
  return STATUS_RANK[next] > STATUS_RANK[current];
}

/** The text never reached the phone. */
export function isFailedStatus(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'undelivered' || status === 'canceled';
}

// ── Webhook signatures ──

export type FormParams = Iterable<readonly [string, string]> | Readonly<Record<string, string>>;

function entriesOf(params: FormParams): [string, string][] {
  if (Symbol.iterator in Object(params)) return [...(params as Iterable<readonly [string, string]>)].map(([k, v]) => [k, v]);
  return Object.entries(params as Record<string, string>);
}

/**
 * X-Twilio-Signature for a form-encoded request: the full URL Twilio called
 * (query string and all), then each field name immediately followed by its
 * value, fields sorted by name (a repeated name: its values sorted too).
 */
export function twilioSignature(authToken: string, url: string, params: FormParams): string {
  const pairs = entriesOf(params).sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0));
  let data = url;
  for (const [k, v] of pairs) data += k + v;
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/**
 * Whether the header is Twilio's signature for this request at any of the
 * candidate URLs (the configured public one first, then what the request
 * says). Every candidate is a full HMAC check, so trying more than one never
 * weakens it. No header, no token or no candidate means no.
 */
export function signatureValid(authToken: string | null | undefined, header: string | null | undefined, candidateUrls: readonly string[], params: FormParams): boolean {
  if (!authToken || !header) return false;
  const given = Buffer.from(header);
  const fields = entriesOf(params);
  let ok = false;
  for (const url of new Set(candidateUrls.filter(Boolean))) {
    const expected = Buffer.from(twilioSignature(authToken, url, fields));
    // Compare every candidate, so the time taken does not say which one matched.
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}
