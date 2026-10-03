import 'server-only';

/**
 * Batch 23b: member_briefings, one row per member per UK day.
 *
 * The row is the claim: the briefing pass inserts it ('generating') before it
 * writes anything, so a second pass, an overlapping run or a retry finds it
 * and moves on. A row stuck in 'generating' (a run that died) is reclaimed
 * after STALE_MS, keeping its action id, so a charge that did land is found
 * (the runner checks the ledger by action id before it charges).
 *
 * The daily email and Today read the row; nothing here writes for them
 * except the in-app marks (seen, dismissed, played, feedback).
 */
import { randomUUID } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { addDays } from '../activity/week';
import type { AngleId } from './angles';
import type { NudgeLink } from './nudges';
import { STALE_MS, claimDecision } from './once';

type Admin = ReturnType<typeof createAdminClient>;

export { STALE_MS } from './once';
const ID_CHUNK = 150;

export type BriefingStatus = 'generating' | 'ready' | 'template' | 'skipped';

/** What the email and Today use. */
export interface StoredBriefing {
  id: string;
  userId: string;
  ukDay: string;
  status: 'ready' | 'template';
  angle: AngleId;
  greeting: string;
  opener: string;
  /** The writer's validated subject; null: keep the email's own. */
  subject: string | null;
  nudges: NudgeLink[];
  shownInAppAt: string | null;
  dismissedAt: string | null;
  feedback: 'useful' | 'not_for_me' | null;
  playedCount: number;
}

const COLUMNS = 'id, user_id, uk_day, status, angle, greeting, opener, subject, nudges, shown_in_app_at, dismissed_at, feedback, played_count';

function nudgesOf(raw: unknown): NudgeLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is Record<string, unknown> => Boolean(n) && typeof n === 'object')
    .map((n) => ({ key: String(n.key ?? ''), text: String(n.text ?? ''), nextStep: String(n.nextStep ?? ''), path: String(n.path ?? '') }))
    .filter((n) => n.key && n.text && n.path.startsWith('/my-deals'));
}

/**
 * A row as the email and Today use it. A row still 'generating' that already
 * carries the template opener (saved as soon as the facts were in) is used as
 * a template: not ready in time means the template, uncharged.
 */
export function storedOf(r: Record<string, unknown>): StoredBriefing | null {
  if (r.status !== 'ready' && r.status !== 'template' && r.status !== 'generating') return null;
  if (typeof r.opener !== 'string' || !r.opener.trim() || typeof r.greeting !== 'string' || !r.angle) return null;
  return {
    id: String(r.id),
    userId: String(r.user_id),
    ukDay: String(r.uk_day),
    status: r.status === 'ready' ? 'ready' : 'template',
    angle: r.angle as AngleId,
    greeting: r.greeting,
    opener: r.opener,
    subject: r.status === 'ready' && typeof r.subject === 'string' && r.subject.trim() ? r.subject : null,
    nudges: nudgesOf(r.nudges),
    shownInAppAt: (r.shown_in_app_at as string | null) ?? null,
    dismissedAt: (r.dismissed_at as string | null) ?? null,
    feedback: r.feedback === 'useful' || r.feedback === 'not_for_me' ? r.feedback : null,
    playedCount: Number(r.played_count) || 0,
  };
}

/** The usable briefings for these members on a UK day (the email's one read). A read failure gives none: the email goes without. */
export async function briefingsFor(userIds: readonly string[], ukDay: string, admin: Admin = createAdminClient()): Promise<Map<string, StoredBriefing>> {
  const out = new Map<string, StoredBriefing>();
  if (!hasServiceRole() || userIds.length === 0) return out;
  const unique = [...new Set(userIds)];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('member_briefings').select(COLUMNS).eq('uk_day', ukDay).in('status', ['ready', 'template', 'generating']).in('user_id', unique.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[briefing] read failed; emails go without:', error.message);
      return new Map();
    }
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const b = storedOf(r);
      if (b) out.set(b.userId, b);
    }
  }
  return out;
}

export async function briefingFor(userId: string, ukDay: string): Promise<StoredBriefing | null> {
  return (await briefingsFor([userId], ukDay)).get(userId) ?? null;
}

/** Each member's angles over the three days before `ukDay`, newest first ([yesterday, the day before, …]). */
export async function recentAnglesFor(admin: Admin, userIds: readonly string[], ukDay: string): Promise<Map<string, (AngleId | null)[]>> {
  const days = [1, 2, 3].map((n) => addDays(ukDay, -n));
  const out = new Map<string, (AngleId | null)[]>();
  for (const id of userIds) out.set(id, [null, null, null]);
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('member_briefings').select('user_id, uk_day, angle').in('uk_day', days).in('status', ['ready', 'template']).in('user_id', userIds.slice(i, i + ID_CHUNK));
    if (error) throw new Error(`recent angles: ${error.message}`);
    for (const r of (data ?? []) as { user_id: string; uk_day: string; angle: string | null }[]) {
      const list = out.get(r.user_id);
      const at = days.indexOf(String(r.uk_day));
      if (list && at >= 0) list[at] = (r.angle as AngleId) ?? null;
    }
  }
  return out;
}

