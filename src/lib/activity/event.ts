/**
 * Turning a logActivity call into the one argument activity_log takes, or
 * into nothing when the call is not usable. Every rule about what may go
 * into the log lives here, so it is tested rather than trusted:
 *
 *   - the member id and any deal or profile id must be real uuids
 *   - the kind must be registered (kinds.ts)
 *   - extras are a few small facts. A value must be a number, a boolean,
 *     null, or a short single-word token (or a short list of tokens). Spaces,
 *     slashes and @ are refused, so an address, a sentence, a link or an
 *     email address can never get in; anything that still reads like a web
 *     address or a UK postcode is refused too. A refused value is dropped,
 *     the rest of the event is kept.
 *   - a listing URL may be passed so the database can find the deal; it is
 *     never stored
 *
 * Pure: no network, no database, no server-only.
 */
import { ACTIVITY_KINDS, isActivityKind, type ActivityKind } from './kinds.ts';

export const ACTIVITY_SOURCES = ['web', 'email_link', 'sms_link', 'system', 'extension', 'api'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export type ExtraValue = string | number | boolean | null | readonly string[];

export interface ActivityOptions {
  /** marketplace_deals.id */
  dealId?: string | null;
  /** A listing's canonical URL: the database turns it into the deal id and forgets it. */
  listingUrl?: string | null;
  extras?: Record<string, ExtraValue | undefined>;
  /** The action's own id where it has one; a second event with the same key is ignored. */
  dedupeKey?: string | null;
  /** Default: how the member's visit began (web when there is none). */
  source?: ActivitySource;
  /** When it happened. Default: the moment of the call. */
  at?: Date | string;
  /** Saved profiles (Batch 13). */
  profileId?: string | null;
}

/** How the event relates to the member's visit. */
export type VisitMode = 'extend' | 'attach' | 'none';

/** The jsonb argument of public.activity_log. */
export interface ActivityCall {
  user: string;
  kind: ActivityKind;
  at: string;
  deal?: string;
  listing_url?: string;
  source?: ActivitySource;
  extras: Record<string, ExtraValue>;
  dedupe_key?: string;
  profile?: string;
  visit: VisitMode;
  counted: boolean;
}

export const MAX_EXTRAS_BYTES = 1024;
export const MAX_EXTRA_KEYS = 12;
export const MAX_TOKEN_LENGTH = 80;
export const MAX_LIST_LENGTH = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTRA_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const TOKEN = /^[A-Za-z0-9_.:+-]+$/;
const DEDUPE_KEY = /^[A-Za-z0-9_.:+-]{1,200}$/;
// A domain-looking token: a dot followed by a common top-level domain, or "www".
const WEB = /(^|[^a-z0-9])www\.|\.(co\.uk|org\.uk|ac\.uk|gov\.uk|uk|com|net|org|io|co|app|dev)($|[^a-z])/i;
// A full UK postcode (with or without its space) standing on its own within
// the token, or an outcode that is the whole token ("LS6", "M1", "SW1A").
// Bounded, so a run inside an id ("…e4a2bc…" in a uuid) is not mistaken for one.
const POSTCODE = /(^|[^A-Z0-9])[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}($|[^A-Z0-9])/i;
const OUTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

function tokenOk(v: string): boolean {
  return v.length > 0 && v.length <= MAX_TOKEN_LENGTH && TOKEN.test(v) && !WEB.test(v) && !POSTCODE.test(v) && !OUTCODE.test(v);
}

function cleanValue(v: unknown): ExtraValue | undefined {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return tokenOk(v) ? v : undefined;
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === 'string' && tokenOk(x)).slice(0, MAX_LIST_LENGTH);
    return items;
  }
  return undefined;
}

/**
 * The extras that may be stored: at most twelve keys, each a lower-case word,
 * each value clean (see above), and the whole under 1 KB. Anything else is
 * dropped, never the event.
 */
export function cleanExtras(extras: Record<string, unknown> | null | undefined): Record<string, ExtraValue> {
  const out: Record<string, ExtraValue> = {};
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return out;
  for (const [key, raw] of Object.entries(extras)) {
    if (Object.keys(out).length >= MAX_EXTRA_KEYS) break;
    if (!EXTRA_KEY.test(key)) continue;
    const value = cleanValue(raw);
    if (value === undefined) continue;
    out[key] = value;
  }
  // Over the size limit: drop from the end until it fits.
  const keys = Object.keys(out);
  while (keys.length > 0 && JSON.stringify(out).length > MAX_EXTRAS_BYTES) {
    delete out[keys.pop()!];
  }
  return out;
}

function iso(at: Date | string | undefined, now: Date): string {
  if (at instanceof Date && Number.isFinite(at.getTime())) return at.toISOString();
  if (typeof at === 'string') {
    const t = Date.parse(at);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return now.toISOString();
}

function listingUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2048) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How the event relates to visits:
 *   extend  an in-app action made in a request: it joins the member's open
 *           visit, or starts one if the heartbeat has not (blocked, not yet
 *           arrived), and keeps it open
 *   attach  joins an open visit if there is one (a click from an email, a
 *           webhook, work done after the response)
 *   none    never part of a visit: something the system did by itself
 */
export function visitModeFor(kind: ActivityKind, source: ActivitySource | undefined, background: boolean): VisitMode {
  if (source === 'system') return 'none';
  if (background) return 'attach';
  if (ACTIVITY_KINDS[kind].counted && (source === undefined || source === 'web')) return 'extend';
  return 'attach';
}

/**
 * The activity_log argument for a call, or null when the call cannot be
 * logged (no member, unknown kind). `env` is the deployment ('production',
 * 'preview', 'development'): anything but production is stamped in extras,
 * so the backfill never treats a preview click as the release going live.
 */
export function buildActivityCall(
  userId: unknown,
  kind: unknown,
  opts: ActivityOptions | undefined,
  ctx: { now: Date; env: string; background: boolean },
): ActivityCall | null {
  if (!isUuid(userId) || !isActivityKind(kind)) return null;
  const o = opts ?? {};
  const extras = cleanExtras(o.extras ?? null);
  if (ctx.env !== 'production') extras.env = ctx.env.replace(/[^a-z]/g, '').slice(0, 20) || 'development';
  const source = o.source && (ACTIVITY_SOURCES as readonly string[]).includes(o.source) ? o.source : undefined;
  const call: ActivityCall = {
    user: userId,
    kind,
    at: iso(o.at, ctx.now),
    extras,
    visit: visitModeFor(kind, source, ctx.background),
    counted: ACTIVITY_KINDS[kind].counted,
  };
  if (isUuid(o.dealId)) call.deal = o.dealId;
  const url = listingUrl(o.listingUrl);
  if (!call.deal && url) call.listing_url = url;
  if (source) call.source = source;
  if (typeof o.dedupeKey === 'string' && DEDUPE_KEY.test(o.dedupeKey)) call.dedupe_key = o.dedupeKey;
  if (isUuid(o.profileId)) call.profile = o.profileId;
  return call;
}

/** The My deals key of a marketplace deal ('d-<id>') as its id, or null for a listing ('l-<id>'). */
export function dealIdOfItemKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key.startsWith('d-')) return null;
  const id = key.slice(2);
  return isUuid(id) ? id : null;
}
