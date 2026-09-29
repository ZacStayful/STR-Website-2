/**
 * Sign-up attribution (Batch 19): which ad or link brought someone here.
 *
 * A "touch" is read from the landing address before it is tidied: the utm
 * tags, Meta's click id (fbclid) with when it was seen, the landing path
 * (ids and tokens blanked, never a query) and the referring site's domain
 * (blank for our own site). When an ad points at a members' page, the proxy
 * sends the visitor to sign in with the address inside ?redirect= (or
 * ?next=), so the tags are read from there too. Never on white-label, admin
 * or token pages.
 *
 * It travels in one compact form (serializeTouch): in page memory, in a
 * hidden sign-up field, on Google's return address and, after Accept only,
 * in the httpOnly sf_attr cookie (30 days). First touch wins: a tagged touch
 * is never replaced; an untagged one gives way to a tagged one.
 *
 * Pure: no network, no database, no server-only.
 */
import { surfaceFor } from './surfaces.ts';
import { cleanFbclid } from '../meta/fbc.ts';

export interface Touch {
  src: string | null;
  med: string | null;
  cmp: string | null;
  cnt: string | null;
  trm: string | null;
  fbclid: string | null;
  /** When the click id was first seen (ms): Meta's fbc carries it. */
  fbAt: number | null;
  /** The landing path, no query, ids and tokens blanked. */
  lp: string | null;
  /** The referring site's domain, blank for our own. */
  ref: string | null;
  /** When the touch was read (ms). */
  at: number;
}

export type CapturedVia = 'form' | 'cookie' | 'redirect' | 'none';

const UTM: ReadonlyArray<[keyof Touch, string]> = [
  ['src', 'utm_source'],
  ['med', 'utm_medium'],
  ['cmp', 'utm_campaign'],
  ['cnt', 'utm_content'],
  ['trm', 'utm_term'],
];
const MAX_VALUE = 200;
const MAX_PATH = 200;
const MAX_DOMAIN = 100;
const MAX_SERIALIZED = 2000;

/** Trimmed, control characters out, capped; '' becomes null. */
export function cleanValue(v: unknown, max: number = MAX_VALUE): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s ? s : null;
}

// A path segment that is an id or a token, not a word: blanked.
function isIdLike(segment: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^\d{4,}$/.test(segment)) return true;
  if (segment.length >= 16 && /\d/.test(segment) && !/^[a-z]+(?:-[a-z]+)*$/.test(segment)) return true;
  return segment.length >= 24;
}

// Pages whose next segment is always a token or an id, whatever it looks like.
const TOKEN_PARENTS: ReadonlySet<string> = new Set(['d', 'deal', 'p', 'r', 'f', 'm', 'reports', 'join']);

/** The landing path with no query and every id or token replaced by ":id". */
export function cleanLandingPath(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  const bare = path.split(/[?#]/)[0];
  const parts = bare.split('/');
  const segments = parts.map((s, i) => {
    if (i === 0 || s === '') return s;
    if (i >= 2 && TOKEN_PARENTS.has(parts[i - 1])) return ':id';
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      /* keep as sent */
    }
    return isIdLike(decoded) || /[^A-Za-z0-9._~-]/.test(decoded) ? ':id' : decoded;
  });
  return cleanValue(segments.join('/') || '/', MAX_PATH);
}

/** The referring site's domain ("l.facebook.com"), or null for none or our own. */
export function referrerDomain(referrer: string | null | undefined, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === ownHost.toLowerCase().replace(/^www\./, '')) return null;
    return cleanValue(host, MAX_DOMAIN);
  } catch {
    return null;
  }
}

export function isTagged(t: Touch | null | undefined): boolean {
  return !!t && !!(t.src || t.med || t.cmp || t.cnt || t.trm || t.fbclid);
}

function tagsFrom(params: URLSearchParams, now: number): Partial<Touch> {
  const out: Partial<Touch> = {};
  for (const [key, name] of UTM) (out as Record<string, string | null>)[key] = cleanValue(params.get(name));
  const fbclid = cleanFbclid(params.get('fbclid'));
  out.fbclid = fbclid;
  out.fbAt = fbclid ? now : null;
  return out;
}

function hasTags(p: Partial<Touch>): boolean {
  return !!(p.src || p.med || p.cmp || p.cnt || p.trm || p.fbclid);
}

/**
 * The touch this page's address carries, or null on a page that never
 * captures (white-label, admin, token pages, unknown paths).
 */
