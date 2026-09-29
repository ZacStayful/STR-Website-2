/**
 * Announcements (Batch 18): what admin may publish, and which ones a member
 * sees. A member sees an announcement once it is published, if they joined
 * before it was, for billing_settings.announcement_max_age_days, until they
 * dismiss it or tap "Take a look". Several at once are one banner, newest
 * first. Everyone sees them (free, paid and team members alike).
 *
 * Pure: no network, no database, no server-only.
 */
import { LIMITS, isAnnouncementKind, type AnnouncementKind } from './config.ts';
import { cleanLine, cleanText, memberPath } from './rules.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most announcements one banner lists; older ones wait until these are dismissed. */
export const BANNER_MAX = 10;

export interface AnnouncementDraft {
  kind: AnnouncementKind;
  title: string;
  body: string;
  /** A page on this site for "Take a look", or none. */
  linkPath: string | null;
  /** The report numbers (#ref) it answers. */
  reportRefs: number[];
}

export type DraftField = 'kind' | 'title' | 'body' | 'link' | 'refs';

/**
 * "#12, #15" or "12 15" as report numbers, each once, in the order given.
 * Null when anything in it is not a report number.
 */
export function parseRefs(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== 'string') return null;
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const m = /^#?(\d{1,9})$/.exec(p);
    if (!m) return null;
    const n = Number(m[1]);
    if (n < 1) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.length > 20 ? null : out;
}

/** What admin typed, checked field by field, with a line for each problem. */
export function cleanAnnouncement(input: { kind: unknown; title: unknown; body: unknown; link: unknown; refs: unknown }): { ok: true; draft: AnnouncementDraft } | { ok: false; errors: Partial<Record<DraftField, string>> } {
  const errors: Partial<Record<DraftField, string>> = {};
  const kind = isAnnouncementKind(input.kind) ? input.kind : null;
  if (!kind) errors.kind = 'Choose New feature or Bug fix.';
  const title = cleanLine(input.title, LIMITS.announcementTitleMax);
  if (!title.ok) errors.title = title.reason === 'empty' ? 'Give it a title.' : `A title is at most ${LIMITS.announcementTitleMax} characters.`;
  const body = cleanText(input.body, LIMITS.announcementBodyMax);
  if (!body.ok) errors.body = body.reason === 'empty' ? 'Say what’s new in two or three lines.' : `The text is at most ${LIMITS.announcementBodyMax} characters.`;
  const rawLink = typeof input.link === 'string' ? input.link.trim() : '';
  const linkPath = rawLink === '' ? null : memberPath(rawLink);
  if (rawLink !== '' && !linkPath) errors.link = 'A page on this site, starting with / (for example /today).';
  const refs = parseRefs(input.refs);
  if (!refs) errors.refs = 'Report numbers, like #12, #15 (at most 20).';
  if (!kind || !title.ok || !body.ok || errors.link || !refs) return { ok: false, errors };
  return { ok: true, draft: { kind, title: title.text, body: body.text, linkPath, reportRefs: refs } };
}

export interface AnnouncementRow {
  id: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  linkPath: string | null;
  publishedAt: string | null;
  unpublishedAt: string | null;
}

/** What a member's banner shows of an announcement. */
export interface LiveAnnouncement {
  id: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  linkPath: string | null;
  publishedAt: string;
}

export interface ViewState {
  dismissedAt: string | null;
  clickedAt: string | null;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Published, not taken down and within its age: what anyone could still be shown. */
export function isLive(row: Pick<AnnouncementRow, 'publishedAt' | 'unpublishedAt'>, now: Date, maxAgeDays: number): boolean {
  const published = time(row.publishedAt);
  if (published === null || row.unpublishedAt) return false;
  return now.getTime() - published <= maxAgeDays * DAY_MS;
}

/**
 * The announcements this member's banner shows, newest first: live, published
 * after they joined (a member who joined later never sees older news), and
 * neither dismissed nor tapped. A member whose join date is unknown is shown
 * the live ones.
 */
export function visibleAnnouncements(rows: readonly AnnouncementRow[], views: ReadonlyMap<string, ViewState>, member: { createdAt: string | null }, now: Date, maxAgeDays: number): LiveAnnouncement[] {
  const joined = time(member.createdAt);
  return rows
    .filter((r) => isLive(r, now, maxAgeDays))
    .filter((r) => joined === null || (time(r.publishedAt) ?? 0) > joined)
    .filter((r) => {
      const v = views.get(r.id);
      return !v || (!v.dismissedAt && !v.clickedAt);
    })
    .sort((a, b) => (time(b.publishedAt) ?? 0) - (time(a.publishedAt) ?? 0))
    .slice(0, BANNER_MAX)
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, linkPath: r.linkPath, publishedAt: r.publishedAt as string }));
}

export type AnnouncementState = 'draft' | 'live' | 'ended' | 'unpublished';

/** For the admin list: never published, live, past its age, or taken down. */
export function announcementState(row: Pick<AnnouncementRow, 'publishedAt' | 'unpublishedAt'>, now: Date, maxAgeDays: number): AnnouncementState {
  if (row.unpublishedAt) return 'unpublished';
  if (!row.publishedAt) return 'draft';
  return isLive(row, now, maxAgeDays) ? 'live' : 'ended';
}

export function announcementKindLabel(kind: AnnouncementKind): string {
  return kind === 'feature' ? 'New feature' : 'Bug fix';
}

/** Click-through: members who tapped "Take a look" out of those shown, as a whole percentage; null before anyone is shown. */
export function clickThrough(shown: number, clicked: number): number | null {
  if (!Number.isFinite(shown) || shown <= 0) return null;
  return Math.round((Math.max(0, clicked) / shown) * 100);
}

/** The ids a banner event may name: announcement ids only, each once, at most BANNER_MAX. */
export function cleanIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((v): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)).map((v) => v.toLowerCase());
  return [...new Set(ids)].slice(0, BANNER_MAX);
}
