import 'server-only';

/**
 * What Project deals are doing, for /admin/deals/projects (Batch 17, Part H):
 * how many listings were flagged, held, photo-checked and what came of them;
 * the live Project deals; what members did with them (opened, analysed, the
 * working, locked figures) and the keep rate against the other deals; the
 * recent photo checks; members' locked figures against ours; the live-deal
 * backfill's runs.
 *
 * Admin only, and still no address, postcode, listing link or photo: a deal
 * is its area, bedrooms and type, with a link to its own sheet. Members are
 * counted, never named. Every read is tolerant: a table or column the
 * database does not have yet reads as "no figure", never an error page.
 */
import type { createAdminClient } from '../supabase/admin';
import { ukDay } from '../activity/week';
import { isMissingColumn } from './read-server';
import { parseProjectCard, type ProjectCardData } from './headline';
import { parseStoredEstimate } from './estimate';
import type { MemberFigures } from './member-figures';
import { PROJECT_BACKFILL_KIND } from './live-backfill-run';

type Admin = ReturnType<typeof createAdminClient>;

export const PROJECT_RETIRED_REASONS = ['not_project', 'project_excluded', 'project_no_evidence', 'project_uncheckable'] as const;
export const PROJECT_ACTIVITY_KINDS = ['project_view', 'project_working', 'project_line_edit', 'project_line_add', 'project_lock', 'project_unlock'] as const;

export interface LiveProjectRow {
  id: string;
  area: string | null;
  bedrooms: number | null;
  type: string | null;
  price: number | null;
  card: ProjectCardData | null;
  liveSince: string | null;
  opens: number;
}

export interface CheckRow {
  day: string;
  area: string | null;
  bedrooms: number | null;
  type: string | null;
  status: string;
  costPence: number;
  model: string | null;
  fellBack: boolean;
}

export interface FiguresRow {
  area: string | null;
  bedrooms: number | null;
  version: number;
  lockedAt: string;
  oursWorksHigh: number | null;
  theirsWorksHigh: number;
  oursValueAdded: number | null;
  theirsValueAdded: number;
  theirsPass: boolean;
  changedLines: number;
  ownLines: number;
}

export interface KeepRate {
  keeps: number;
  passes: number;
}

export interface BackfillRun {
  id: string;
  dry: boolean;
  startedAt: string;
  summary: Record<string, unknown>;
}

export interface ProjectLearningView {
  days: number;
  found: number | null;
  retired: Record<string, number> | null;
  outcomes: Record<string, number>;
  photoChecks: { byStatus: Record<string, number>; costPence: number; fellBack: number; models: Record<string, number> } | null;
  live: LiveProjectRow[] | null;
  everProject: number | null;
  opened: { opens: number; deals: number } | null;
  analysed: number | null;
  locked: { versions: number; members: number } | null;
  activity: Record<string, number> | null;
  keep: { project: KeepRate; others: KeepRate } | null;
  checks: CheckRow[] | null;
  figures: FiguresRow[] | null;
  backfills: BackfillRun[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const warn = (what: string, error: { code?: string; message?: string }) => {
  if (!isMissingColumn(error) && !/does not exist|could not find/i.test(error.message ?? '')) console.warn(`[project-admin] ${what} unreadable:`, error.message);
};

const CHUNK = 150;

/** Rows for these ids, a chunk at a time (PostgREST's URL length). */
async function inChunks<T>(ids: readonly string[], read: (some: string[]) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, what: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) {
      warn(what, error);
      return null;
    }
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

interface DealBits {
  id: string;
  canonical_url: string;
  postcode_area: string | null;
  bedrooms: number | null;
  raw_type: string | null;
}

export async function projectLearningView(admin: Admin, days = 30, now: Date = new Date()): Promise<ProjectLearningView> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const sinceDay = ukDay(new Date(now.getTime() - days * 86_400_000));

  const [foundRes, retiredRes, runsRes, checksRes, liveRes, estRes, activityRes, backfillRes] = await Promise.all([
    admin.from('marketplace_deals').select('id', { count: 'exact', head: true }).gte('first_seen_at', since).eq('needs_work->>flag', 'true'),
    admin.from('marketplace_deals').select('retired_reason').eq('status', 'retired').in('retired_reason', [...PROJECT_RETIRED_REASONS]).gte('retired_at', since).limit(10000),
    admin.from('marketplace_runs').select('summary').eq('kind', 'project_checks').eq('dry', false).gte('started_at', since).limit(2000),
    admin.from('project_checks').select('canonical_url, check_day, status, cost_pence, model, fell_back').gte('check_day', sinceDay).order('created_at', { ascending: false }).limit(1000),
    admin.from('marketplace_deals').select('id, postcode_area, bedrooms, raw_type, price_amount, project, live_since').eq('status', 'live').not('project', 'is', null).order('live_since', { ascending: false }).limit(200),
    admin.from('project_estimates').select('deal_id, canonical_url, estimate').limit(5000),
    admin.from('activity_events').select('kind').in('kind', [...PROJECT_ACTIVITY_KINDS]).gte('occurred_at', since).limit(20000),
    admin.from('marketplace_runs').select('id, dry, started_at, summary').eq('kind', PROJECT_BACKFILL_KIND).order('started_at', { ascending: false }).limit(5),
  ]);

  // ── Found, retired, outcomes, photo checks ──
  if (foundRes.error) warn('flagged deals', foundRes.error);
  const found = foundRes.error ? null : foundRes.count ?? 0;

  let retired: Record<string, number> | null = null;
  if (retiredRes.error) warn('retired deals', retiredRes.error);
  else {
    retired = Object.fromEntries(PROJECT_RETIRED_REASONS.map((r) => [r, 0]));
    for (const r of (retiredRes.data ?? []) as { retired_reason: string }[]) retired[r.retired_reason] = (retired[r.retired_reason] ?? 0) + 1;
  }

  const outcomes: Record<string, number> = {};
  for (const r of (runsRes.data ?? []) as { summary: Record<string, unknown> | null }[]) {
    const o = r.summary?.outcomes;
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) outcomes[k] = (outcomes[k] ?? 0) + (num(v) ?? 0);
  }

