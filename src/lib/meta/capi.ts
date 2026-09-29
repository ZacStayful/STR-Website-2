/**
 * The Conversions API: what one event looks like, and sending it.
 *
 * An event carries only what the brief allows: its name, time and id, the
 * page it is reported against (never a query string), "website", and the
 * member's hashed email and hashed user id, their IP address and browser
 * (user agent), the _fbp/_fbc cookies, and a value in GBP for the two
 * payments. Nothing else about the member and nothing about any deal.
 *
 * Meta needs the browser's user agent on a website event: with none, the
 * event is not built (the browser copy still goes).
 *
 * sendCapi never throws and never waits longer than the timeout; a failure
 * comes back as a short note (the token is never in it). Tests pass their
 * own fetch; nothing here reads the environment.
 */
import { TRACKING } from '../tracking/config.ts';
import { isValidFbc, isValidFbp } from './fbc.ts';
import { carriesValue, penceToValue, type MetaEventName } from './events.ts';

/** The browser behind an event: from the member's own request, or their last-seen details. */
export interface ClientDetails {
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export interface CapiInput {
  event: MetaEventName;
  eventId: string;
  eventTime: Date;
  sourceUrl: string;
  emailHash: string | null;
  externalIdHash: string | null;
  client: ClientDetails;
  valuePence?: number | null;
}

export interface CapiEvent {
  event_name: MetaEventName;
  event_time: number;
  event_id: string;
  event_source_url: string;
  action_source: 'website';
  user_data: {
    em?: string[];
    external_id?: string[];
    client_ip_address?: string;
    client_user_agent: string;
    fbp?: string;
    fbc?: string;
  };
  custom_data?: { value: number; currency: 'GBP' };
}

const HEX64 = /^[a-f0-9]{64}$/;

/** A plain IPv4 or IPv6 address, or null. */
export function cleanIp(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) return v;
  if (v.includes(':') && v.length <= 45 && /^[0-9a-fA-F:.]+$/.test(v)) return v;
  return null;
}

/** The first address in an x-forwarded-for header (the browser's, on Vercel). */
export function ipFromForwardedFor(header: string | null | undefined): string | null {
  if (!header) return null;
  return cleanIp(header.split(',')[0] ?? null);
}

/** The page address with anything after it removed. */
export function withoutQuery(url: string): string {
  return url.split('#')[0].split('?')[0];
}

export function buildCapiEvent(input: CapiInput): { ok: true; event: CapiEvent } | { ok: false; reason: 'no_browser_details' | 'no_identity' | 'bad_event' } {
  const ua = typeof input.client.userAgent === 'string' ? input.client.userAgent.trim().slice(0, 512) : '';
  if (!ua) return { ok: false, reason: 'no_browser_details' };
  const em = input.emailHash && HEX64.test(input.emailHash) ? input.emailHash : null;
  const ext = input.externalIdHash && HEX64.test(input.externalIdHash) ? input.externalIdHash : null;
  if (!em && !ext) return { ok: false, reason: 'no_identity' };
  const time = Math.floor(input.eventTime.getTime() / 1000);
  if (!input.eventId || !Number.isFinite(time) || time <= 0) return { ok: false, reason: 'bad_event' };

  const user_data: CapiEvent['user_data'] = { client_user_agent: ua };
  if (em) user_data.em = [em];
  if (ext) user_data.external_id = [ext];
  const ip = cleanIp(input.client.ip ?? null);
  if (ip) user_data.client_ip_address = ip;
  if (isValidFbp(input.client.fbp)) user_data.fbp = input.client.fbp;
  if (isValidFbc(input.client.fbc)) user_data.fbc = input.client.fbc;

  const event: CapiEvent = {
    event_name: input.event,
    event_time: time,
    event_id: input.eventId,
    event_source_url: withoutQuery(input.sourceUrl),
    action_source: 'website',
    user_data,
  };
  if (carriesValue(input.event) && typeof input.valuePence === 'number' && Number.isFinite(input.valuePence) && input.valuePence > 0) {
    event.custom_data = { value: penceToValue(input.valuePence), currency: 'GBP' };
  }
  return { ok: true, event };
}

export interface SendResult {
  ok: boolean;
  status: number | null;
  /** Short and safe to store: never the token. */
  note: string;
}

function scrub(text: string, token: string): string {
  // Real tokens are long; a short one would only mangle ordinary words.
  const safe = token && token.length >= 8 ? text.split(token).join('[token]') : text;
  return safe.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * POST the events to the dataset. The token and the test event code go in
 * the form body (Meta's documented field names), never in the address.
 */
export async function sendCapi(opts: {
  pixelId: string;
  token: string;
  testCode: string | null;
  events: CapiEvent[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
}): Promise<SendResult> {
  const log = opts.log ?? ((m: string) => console.warn(m));
  if (opts.events.length === 0) return { ok: false, status: null, note: 'nothing_to_send' };
  if (opts.dryRun) {
    log(`[meta] dry run: would send ${opts.events.map((e) => e.event_name).join(', ')}${opts.testCode ? ' (test events)' : ''}`);
    return { ok: true, status: null, note: 'dry_run' };
  }
  const body = new URLSearchParams();
  body.set('data', JSON.stringify(opts.events));
  body.set('access_token', opts.token);
  if (opts.testCode) body.set('test_event_code', opts.testCode);
  const url = `https://graph.facebook.com/${TRACKING.graphApiVersion}/${encodeURIComponent(opts.pixelId)}/events`;
  // An explicit timer (cleared below) rather than AbortSignal.timeout, whose
  // timer does not keep the process alive and so can leave the call hanging.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? TRACKING.capiTimeoutMs);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { method: 'POST', body, signal: controller.signal });
    if (res.ok) return { ok: true, status: res.status, note: opts.testCode ? 'sent_test' : 'sent' };
    let detail = '';
    try {
      const json = (await res.json()) as { error?: { message?: string; error_user_msg?: string } };
      detail = json?.error?.error_user_msg || json?.error?.message || '';
    } catch {
      /* not JSON */
    }
    const note = scrub(`http_${res.status}${detail ? `: ${detail}` : ''}`, opts.token);
    log(`[meta] conversions API refused ${opts.events.map((e) => e.event_name).join(', ')}: ${note}`);
    return { ok: false, status: res.status, note };
  } catch (err) {
    const e = err as Error & { name?: string };
    const note = timedOut || e?.name === 'TimeoutError' ? 'timeout' : scrub(`network: ${e?.message ?? String(err)}`, opts.token);
    log(`[meta] conversions API not reached: ${note}`);
    return { ok: false, status: null, note };
  } finally {
    clearTimeout(timer);
  }
}
