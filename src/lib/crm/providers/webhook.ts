/**
 * The generic signed webhook — how a customer gets their leads into n8n,
 * Zapier, Make, or anything else they can point a URL at.
 *
 * Every delivery is an HTTP POST of the lead payload, signed with a shared
 * secret (see `../signature.ts` for why the timestamp is inside the signed
 * string). The receiver is someone else's server, so three things are
 * non-negotiable:
 *
 *   A timeout. A customer's endpoint hanging must not hold the delivery cron
 *   open until the function is killed, taking every other pending delivery
 *   with it.
 *
 *   The URL is validated as public https before anything is sent. A
 *   webhook URL is the one field in this product where a customer types an
 *   address and we make a server-side request to it — which is server-side
 *   request forgery waiting to happen if it is allowed to point at
 *   localhost, a link-local address or our own internal network.
 *
 *   The PDF is a link, not an attachment. Workflow tools deal in JSON, a
 *   base64 PDF would multiply the body by four, and the link works for as
 *   long as the report does.
 */

import { signatureHeader, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../signature.ts';
import type { CrmProvider, CrmResult, LeadPayload, ResolvedConnection } from '../types.ts';

const TIMEOUT_MS = 15_000;

/** Hostnames that must never be the target of a server-side request. */
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);

/**
 * Literal private and link-local addresses. A hostname that RESOLVES to one
 * of these is not caught here — that needs DNS resolution at request time,
 * and the address can change between the check and the connection anyway.
 * Blocking the literal forms removes the easy case; the platform's own
 * egress rules are what cover the rest.
 */
const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export function checkWebhookUrl(raw: string | null | undefined): UrlCheck {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return { ok: false, reason: 'Add the URL your workflow listens on.' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }
  if (url.protocol !== 'https:') {
    // Lead payloads carry a named person's contact details and home address.
    return { ok: false, reason: 'The URL must start with https:// — leads carry personal data.' };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: 'That address is not reachable from our servers.' };
  }
  if (PRIVATE_IPV4.test(host) || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return { ok: false, reason: 'That is a private network address, which we cannot reach.' };
  }
  return { ok: true };
}

function urlOf(conn: ResolvedConnection): string | null {
  const raw = (conn.config as { url?: unknown }).url;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Sends one signed POST. Shared by the live push and the test ping so the
 * customer's "test" proves the exact request a real lead will make — a test
 * that takes a different path proves nothing.
 */
async function post(conn: ResolvedConnection, body: unknown): Promise<CrmResult> {
  const url = urlOf(conn);
  const check = checkWebhookUrl(url);
  if (!check.ok) return { ok: false, error: check.reason, retryable: false };
  if (!conn.webhookSecret) {
    return { ok: false, error: 'This connection has no signing secret. Regenerate it.', retryable: false };
  }

  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: signatureHeader(conn.webhookSecret, payload, timestamp),
        [TIMESTAMP_HEADER]: String(timestamp),
        'User-Agent': 'Stayful-Intelligence-Webhook/1',
      },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A 3xx to somewhere else would send a signed payload of personal data
      // to an address the customer never agreed to.
      redirect: 'error',
    });
    if (res.ok) return { ok: true, externalId: null };

    const detail = (await res.text().catch(() => '')).slice(0, 200).trim();
    return {
      ok: false,
      error: `Your endpoint returned HTTP ${res.status}${detail ? `: ${detail}` : ''}.`,
      // 4xx is the receiver saying the request is wrong, and it will say so
      // again; 408 and 429 are the exceptions that mean "later".
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach your endpoint: ${message}`, retryable: true };
  }
}

export const webhookProvider: CrmProvider = {
  id: 'webhook',
  label: 'Webhook (n8n, Zapier, Make)',

  async testConnection(conn: ResolvedConnection): Promise<CrmResult> {
    // A real, signed request with a payload shaped exactly like a lead, so a
    // customer can build their whole workflow against it before a prospect
    // ever fills in the form.
    return post(conn, { version: 1, event: 'connection.test', sentAt: new Date().toISOString() });
  },

  async pushLead(conn: ResolvedConnection, payload: LeadPayload): Promise<CrmResult> {
    return post(conn, payload);
  },
};