  type CheckDb = { canonical_url: string; check_day: string; status: string; cost_pence: unknown; model: string | null; fell_back: boolean };
  let photoChecks: ProjectLearningView['photoChecks'] = null;
  const checkRows = checksRes.error ? null : ((checksRes.data ?? []) as CheckDb[]);
  if (checksRes.error) warn('photo checks', checksRes.error);
  if (checkRows) {
    photoChecks = { byStatus: {}, costPence: 0, fellBack: 0, models: {} };
    for (const c of checkRows) {
      photoChecks.byStatus[c.status] = (photoChecks.byStatus[c.status] ?? 0) + 1;
      photoChecks.costPence += num(c.cost_pence) ?? 0;
      if (c.fell_back) photoChecks.fellBack += 1;
      if (c.model) photoChecks.models[c.model] = (photoChecks.models[c.model] ?? 0) + 1;
    }
  }

  // ── Every deal that was ever a Project deal (it has an estimate), and what members did with them ──
  type EstDb = { deal_id: string; canonical_url: string; estimate: unknown };
  const estimates = estRes.error ? null : ((estRes.data ?? []) as EstDb[]);
  if (estRes.error) warn('estimates', estRes.error);
  const projectIds = estimates ? [...new Set(estimates.map((e) => e.deal_id))] : [];
  const oursByDeal = new Map<string, { worksHigh: number; valueAdded: number }>();
  for (const e of estimates ?? []) {
    const parsed = parseStoredEstimate(e.estimate);
    if (parsed) oursByDeal.set(e.deal_id, { worksHigh: parsed.works.high, valueAdded: parsed.test.valueAdded });
  }

  const [opens, analyses, lockedRows, reactions] = await Promise.all([
    estimates ? inChunks<{ deal_id: string }>(projectIds, (some) => admin.from('deal_opens').select('deal_id').eq('status', 'open').in('deal_id', some).limit(10000), 'opens') : Promise.resolve(null),
    estimates ? inChunks<{ deal_id: string }>(projectIds, (some) => admin.from('analysis_purchases').select('deal_id').eq('kind', 'full_analysis').eq('status', 'complete').in('deal_id', some).limit(10000), 'analyses') : Promise.resolve(null),
    admin.from('project_member_figures').select('user_id, deal_id, version, figures, created_at').eq('locked', true).order('created_at', { ascending: false }).limit(1000),
    admin.from('deal_reactions').select('deal_id, reaction').gte('updated_at', since).limit(50000),
  ]);

  const openCount = new Map<string, number>();
  for (const o of opens ?? []) openCount.set(o.deal_id, (openCount.get(o.deal_id) ?? 0) + 1);

  // ── Live Project deals ──
  type LiveDb = { id: string; postcode_area: string | null; bedrooms: number | null; raw_type: string | null; price_amount: unknown; project: unknown; live_since: string | null };
  if (liveRes.error) warn('live Project deals', liveRes.error);
  const live: LiveProjectRow[] | null = liveRes.error
    ? null
    : ((liveRes.data ?? []) as LiveDb[]).map((r) => ({ id: r.id, area: r.postcode_area, bedrooms: r.bedrooms, type: r.raw_type, price: num(r.price_amount), card: parseProjectCard(r.project), liveSince: r.live_since, opens: openCount.get(r.id) ?? 0 }));

