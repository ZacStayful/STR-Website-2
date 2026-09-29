/**
 * What Batch 19's routes read from a request.
 *
 *   isSameOriginJson  consent, touch and claim requests must come from our own
 *                     pages: route handlers have no built-in CSRF protection,
 *                     so another site must not be able to post "Accept" into a
 *                     visitor's browser.
 *   clientDetails     the browser behind a request (IP, user agent, _fbp,
 *                     _fbc) for a Conversions API event. Only ever read from
 *                     the member's own request, never from Stripe's webhook.
 *
 * Pure: works on the standard Request and Headers objects, nothing else.
 */
import { TRACKING } from './config.ts';
import { ipFromForwardedFor, type ClientDetails } from '../meta/capi.ts';
import { isValidFbc, isValidFbp } from '../meta/fbc.ts';

type HeaderSource = { get(name: string): string | null };

/** A POST from one of our own pages, with a JSON body. */
export function isSameOriginJson(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return false;
  return isSameOrigin(request.headers);
}

export function isSameOrigin(headers: HeaderSource): boolean {
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(',')[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

/** One cookie's value from a Cookie header. */
export function cookieFrom(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** The browser behind a request: its IP (first x-forwarded-for entry), user agent and Meta cookies. */
export function clientDetails(headers: HeaderSource): ClientDetails {
  const cookie = headers.get('cookie');
  const fbp = cookieFrom(cookie, TRACKING.fbpCookie);
  const fbc = cookieFrom(cookie, TRACKING.fbcCookie);
  const ua = headers.get('user-agent');
  return {
    ip: ipFromForwardedFor(headers.get('x-forwarded-for')) ?? ipFromForwardedFor(headers.get('x-real-ip')),
    userAgent: ua ? ua.slice(0, 512) : null,
    fbp: isValidFbp(fbp) ? fbp : null,
    fbc: isValidFbc(fbc) ? fbc : null,
  };
}
