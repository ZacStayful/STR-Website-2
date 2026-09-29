/**
 * Browser-side helpers for cookie consent (Batch 19). Everything here touches
 * the page only when called, never on import, so server code may import the
 * constants safely.
 *
 *   openCookieSettings()  any "Cookie settings" link calls it; the one
 *                         TrackingRoot on the page reopens the banner (the
 *                         same pattern as openFeedback, src/lib/feedback/client.ts)
 *   chooseConsent()       remember a choice on the device at once, tell the
 *                         page, and record it on the server (/api/consent)
 *   clearMetaCookies()    delete _fbp and _fbc on the host and every parent
 *                         domain (the pixel keeps them on .stayful.co.uk)
 *
 * Nothing here throws: a blocked cookie or a failed request leaves the page
 * exactly as it was.
 */
import { TRACKING } from './config';
import { consentMaxAgeSeconds, serializeConsent, type Choice, type ConsentSource, type DeviceConsent } from './consent';
import { cookieDomainsFor } from '../meta/fbc';

export const CONSENT_CHANGED_EVENT = 'stayful:consent-changed';
export const OPEN_COOKIE_SETTINGS_EVENT = 'stayful:cookie-settings';

function hasDocument(): boolean {
  return typeof document !== 'undefined';
}

/** A cookie's raw value, or '' when it is not there. */
export function readCookie(name: string): string {
  if (!hasDocument()) return '';
  try {
    for (const part of document.cookie.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
  } catch {
    /* cookies blocked */
  }
  return '';
}

/** The consent cookie's raw value: a plain string, so it is a stable snapshot for useSyncExternalStore. */
export function readConsentRaw(): string {
  return readCookie(TRACKING.consentCookie);
}

export function subscribeConsent(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
}

export function notifyConsentChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

export function openCookieSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}

function secureFlag(): string {
  return typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
}

/** Remember a choice on this device straight away (the server writes it again). */
export function writeDeviceConsent(c: DeviceConsent): void {
  if (!hasDocument()) return;
  try {
    document.cookie = `${TRACKING.consentCookie}=${serializeConsent(c)}; Max-Age=${consentMaxAgeSeconds()}; Path=/; SameSite=Lax${secureFlag()}`;
  } catch {
    /* cookies blocked: the banner will simply ask again */
  }
}

/** Delete Meta's cookies wherever they may be: this host and every parent domain. */
export function clearMetaCookies(): void {
  if (!hasDocument()) return;
  const domains = typeof location !== 'undefined' ? cookieDomainsFor(location.hostname) : [];
  for (const name of [TRACKING.fbpCookie, TRACKING.fbcCookie]) {
    try {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
      for (const d of domains) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${d}`;
    } catch {
      /* cookies blocked: nothing to clear */
    }
  }
}

export function newVisitorId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Very old browsers: a v4-shaped id from Math.random is enough to tie a choice to its proof.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/** A Supabase session cookie is present: probably signed in (checked properly on the server). */
export function hasSessionCookie(): boolean {
  if (!hasDocument()) return false;
  try {
    return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie);
  } catch {
    return false;
  }
}

/** Inside a frame (a funnel embedded on someone else's site, a preview): do nothing at all. */
export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/**
 * A choice: remembered on this device at once, the page told, and the proof
 * recorded on the server. Resolves once the server has answered (or failed).
 */
export async function chooseConsent(choice: Choice, source: ConsentSource, visitorId: string): Promise<void> {
  writeDeviceConsent({ choice, at: new Date(), visitorId, version: TRACKING.consentVersion });
  if (choice === 'reject') clearMetaCookies();
  notifyConsentChanged();
  try {
    await fetch('/api/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice, source }),
      keepalive: true,
    });
  } catch {
    /* offline: the device still remembers the choice */
  }
  // The server may have rewritten the cookie (same choice, its own time).
  notifyConsentChanged();
}