  // ── Locked figures against ours ──
  type LockedDb = { user_id: string; deal_id: string; version: number; figures: MemberFigures | null; created_at: string };
  if (lockedRows.error) warn('locked figures', lockedRows.error);
  const locked = lockedRows.error ? null : ((lockedRows.data ?? []) as LockedDb[]);

  // Area, bedrooms and type for the deals the tables below name (never the address).
  const wanted = new Set<string>([...(locked ?? []).slice(0, 50).map((l) => l.deal_id)]);
  const urlsWanted = new Set<string>((checkRows ?? []).slice(0, 40).map((c) => c.canonical_url));
  const [byId, byUrl] = await Promise.all([
    inChunks<DealBits>([...wanted], (some) => admin.from('marketplace_deals').select('id, canonical_url, postcode_area, bedrooms, raw_type').in('id', some), 'deal facts'),
    inChunks<DealBits>([...urlsWanted], (some) => admin.from('marketplace_deals').select('id, canonical_url, postcode_area, bedrooms, raw_type').in('canonical_url', some), 'deal facts'),
  ]);
  const factsById = new Map((byId ?? []).map((d) => [d.id, d]));
  const factsByUrl = new Map((byUrl ?? []).map((d) => [d.canonical_url, d]));

  const figures: FiguresRow[] | null = locked
    ? locked
        .filter((l) => l.figures && typeof l.figures === 'object')
        .slice(0, 50)
        .map((l) => {
          const f = l.figures as MemberFigures;
          const d = factsById.get(l.deal_id);
          const ours = oursByDeal.get(l.deal_id) ?? null;
          return { area: d?.postcode_area ?? null, bedrooms: d?.bedrooms ?? null, version: Number(l.version), lockedAt: l.created_at, oursWorksHigh: ours?.worksHigh ?? null, theirsWorksHigh: f.worksHigh, oursValueAdded: ours?.valueAdded ?? null, theirsValueAdded: f.valueAdded, theirsPass: f.passes === true, changedLines: f.changedLines ?? 0, ownLines: f.ownLines ?? 0 };
        })
    : null;

  const checks: CheckRow[] | null = checkRows
    ? checkRows.slice(0, 40).map((c) => {
        const d = factsByUrl.get(c.canonical_url);
        return { day: c.check_day, area: d?.postcode_area ?? null, bedrooms: d?.bedrooms ?? null, type: d?.raw_type ?? null, status: c.status, costPence: num(c.cost_pence) ?? 0, model: c.model, fellBack: c.fell_back === true };
      })
    : null;

  // ── Keep rate: Project deals against the rest ──
  let keep: ProjectLearningView['keep'] = null;
  if (reactions.error) warn('reactions', reactions.error);
  else {
    const ids = new Set(projectIds);
    keep = { project: { keeps: 0, passes: 0 }, others: { keeps: 0, passes: 0 } };
    for (const r of (reactions.data ?? []) as { deal_id: string; reaction: string }[]) {
      const side = ids.has(r.deal_id) ? keep.project : keep.others;
      if (r.reaction === 'keep') side.keeps += 1;
      else if (r.reaction === 'pass') side.passes += 1;
    }
  }

  let activity: Record<string, number> | null = null;
  if (activityRes.error) warn('activity', activityRes.error);
  else {
    activity = Object.fromEntries(PROJECT_ACTIVITY_KINDS.map((k) => [k, 0]));
    for (const r of (activityRes.data ?? []) as { kind: string }[]) activity[r.kind] = (activity[r.kind] ?? 0) + 1;
  }

  return {
    days,
    found,
    retired,
    outcomes,
    photoChecks,
    live,
    everProject: estimates ? projectIds.length : null,
    opened: opens ? { opens: opens.length, deals: new Set(opens.map((o) => o.deal_id)).size } : null,
    analysed: analyses ? analyses.length : null,
    locked: locked ? { versions: locked.length, members: new Set(locked.map((l) => l.user_id)).size } : null,
    activity,
    keep,
    checks,
    figures,
    backfills: ((backfillRes.data ?? []) as { id: string; dry: boolean; started_at: string; summary: Record<string, unknown> | null }[]).map((r) => ({ id: r.id, dry: r.dry, startedAt: r.started_at, summary: r.summary ?? {} })),
  };
}

/** Keeps ÷ (keeps + passes), as a percentage; null with nothing to go on. */
export function keepRatePct(k: KeepRate): number | null {
  const n = k.keeps + k.passes;
  return n > 0 ? Math.round((k.keeps / n) * 1000) / 10 : null;
}
