import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { logActivity } from '../activity/log';
import { CACHE_MS, isAnnouncementKind, type AnnouncementKind } from './config';
import { activityKey, isSchemaMissing } from './rules';
import { cleanIds, isLive, visibleAnnouncements, type AnnouncementDraft, type AnnouncementRow, type LiveAnnouncement, type ViewState } from './announcements';
import { feedbackSettings } from './settings-server';

/**
 * Announcements on the server (Batch 18): what AppShell's banner shows a
 * member, what the banner reports back (shown, dismissed, "Take a look"),
 * and admin's editing and figures. Service role only; whose banner it is
 * always comes from the session.
 */

type RawRow = { id: string; kind: string; title: string; body: string; link_path: string | null; report_ids?: string[] | null; published_at: string | null; unpublished_at: string | null; created_at?: string; updated_at?: string };

function toRow(r: RawRow): AnnouncementRow | null {
  if (!isAnnouncementKind(r.kind)) return null;
  return { id: r.id, kind: r.kind, title: r.title, body: r.body, linkPath: r.link_path, publishedAt: r.published_at, unpublishedAt: r.unpublished_at };
}

// The live list is the same for every member, so each server keeps it for a
// minute: a page usually costs no query at all, and one (this member's
// views) while something is live. "Unavailable" (the schema not run yet) is
// kept too, and warned about once a minute, so a missing table never slows
// every page down or fills the logs.
let live: { at: number; rows: AnnouncementRow[] } | null = null;
let lastWarn = 0;

function warn(message: string) {
  if (Date.now() - lastWarn < 60_000) return;
  lastWarn = Date.now();
  console.warn(`[announcements] ${message}`);
}

async function liveRows(now: Date, maxAgeDays: number): Promise<AnnouncementRow[]> {
  if (live && Date.now() - live.at < CACHE_MS) return live.rows;
  const since = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await createAdminClient()
    .from('announcements')
    .select('id, kind, title, body, link_path, published_at, unpublished_at')
    .not('published_at', 'is', null)
    .is('unpublished_at', null)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(50);
  if (error) {
    warn(isSchemaMissing(error) ? 'not shown: run the Batch 18 section of supabase/schema.sql' : `could not read: ${error.message}`);
    live = { at: Date.now(), rows: [] };
    return [];
  }
  const rows = ((data ?? []) as RawRow[]).map(toRow).filter((r): r is AnnouncementRow => r !== null);
  live = { at: Date.now(), rows };
  return rows;
}

/** Forget this server's copy (after admin publishes or takes one down). */
export function forgetLiveAnnouncements(): void {
  live = null;
}

/**
 * What this member's banner shows, newest first: live announcements
 * published after they joined, not dismissed and not opened. Never throws:
 * any failure shows nothing.
 */