/** Members with a row today that is finished, or still being written by a live run: not ours to touch. */
export async function settledToday(admin: Admin, userIds: readonly string[], ukDay: string, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  const staleBefore = now.getTime() - STALE_MS;
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('member_briefings').select('user_id, status, created_at').eq('uk_day', ukDay).in('user_id', userIds.slice(i, i + ID_CHUNK));
    if (error) throw new Error(`today's rows: ${error.message}`);
    for (const r of (data ?? []) as { user_id: string; status: string; created_at: string }[]) {
      if (r.status !== 'generating' || Date.parse(r.created_at) > staleBefore) out.add(r.user_id);
    }
  }
  return out;
}

export interface Claim {
  id: string;
  actionId: string;
}

/**
 * Claim today's row for a member: a new row, or a stale 'generating' one
 * (keeping its action id). Null when another run holds it or it is done.
 */
export async function claimBriefing(admin: Admin, userId: string, ukDay: string, now: Date): Promise<Claim | null> {
  const actionId = randomUUID();
  const { data, error } = await admin.from('member_briefings').insert({ user_id: userId, uk_day: ukDay, status: 'generating', action_id: actionId }).select('id, action_id').maybeSingle();
  if (!error && data) return { id: String(data.id), actionId: String(data.action_id) };
  if (error && error.code !== '23505') throw new Error(`claim: ${error.message}`);
  const { data: row } = await admin.from('member_briefings').select('id, status, created_at, action_id').eq('user_id', userId).eq('uk_day', ukDay).maybeSingle();
  if (!row) return null;
  const d = claimDecision({ status: String(row.status), createdAt: String(row.created_at), actionId: (row.action_id as string | null) ?? null }, now);
  if (d.kind !== 'reclaim') return null;
  // Take it over only if nobody else has since: the created_at we read is the lock.
  const { data: taken } = await admin
    .from('member_briefings')
    .update({ created_at: now.toISOString() })
    .eq('id', row.id)
    .eq('status', 'generating')
    .eq('created_at', row.created_at)
    .select('id, action_id')
    .maybeSingle();
  if (!taken) return null;
  return { id: String(taken.id), actionId: String(taken.action_id ?? actionId) };
}

export interface Finished {
  status: Exclude<BriefingStatus, 'generating'>;
  angle: AngleId | null;
  greeting: string | null;
  opener: string | null;
  subject: string | null;
  nudges: NudgeLink[];
  facts: unknown;
  factsUsed: string[];
  personaVersion: string;
  model: string | null;
  aiAttempted: boolean;
  rejectReason: string | null;
  inputTokens: number;
  outputTokens: number;
  chargePence: number;
}

export async function finishBriefing(admin: Admin, id: string, f: Finished, now: Date): Promise<void> {
  const { error } = await admin
    .from('member_briefings')
    .update({
      status: f.status,
      angle: f.angle,
      greeting: f.greeting,
      opener: f.opener,
      subject: f.subject,
      nudges: f.nudges,
      facts: f.facts,
      facts_used: f.factsUsed,
      persona_version: f.personaVersion,
      model: f.model,
      ai_attempted: f.aiAttempted,
      reject_reason: f.rejectReason,
      input_tokens: f.inputTokens,
      output_tokens: f.outputTokens,
      charge_pence: f.chargePence,
      generated_at: now.toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`finish: ${error.message}`);
}

/**
 * The template, saved on the claimed row as soon as the facts are in: if the
 * writer is not done when the email is built, this is what it shows. The
 * row stays 'generating' (the claim) until finishBriefing.
 */
export async function saveProvisional(admin: Admin, id: string, p: { angle: AngleId; greeting: string; opener: string; nudges: NudgeLink[] }): Promise<void> {
  const { error } = await admin.from('member_briefings').update({ angle: p.angle, greeting: p.greeting, opener: p.opener, subject: null, nudges: p.nudges }).eq('id', id).eq('status', 'generating');
  if (error) console.warn('[briefing] provisional template not saved:', error.message);
}

/** Release a claim that will not be finished (a failure before anything was written or charged): the next run tries again. */
export async function releaseClaim(admin: Admin, id: string): Promise<void> {
  await admin.from('member_briefings').delete().eq('id', id).eq('status', 'generating');
}
