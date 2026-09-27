/**
 * The rules the visit heartbeat follows in the browser
 * (src/components/activity/VisitHeartbeat.tsx), kept here so they are tested.
 *
 * It sends only: what happened (a page load, a navigation, still here, back,
 * leaving), how many pages were opened since the last send, whether the
 * member arrived from our email or text, and when Today, a deal or a saved
 * report is on screen, which one. Never a path, page content or what was
 * typed; no cookie, no storage.
 *
 * Pure: no network, no DOM, no server-only.
 */

/** A beat while the tab is shown and in use. */
export const BEAT_MS = 60_000;
/** No click, key, scroll or touch for this long and the beats stop. */
export const IDLE_MS = 5 * 60_000;
/** How often a mouse move may count as the member being there (it fires constantly). */
export const MOVE_THROTTLE_MS = 10_000;

export type PingKind = 'load' | 'page' | 'beat' | 'resume' | 'hide';
export type View = { type: 'today' } | { type: 'deal'; id: string } | { type: 'report'; id: string };
export type Via = 'email' | 'sms';

export interface Ping {
  kind: PingKind;
  pages?: number;
  via?: Via;
  view?: View;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today, a deal page or a saved report, from the path; null for any other page. */
export function viewFor(pathname: string | null | undefined): View | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/today') return { type: 'today' };
  const deal = /^\/deals\/([^/]+)$/.exec(path);
  if (deal && UUID.test(deal[1])) return { type: 'deal', id: deal[1].toLowerCase() };
  const report = /^\/reports\/([^/]+)$/.exec(path);
  if (report && UUID.test(report[1])) return { type: 'report', id: report[1].toLowerCase() };
  return null;
}

/** 'email' or 'sms' when the page was reached from one of our links (?via=). */
export function viaFrom(search: string | null | undefined): Via | null {
  if (!search) return null;
  const v = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('via');
  return v === 'email' || v === 'sms' ? v : null;
}

/**
 * The address without its ?via=, or null when there is none to take off. The
 * heartbeat puts this in the address bar, so a reload, a bookmark or a copied
 * link is not counted as another click from the email.
 */
export function withoutVia(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!url.searchParams.has('via')) return null;
  url.searchParams.delete('via');
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * `url` marked as reached from our email or text (?via=), so the heartbeat
 * can count the click. Only our own pages are marked: a link anywhere else
 * (a listing on a portal), a pick answer (/p/…, which is its own record), an
 * API address (unsubscribe), or a link already marked comes back unchanged.
 * `site` is the site's base URL. The rest of the link is left exactly as it
 * was.
 */
export function withVia(url: string, via: Via, site: string): string {
  let target: URL;
  let origin: string;
  try {
    target = new URL(url);
    origin = new URL(site).origin;
  } catch {
    return url;
  }
  if (target.origin !== origin || /^\/(p|api)\//.test(target.pathname) || target.searchParams.has('via')) return url;
  const cut = url.indexOf('#');
  const head = cut === -1 ? url : url.slice(0, cut);
  const hash = cut === -1 ? '' : url.slice(cut);
  const joiner = head.endsWith('?') || head.endsWith('&') ? '' : head.includes('?') ? '&' : '?';
  return `${head}${joiner}via=${via}${hash}`;
}

export function isIdle(lastInteraction: number, now: number): boolean {
  return now - lastInteraction >= IDLE_MS;
}

/** A beat is due every minute while the tab is shown and in use. */
export function beatDue(s: { visible: boolean; lastInteraction: number; lastSent: number }, now: number): boolean {
  return s.visible && !isIdle(s.lastInteraction, now) && now - s.lastSent >= BEAT_MS - 1_000;
}

/** A closing beat only after recent use, so time nobody was there never lengthens a visit. */
export function hideWorthSending(lastInteraction: number, now: number): boolean {
  return !isIdle(lastInteraction, now);
}

/** A ping as the server reads it, from what the browser has. */
export function pingBody(kind: PingKind, opts: { pages?: number; via?: Via | null; view?: View | null } = {}): Ping {
  const body: Ping = { kind };
  if (opts.pages && opts.pages > 0) body.pages = Math.min(Math.floor(opts.pages), 50);
  if (opts.via) body.via = opts.via;
  if (opts.view) body.view = opts.view;
  return body;
}

/** A ping from the network, checked; null when it is not one. */
export function parsePing(raw: unknown): Ping | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kinds: readonly string[] = ['load', 'page', 'beat', 'resume', 'hide'];
  if (typeof r.kind !== 'string' || !kinds.includes(r.kind)) return null;
  const ping: Ping = { kind: r.kind as PingKind };
  if (typeof r.pages === 'number' && Number.isFinite(r.pages) && r.pages > 0) ping.pages = Math.min(Math.floor(r.pages), 50);
  if (r.via === 'email' || r.via === 'sms') ping.via = r.via;
  const v = r.view as Record<string, unknown> | undefined;
  if (v && typeof v === 'object') {
    if (v.type === 'today') ping.view = { type: 'today' };
    else if ((v.type === 'deal' || v.type === 'report') && typeof v.id === 'string' && UUID.test(v.id)) ping.view = { type: v.type, id: v.id.toLowerCase() };
  }
  return ping;
}