export function touchFromPage(href: string, referrer: string | null | undefined, now: number): Touch | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (surfaceFor(url.pathname) === 'none') return null;
  let tags = tagsFrom(url.searchParams, now);
  let path = url.pathname;
  if (!hasTags(tags)) {
    // An ad that pointed at a members' page: the proxy moved its address into ?redirect= (or ?next=).
    for (const name of ['redirect', 'next']) {
      const inner = url.searchParams.get(name);
      if (!inner || !inner.startsWith('/') || inner.startsWith('//')) continue;
      try {
        const innerUrl = new URL(inner, url.origin);
        const innerTags = tagsFrom(innerUrl.searchParams, now);
        if (hasTags(innerTags)) {
          tags = innerTags;
          path = innerUrl.pathname;
          break;
        }
      } catch {
        /* not an address */
      }
    }
  }
  return {
    src: tags.src ?? null,
    med: tags.med ?? null,
    cmp: tags.cmp ?? null,
    cnt: tags.cnt ?? null,
    trm: tags.trm ?? null,
    fbclid: tags.fbclid ?? null,
    fbAt: tags.fbAt ?? null,
    lp: cleanLandingPath(path),
    ref: referrerDomain(referrer, url.hostname),
    at: now,
  };
}

/** Page memory: the first touch, unless a later one is tagged and the first was not. */
export function keepFirst(current: Touch | null, next: Touch | null): Touch | null {
  if (!current) return next;
  if (!next) return current;
  return !isTagged(current) && isTagged(next) ? next : current;
}

/**
 * What the sf_attr cookie should become after a tagged landing on an
 * accepted device, or null to leave it: a tagged touch already kept (and not
 * past its 30 days) is never replaced.
 */
export function touchForCookie(existing: Touch | null, next: Touch | null, now: number, days: number): Touch | null {
  if (!next || !isTagged(next)) return null;
  if (existing && isTagged(existing) && now - existing.at < days * 86_400_000) return null;
  return next;
}

function toBase64Url(s: string): string {
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function serializeTouch(t: Touch): string {
  return toBase64Url(JSON.stringify(t));
}

/** A touch from any carrier (cookie, form field, return address), checked and capped; null if unusable. */
export function parseTouch(raw: string | null | undefined, now: number = Date.now()): Touch | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SERIALIZED || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let o: Record<string, unknown>;
  try {
    const v = JSON.parse(fromBase64Url(raw)) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const at = typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0 && o.at <= now + 60_000 ? o.at : null;
  if (at === null) return null;
  const fbclid = cleanFbclid(typeof o.fbclid === 'string' ? o.fbclid : null);
  const fbAt = fbclid && typeof o.fbAt === 'number' && Number.isFinite(o.fbAt) && o.fbAt > 0 && o.fbAt <= now + 60_000 ? o.fbAt : fbclid ? at : null;
  const lp = typeof o.lp === 'string' ? cleanLandingPath(o.lp) : null;
  const ref = typeof o.ref === 'string' && /^[a-z0-9.-]{1,100}$/i.test(o.ref) ? o.ref.toLowerCase() : null;
  return {
    src: cleanValue(o.src),
    med: cleanValue(o.med),
    cmp: cleanValue(o.cmp),
    cnt: cleanValue(o.cnt),
    trm: cleanValue(o.trm),
    fbclid,
    fbAt,
    lp,
    ref,
    at,
  };
}

/**
 * Which touch an account is credited to: the cookie (the older first touch,
 * kept after Accept) beats what the page carried to sign-up.
 */
export function chooseTouch(cookie: Touch | null, carried: Touch | null, carriedVia: 'form' | 'redirect'): { touch: Touch | null; via: CapturedVia } {
  if (cookie) return { touch: cookie, via: 'cookie' };
  if (carried) return { touch: carried, via: carriedVia };
  return { touch: null, via: 'none' };
}

/** The member_attribution row for a new account. Insert-only: an existing row is never overwritten. */
export function attributionRow(input: { userId: string; env: string; method: 'email' | 'google'; teamInvite: boolean; touch: Touch | null; via: CapturedVia }) {
  const t = input.touch;
  return {
    user_id: input.userId,
    env: input.env,
    signup_method: input.method,
    team_invite: input.teamInvite,
    utm_source: t?.src ?? null,
    utm_medium: t?.med ?? null,
    utm_campaign: t?.cmp ?? null,
    utm_content: t?.cnt ?? null,
    utm_term: t?.trm ?? null,
    fbclid: t?.fbclid ?? null,
    fbclid_at: t?.fbclid && t.fbAt ? new Date(t.fbAt).toISOString() : null,
    landing_path: t?.lp ?? null,
    referrer_domain: t?.ref ?? null,
    captured_via: t ? input.via : 'none',
  };
}
