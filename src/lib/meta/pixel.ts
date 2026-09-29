/**
 * Meta's pixel in the browser (Batch 19): loading it, and the only two
 * things it is ever asked to do, a PageView and a conversion.
 * src/lib/tracking/runtime.ts decides when; this file makes sure nothing is
 * sent unless it is safe at that moment.
 *
 *   - fbevents.js is added by hand once the visitor has accepted, never by
 *     the standard snippet (whose automatic PageView and <noscript> image
 *     would send before any choice).
 *   - Before init: no automatic PageView on route changes (disablePushState)
 *     and no automatic events or page metadata (autoConfig off). Automatic
 *     advanced matching is a dataset setting in Events Manager and must be
 *     switched off there (README deploy step 15).
 *   - init gets the member's hashed email and hashed account number, or
 *     nothing: never a name, phone or address.
 *   - Nothing is called until the script has loaded (queued calls are sent
 *     with whatever address is current when the script arrives), and every
 *     call checks the live address first (isCleanForSend): the pixel sends
 *     the whole address bar with every event.
 *   - After a Reject, or when the member behind it changes, it goes silent
 *     until the next full page load.
 *
 * Nothing here throws, and nothing runs on import.
 */
import { isCleanForSend } from '../tracking/surfaces';
import { browserParams, isCustomEvent, type MetaEventName } from './events';

const SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js';
const LOAD_TIMEOUT_MS = 15_000;

type Fbq = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
  allowDuplicatePageViews?: boolean;
};

type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq };

/** What init is given: both values are SHA-256 hashes made on the server. */
export interface PixelIdentity {
  em: string | null;
  external_id: string;
}

type Status = 'idle' | 'loading' | 'ready' | 'failed';

let status: Status = 'idle';
let silent = false;
let initialisedAs: string | null = null;
let loading: Promise<boolean> | null = null;

export function pixelState(): { status: Status; silent: boolean; initialisedAs: string | null } {
  return { status, silent, initialisedAs };
}

/**
 * Load the pixel once. Resolves true when fbevents.js has loaded, false when
 * it could not (blocked, offline, too slow) or another pixel is already on
 * the page (then ours stays out of its way and sends nothing).
 */
export function loadPixel(pixelId: string, identity: PixelIdentity | null): Promise<boolean> {
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (ok) status = 'ready';
      else if (status !== 'ready') status = 'failed';
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const w = window as PixelWindow;
      if (w.fbq) {
        done(false);
        return;
      }
      const fbq = function (...args: unknown[]) {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue.push(args);
      } as Fbq;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      fbq.disablePushState = true;
      fbq.allowDuplicatePageViews = true;
      w.fbq = fbq;
      if (!w._fbq) w._fbq = fbq;
      fbq('set', 'autoConfig', false, pixelId);
      if (identity) fbq('init', pixelId, identity.em ? { em: identity.em, external_id: identity.external_id } : { external_id: identity.external_id });
      else fbq('init', pixelId);
      initialisedAs = identity?.external_id ?? null;
      status = 'loading';
      const script = document.createElement('script');
      script.async = true;
      script.src = SCRIPT_SRC;
      const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);
      script.onload = () => {
        clearTimeout(timer);
        done(typeof fbq.callMethod === 'function');
      };
      script.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
      document.head.appendChild(script);
    } catch {
      done(false);
    }
  });
  return loading;
}

/** The pixel has loaded, has not been silenced, and the live address may be sent. */
export function canSendNow(): boolean {
  if (status !== 'ready' || silent || typeof window === 'undefined') return false;
  try {
    return isCleanForSend(window.location.href);
  } catch {
    return false;
  }
}

function call(...args: unknown[]): boolean {
  if (!canSendNow()) return false;
  try {
    (window as PixelWindow).fbq?.(...args);
    return true;
  } catch {
    return false;
  }
}

export function sendPageView(): boolean {
  return call('track', 'PageView');
}

/** A conversion, with the server's event id so Meta keeps one of the two copies. */
export function sendConversion(c: { name: MetaEventName; eventId: string; valuePence: number | null }): boolean {
  return call(isCustomEvent(c.name) ? 'trackCustom' : 'track', c.name, browserParams(c.name, c.valuePence), { eventID: c.eventId });
}

/** Reject or withdrawal: tell the pixel, and send nothing more on this page load. */
export function revokePixel(): void {
  silent = true;
  if (status === 'idle' || status === 'failed') return;
  try {
    (window as PixelWindow).fbq?.('consent', 'revoke');
  } catch {
    /* nothing more to do */
  }
}

/** The member behind the pixel changed, or no longer counts: nothing more until a full page load. */
export function silencePixel(): void {
  silent = true;
}
