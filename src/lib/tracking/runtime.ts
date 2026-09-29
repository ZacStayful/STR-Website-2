/**
 * What happens in the browser after each page and each cookie choice
 * (Batch 19). TrackingRoot calls in; nothing runs on import.
 *
 * After every page (once it has settled, so the page and the visit heartbeat
 * have read their own address first):
 *   1. On white-label, admin, token and unknown pages, and inside a frame:
 *      nothing at all.
 *   2. The address is tidied: tracking tags and the page's one-shot flags go
 *      (surfaces.ts). A return from Stripe is noticed first.
 *   3. A signed-in member on a device that has accepted or not chosen yet:
 *      /api/tracking/me brings the device and the member into line, and says
 *      whether they count, their hashed details and conversions to fire
 *      (asked at most every 30 s on route changes).
 *   4. With Accept, on a production build with a dataset: the pixel loads
 *      (only on a clean page on the PageView list), a PageView goes, and
 *      each pending conversion is claimed and fired with the server's id.
 *
 * Also checked: after the app's credit-changed event (a top-up, the £5
 * profile credit, a report) at 0, 2, 5 and 10 s; every 3 s for 30 s after a
 * Stripe return; and straight after an Accept is saved.
 *
 * A signed-in member's lookup holds the banner back until it answers, so a
 * member who chose on another device is not asked again (memberLookupPending).
 *
 * Before tidying, each page's address is also read for sign-up attribution
 * (touch.ts), kept in page memory whatever the choice.
 */
import { CREDIT_CHANGED_EVENT } from '../credit/client';
import { canSendNow, loadPixel, pixelState, revokePixel, sendConversion, sendPageView, silencePixel } from '../meta/pixel';
import { TRACKING } from './config';
import { parseConsent, type Choice } from './consent';
import { CONSENT_CHANGED_EVENT, clearMetaCookies, hasSessionCookie, isFramed, notifyConsentChanged, readConsentRaw } from './browser';
import { parseBrowserConversion, parseMeAnswer, type BrowserConversion, type MeAnswer } from './me';
import { isCleanForSend, isStripeReturn, surfaceFor, tidiedHref } from './surfaces';
import { isTagged, keepFirst, serializeTouch, touchFromPage, type Touch } from './touch';

export interface TrackingConfig {
  /** A dataset id is set: the banner may ask. */
  bannerOn: boolean;
  /** The dataset id, on a production build only: the pixel may load. */
  pixelId: string | null;
}