export async function unseenAnnouncementsFor(userId: string, joinedAt: string | null, now = new Date()): Promise<LiveAnnouncement[]> {
  try {
    if (!hasServiceRole()) return [];
    const { announcementMaxAgeDays } = await feedbackSettings();
    const rows = await liveRows(now, announcementMaxAgeDays);
    if (rows.length === 0) return [];
    const { data, error } = await createAdminClient()
      .from('announcement_views')
      .select('announcement_id, dismissed_at, clicked_at')
      .eq('user_id', userId)
      .in('announcement_id', rows.map((r) => r.id));
    if (error) {
      warn(`could not read a member's views: ${error.message}`);
      return [];
    }
    const views = new Map<string, ViewState>(((data ?? []) as { announcement_id: string; dismissed_at: string | null; clicked_at: string | null }[]).map((v) => [v.announcement_id, { dismissedAt: v.dismissed_at, clickedAt: v.clicked_at }]));
    return visibleAnnouncements(rows, views, { createdAt: joinedAt }, now, announcementMaxAgeDays);
  } catch (err) {
    warn(`failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export type BannerAction = 'shown' | 'dismiss' | 'click';

/**
 * What the banner reports back. Only announcements that are live count, and
 * only for this member. `shown`: the first time each was on their screen.
 * `dismiss`: every one the banner listed. `click`: "Take a look" on one.
 * Dismissed or opened, it is never shown to them again.
 */
export async function recordBannerEvent(userId: string, action: BannerAction, rawIds: unknown, now = new Date()): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { announcementMaxAgeDays } = await feedbackSettings();
  const liveIds = new Set((await liveRows(now, announcementMaxAgeDays)).filter((r) => isLive(r, now, announcementMaxAgeDays)).map((r) => r.id));
  const ids = cleanIds(rawIds).filter((id) => liveIds.has(id));
  if (ids.length === 0) return false;
  const admin = createAdminClient();
  const at = now.toISOString();
  if (action === 'shown') {
    const { error } = await admin.from('announcement_views').upsert(ids.map((id) => ({ announcement_id: id, user_id: userId })), { onConflict: 'announcement_id,user_id', ignoreDuplicates: true });
    if (error) return false;
    for (const id of ids) logActivity(userId, 'announcement_shown', { dedupeKey: activityKey.shown(id) });
    return true;
  }
  if (action === 'dismiss') {
    const { error } = await admin.from('announcement_views').upsert(ids.map((id) => ({ announcement_id: id, user_id: userId, dismissed_at: at })), { onConflict: 'announcement_id,user_id' });
    if (error) return false;
    logActivity(userId, 'announcement_dismissed', { extras: { count: ids.length } });
    return true;
  }
  const id = ids[0];
  const { error } = await admin.from('announcement_views').upsert({ announcement_id: id, user_id: userId, clicked_at: at }, { onConflict: 'announcement_id,user_id' });
  if (error) return false;
  logActivity(userId, 'announcement_clicked', { dedupeKey: activityKey.clicked(id) });
  return true;
}

// ── Admin ──

export interface AdminAnnouncement extends AnnouncementRow {
  reportIds: string[];
  createdAt: string;
  updatedAt: string;
  shown: number;
  dismissed: number;
  clicked: number;
}

type LoadStatus = 'ok' | 'no_service_role' | 'schema_missing' | 'failed';

export async function listAnnouncements(): Promise<{ status: LoadStatus; message: string | null; rows: AdminAnnouncement[] }> {
  if (!hasServiceRole()) return { status: 'no_service_role', message: null, rows: [] };
  const admin = createAdminClient();
  const [{ data, error }, stats] = await Promise.all([
    admin.from('announcements').select('id, kind, title, body, link_path, report_ids, published_at, unpublished_at, created_at, updated_at').order('created_at', { ascending: false }).limit(200),
    admin.rpc('announcement_stats', { p: {} }),
  ]);
  if (error) return { status: isSchemaMissing(error) ? 'schema_missing' : 'failed', message: error.message, rows: [] };
  const counts = new Map(((stats.data ?? []) as { id: string; shown: number; dismissed: number; clicked: number }[]).map((s) => [s.id, s]));
  const rows: AdminAnnouncement[] = [];
  for (const r of (data ?? []) as RawRow[]) {
    const row = toRow(r);
    if (!row) continue;
    const c = counts.get(r.id);
    rows.push({ ...row, reportIds: r.report_ids ?? [], createdAt: r.created_at ?? '', updatedAt: r.updated_at ?? '', shown: Number(c?.shown ?? 0), dismissed: Number(c?.dismissed ?? 0), clicked: Number(c?.clicked ?? 0) });
  }
  return { status: 'ok', message: null, rows };
}

export async function getAnnouncement(id: string): Promise<{ status: LoadStatus; row: (AdminAnnouncement & { reportRefs: number[] }) | null }> {
  if (!hasServiceRole()) return { status: 'no_service_role', row: null };
  const admin = createAdminClient();
  const { data, error } = await admin.from('announcements').select('id, kind, title, body, link_path, report_ids, published_at, unpublished_at, created_at, updated_at').eq('id', id).maybeSingle();
  if (error) return { status: isSchemaMissing(error) ? 'schema_missing' : 'failed', row: null };
  const raw = data as RawRow | null;
  const row = raw ? toRow(raw) : null;
  if (!raw || !row) return { status: 'ok', row: null };
  const ids = raw.report_ids ?? [];
  const refs = ids.length > 0 ? (((await admin.from('feedback_reports').select('ref').in('id', ids)).data ?? []) as { ref: number }[]).map((x) => x.ref).sort((a, b) => a - b) : [];
  const { data: stats } = await admin.rpc('announcement_stats', { p: {} });
  const c = ((stats ?? []) as { id: string; shown: number; dismissed: number; clicked: number }[]).find((s) => s.id === id);
  return { status: 'ok', row: { ...row, reportIds: ids, reportRefs: refs, createdAt: raw.created_at ?? '', updatedAt: raw.updated_at ?? '', shown: Number(c?.shown ?? 0), dismissed: Number(c?.dismissed ?? 0), clicked: Number(c?.clicked ?? 0) } };
}

/**
 * Saves a draft (a new one when `id` is null), with its report numbers
 * turned into report ids; a number that is not a report is refused.
 * Editing a published announcement changes it for anyone not yet shown it.
 */
export async function saveAnnouncement(draft: AnnouncementDraft, id: string | null, by: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const admin = createAdminClient();
  let reportIds: string[] = [];
  if (draft.reportRefs.length > 0) {
    const { data } = await admin.from('feedback_reports').select('id, ref').in('ref', draft.reportRefs);
    const found = (data ?? []) as { id: string; ref: number }[];
    const missing = draft.reportRefs.filter((ref) => !found.some((f) => f.ref === ref));
    if (missing.length > 0) return { ok: false, message: `There is no report ${missing.map((m) => `#${m}`).join(', ')}.` };
    reportIds = draft.reportRefs.map((ref) => found.find((f) => f.ref === ref)!.id);
  }
  const values = { kind: draft.kind satisfies AnnouncementKind, title: draft.title, body: draft.body, link_path: draft.linkPath, report_ids: reportIds, updated_at: new Date().toISOString() };
  if (id) {
    const { error } = await admin.from('announcements').update(values).eq('id', id);
    if (error) return { ok: false, message: `Could not save: ${error.message}` };
    forgetLiveAnnouncements();
    return { ok: true, id };
  }
  const { data, error } = await admin.from('announcements').insert({ ...values, created_by: by }).select('id').single();
  if (error || !data) return { ok: false, message: `Could not save: ${error?.message ?? 'no row'}` };
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Publishes: live from now for every member who joined before now. A live
 * one is left as it is (a second press changes nothing); one taken down is
 * published again from now.
 */
export async function publishAnnouncement(id: string): Promise<{ ok: boolean; message: string }> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin.from('announcements').update({ published_at: now, unpublished_at: null, updated_at: now }).eq('id', id).or('published_at.is.null,unpublished_at.not.is.null').select('id');
  if (error) return { ok: false, message: `Could not publish: ${error.message}` };
  forgetLiveAnnouncements();
  return { ok: true, message: (data ?? []).length > 0 ? 'Published: members will see it on their next page.' : 'It was already live.' };
}

export async function unpublishAnnouncement(id: string): Promise<{ ok: boolean; message: string }> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from('announcements').update({ unpublished_at: now, updated_at: now }).eq('id', id).is('unpublished_at', null).not('published_at', 'is', null);
  if (error) return { ok: false, message: `Could not take it down: ${error.message}` };
  forgetLiveAnnouncements();
  return { ok: true, message: 'Taken down: nobody sees it from now on.' };
}
