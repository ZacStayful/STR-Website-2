/**
 * Cookie consent: the essential cookie that remembers a choice, and the rules
 * for when to ask.
 *
 * The cookie (config.ts: TRACKING.consentCookie) holds four things, joined by
 * dots so no character needs escaping: the choice (a or r), when it was made
 * (unix seconds), a random device id (to tie the choice to its proof, and to
 * the member if they sign up here) and the wording version they saw.
 *
 *     a.1790000000.8f14e45f-ceea-467a-9c3b-1a2b3c4d5e6f.cookie-v1
 *
 * A member's choice is also saved against them (member_consent). The newer of
 * the device's and the member's choice wins, so a member is asked once, not
 * once per device.
 *
 * Pure: no network, no database, no server-only.
 */
import { TRACKING } from './config.ts';

export type Choice = 'accept' | 'reject';
export type ConsentSource = 'banner' | 'signup' | 'settings';

export interface DeviceConsent {
  choice: Choice;
  at: Date;
  visitorId: string;
  version: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVisitorId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function isChoice(v: unknown): v is Choice {
  return v === 'accept' || v === 'reject';
}

export function isConsentSource(v: unknown): v is ConsentSource {
  return v === 'banner' || v === 'signup' || v === 'settings';
}

export function serializeConsent(c: DeviceConsent): string {
  return `${c.choice === 'accept' ? 'a' : 'r'}.${Math.floor(c.at.getTime() / 1000)}.${c.visitorId.toLowerCase()}.${c.version}`;
}

/** The cookie's value read back, or null when it is missing or not ours. */
export function parseConsent(value: string | null | undefined): DeviceConsent | null {
  if (typeof value !== 'string' || !value) return null;
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    /* keep it as it is */
  }
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const [c, secs, visitorId, version] = parts;
  if (c !== 'a' && c !== 'r') return null;
  if (!/^\d{9,11}$/.test(secs)) return null;
  if (!isVisitorId(visitorId)) return null;
  if (!/^[a-z0-9-]{1,40}$/.test(version)) return null;
  return { choice: c === 'a' ? 'accept' : 'reject', at: new Date(Number(secs) * 1000), visitorId: visitorId.toLowerCase(), version };
}

/** The consent cookie's value inside a Cookie header or document.cookie. */
export function consentFromCookieString(cookies: string | null | undefined): DeviceConsent | null {
  if (!cookies) return null;
  const name = TRACKING.consentCookie;
  for (const part of cookies.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return parseConsent(part.slice(i + 1).trim());
  }
  return null;
}

export function consentMaxAgeSeconds(): number {
  return TRACKING.consentDays * 24 * 60 * 60;
}

/** A member's saved choice, as the server keeps it. */
export interface MemberConsent {
  choice: Choice;
  chosenAt: Date;
}

/**
 * Which side should follow the other: the newer choice wins. 'device' means
 * the member's saved choice should take the device's; 'member' means the
 * device should take the member's.
 */
export function reconcile(device: DeviceConsent | null, member: MemberConsent | null): 'device' | 'member' | 'same' | 'none' {
  if (!device && !member) return 'none';
  if (device && !member) return 'device';
  if (!device && member) return 'member';
  const d = device!.at.getTime();
  const m = member!.chosenAt.getTime();
  // The cookie keeps whole seconds; the same choice within a second is the same choice.
  if (device!.choice === member!.choice && Math.abs(d - m) < 2000) return 'same';
  return d > m ? 'device' : 'member';
}

/** The second-chance checkbox shows while nobody has said yes: no choice yet, or Reject. */
export function secondChanceShown(choice: Choice | null | undefined): boolean {
  return choice !== 'accept';
}

/**
 * The quiz's start screen offers it to a new Google sign-up, who never saw
 * the sign-up form's checkbox: once (the start screen only shows before the
 * first answer), never to a team seat, while neither this device nor the
 * account has said yes.
 */
export function quizCheckboxShown(s: { enabled: boolean; fresh: boolean; google: boolean; teamSeat: boolean; memberChoice: Choice | null; deviceChoice: Choice | null }): boolean {
  return s.enabled && s.fresh && s.google && !s.teamSeat && secondChanceShown(s.memberChoice) && secondChanceShown(s.deviceChoice);
}

/**
 * Whether the banner is on screen. Always when Cookie settings reopened it;
 * otherwise only where there is something to ask about, before a choice, and
 * not after it was closed without one on this page load. While a signed-in
 * member's saved choice is being looked up it waits, so it never flashes.
 */
export function bannerShown(s: {
  enabled: boolean;
  surface: 'tracked' | 'banner' | 'none';
  choice: Choice | null;
  dismissed: boolean;
  settingsOpen: boolean;
  lookingUp: boolean;
}): boolean {
  if (!s.enabled || s.surface === 'none') return false;
  if (s.settingsOpen) return true;
  if (s.lookingUp || s.dismissed) return false;
  return s.choice === null;
}