let config: TrackingConfig = { bannerOn: false, pixelId: null };
let nav = 0;
let pageViewNav = -1;
let me: MeAnswer | null = null;
let meAt = 0;
let meInFlight: Promise<MeAnswer | null> | null = null;
let lookupSettled = false;
let lastChoice: Choice | null = null;
// Sign-up attribution, in page memory only (touch.ts): the first touch of
// this page load, carried to sign-up by the form and Google's return
// address. Kept on the device (/api/tracking/touch) only after Accept.
let touch: Touch | null = null;
let touchValue = '';
let touchKept = false;
let creditTimers: ReturnType<typeof setTimeout>[] = [];
let stripeTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
// Claimed on this page load: never claimed twice. Claimed but not yet sent
// (the address was not clean at that moment): sent at the next clean page.
const claimedKeys = new Set<string>();
const unsent = new Map<string, BrowserConversion>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeTracking(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** This page load's touch, ready to carry to sign-up ('' when there is none). */
export function currentTouchValue(): string {
  return touchValue;
}

function capture(href: string): void {
  let referrer = '';
  try {
    referrer = document.referrer;
  } catch {
    /* no referrer */
  }
  const next = keepFirst(touch, touchFromPage(href, referrer, Date.now()));
  if (next === touch) return;
  touch = next;
  touchValue = next ? serializeTouch(next) : '';
  emit();
}

/** With Accept: a tagged touch is kept on the device for 30 days (once per page load). */
function keepTouchIfAccepted(): void {
  if (touchKept || !config.bannerOn || !isTagged(touch) || parseConsent(readConsentRaw())?.choice !== 'accept') return;
  touchKept = true;
  postJson('/api/tracking/touch', { t: touchValue }).catch(() => {
    touchKept = false;
  });
}

/** The banner waits while a signed-in member's saved choice is looked up. */
export function memberLookupPending(bannerOn: boolean): boolean {
  if (!bannerOn || lookupSettled) return false;
  return parseConsent(readConsentRaw()) === null && hasSessionCookie();
}

function settleLookup(): void {
  if (lookupSettled) return;
  lookupSettled = true;
  emit();
}

const REQUEST_TIMEOUT_MS = 8000;

async function postJson(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** A signed-in member on an accepting device of a production build: worth checking for conversions. */
function measuringMember(): boolean {
  return config.pixelId !== null && hasSessionCookie() && parseConsent(readConsentRaw())?.choice === 'accept';
}

function lookup(): Promise<MeAnswer | null> {
  if (meInFlight) return meInFlight;
  meInFlight = (async () => {
    try {
      const answer = parseMeAnswer(await postJson('/api/tracking/me', {}));
      if (answer) {
        me = answer;
        meAt = Date.now();
        if (answer.deviceUpdated) notifyConsentChanged();
      }
      return answer;
    } catch {
      return null;
    } finally {
      meInFlight = null;
      settleLookup();
    }
  })();
  return meInFlight;
}

async function claim(key: string): Promise<BrowserConversion | null | 'retry'> {
  try {
    const data = (await postJson('/api/tracking/claim', { key })) as { claimed?: unknown };
    return parseBrowserConversion(data?.claimed);
  } catch {
    return 'retry';
  }
}

function stopTimers(): void {
  for (const t of creditTimers) clearTimeout(t);
  creditTimers = [];
  if (stripeTimer) clearInterval(stripeTimer);
  stripeTimer = null;
}

function startStripePoll(): void {
  if (stripeTimer) clearInterval(stripeTimer);
  const until = Date.now() + TRACKING.stripeReturnPollForMs;
  stripeTimer = setInterval(() => {
    if (Date.now() > until) {
      if (stripeTimer) clearInterval(stripeTimer);
      stripeTimer = null;
      return;
    }
    void refresh(nav, true);
  }, TRACKING.stripeReturnPollMs);
}

/** Fire what can be fired now: earlier claims first, then new ones. */
async function firePending(mine: number, list: BrowserConversion[]): Promise<void> {
  for (const [key, c] of unsent) {
    if (sendConversion(c)) unsent.delete(key);
  }
  for (const c of list) {
    if (claimedKeys.has(c.key)) continue;
    if (mine !== nav || !canSendNow()) return;
    claimedKeys.add(c.key);
    const got = await claim(c.key);
    if (got === 'retry') {
      claimedKeys.delete(c.key);
      continue;
    }
    if (!got) continue;
    if (!sendConversion(got)) unsent.set(got.key, got);
    else if ((got.name === 'Purchase' || got.name === 'Subscribe') && stripeTimer) {
      clearInterval(stripeTimer);
      stripeTimer = null;
    }
  }
}

/** With Accept: load the pixel if this page allows it, then PageView and conversions. */
async function act(mine: number): Promise<void> {
  const device = parseConsent(readConsentRaw());
  const pixelId = config.pixelId;
  if (!device || device.choice !== 'accept' || !pixelId) return;

  const signedIn = hasSessionCookie();
  if (signedIn && !me) return; // not known yet (or the lookup failed): send nothing
  const member = signedIn && me?.signedIn ? me : null;
  // Started for a member who has since signed out in this tab, or for someone else.
  const startedFor = pixelState().initialisedAs;
  if (startedFor && startedFor !== member?.who) silencePixel();
  // A member whose saved choice is not Accept, or who never counts (admin, staff, switched off, team seat).
  if (member && (member.choice !== 'accept' || member.excluded)) silencePixel();

  const state = pixelState();
  if (state.silent || state.status === 'failed') return;
  if (state.status === 'idle') {
    // Only ever started on a clean page on the PageView list.
    if (surfaceFor(window.location.pathname) !== 'tracked' || !isCleanForSend(window.location.href)) return;
    if (!(await loadPixel(pixelId, member?.pixel ?? null))) return;
  } else if (state.status === 'loading') {
    if (!(await loadPixel(pixelId, null))) return;
  }
  if (mine !== nav) return;

  if (pageViewNav !== mine && sendPageView()) pageViewNav = mine;
  if (member?.pixel) await firePending(mine, member.pending);
}

async function refresh(mine: number, force: boolean): Promise<void> {
  if (!config.bannerOn) return;
  const device = parseConsent(readConsentRaw());
  if (!hasSessionCookie()) {
    me = null;
    settleLookup();
  } else if (!device || device.choice === 'accept') {
    const stale = !me || Date.now() - meAt > TRACKING.pendingRecheckSeconds * 1000;
    if (force || stale) await lookup();
  } else {
    settleLookup();
  }
  if (mine !== nav) return; // a newer page will act
  await act(mine);
}

function settle(mine: number): void {
  if (mine !== nav) return;
  let stripe = false;
  try {
    const href = window.location.href;
    stripe = isStripeReturn(href);
    capture(href);
    const tidy = tidiedHref(href);
    if (tidy && tidy !== href) window.history.replaceState(null, '', tidy);
  } catch {
    /* the address stays as it was: nothing is sent from it */
  }
  if (stripe && measuringMember()) startStripePoll();
  keepTouchIfAccepted();
  void refresh(mine, false);
}

/** Every page, including the first. */
export function navigate(pathname: string, next: TrackingConfig): void {
  config = next;
  nav += 1;
  const mine = nav;
  if (isFramed() || surfaceFor(pathname) === 'none') return;
  setTimeout(() => settle(mine), 0);
}

/** A choice saved on the server (the banner or Cookie settings). */
export function consentSaved(choice: Choice): void {
  if (choice === 'accept') void refresh(nav, true);
}

function onConsentChanged(): void {
  const choice = parseConsent(readConsentRaw())?.choice ?? null;
  if (choice === lastChoice) return;
  lastChoice = choice;
  if (choice === 'reject') {
    revokePixel();
    clearMetaCookies();
    stopTimers();
    unsent.clear();
    return;
  }
  if (choice === 'accept') keepTouchIfAccepted();
  // Anonymous visitors need nothing from the server: start straight away.
  // A member waits for the choice to be saved (consentSaved), so the server
  // has it, and any conversion it released, before we ask.
  if (choice === 'accept' && !hasSessionCookie()) void refresh(nav, true);
}

function onCreditChanged(): void {
  if (!measuringMember()) return;
  for (const t of creditTimers) clearTimeout(t);
  creditTimers = TRACKING.creditChangedRetriesMs.map((ms) => setTimeout(() => void refresh(nav, true), ms));
}

/** Listen for choices and credit changes; the returned function stops it all. */
export function startTracking(): () => void {
  if (typeof window === 'undefined') return () => {};
  lastChoice = parseConsent(readConsentRaw())?.choice ?? null;
  window.addEventListener(CONSENT_CHANGED_EVENT, onConsentChanged);
  window.addEventListener(CREDIT_CHANGED_EVENT, onCreditChanged);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onConsentChanged);
    window.removeEventListener(CREDIT_CHANGED_EVENT, onCreditChanged);
    stopTimers();
  };
}
