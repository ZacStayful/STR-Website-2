import 'server-only';

import { createAdminClient, hasServiceRole } from '../../supabase/admin';
import { getBillingSettings } from '../../credit/unit-costs';
import { londonDay, londonParts } from '../../sms/uk-time';
import { runInactivityStep, type InactivityOutcome } from '../../inactivity/server';
import { CREATE_MIN_AGE_MS, funnelEnabled } from './config';
import { loadFacts } from './facts-server';
import { findItemsByEmail, mondayToken, readBoard, readItems, writePlan, type WriteOutcome } from './board';
import { planFunnel, planTable, type FunnelPlan } from './plan';
import type { BoardItem } from './match';

/**
 * The Monday funnel's runs (Batch 20, Part F).
 *
 *   runFunnelCron   /api/internal/monday-funnel, every 10 minutes: drains the
 *                   queue, and from 06:00 UK the nightly: first the
 *                   inactivity step (database only, so it runs even with
 *                   Monday off), then every member's row and group. The
 *                   nightly carries on across runs until a pass finishes
 *                   (each pass writes only what still differs), well before
 *                   the 07:00 UTC picks run. One writer at a time (a lease).
 *   runBackfill     /api/internal/monday-backfill and /admin/lifecycle: every
 *                   member, creating the rows that are missing.
 *
 * A dry run reads Monday but writes nothing anywhere: not the board, not the
 * queue, not the lease, not the inactivity columns. Monday down or slow is a
 * warning and a retry (the queue keeps the member; the nightly carries on
 * next run, or next night); members never see it.
 */

type Admin = ReturnType<typeof createAdminClient>;

const BUDGET_MS = 50_000;
const QUEUE_BATCH = 50;
const MAX_ATTEMPTS = 5;
const LINK_CONCURRENCY = 10;
/** Saving links may run this far past the write deadline, inside the function's 60 seconds. */
const LINK_GRACE_MS = 4_000;
/** The nightly starts at this UK hour. */
export const NIGHTLY_HOUR = 6;

function warn(message: string): void {
  console.warn(`[monday-funnel] ${message}`);
}

/**
 * Stores each member's row on their profile (null unlinks one that turned out
 * to be another member's), ten at a time, and stops a little after the
 * deadline so the run can still record itself: a link not saved is found
 * again next run (every row the sync writes carries the member's email).
 */
async function saveLinks(admin: Admin, links: { userId: string; itemId: string | null }[], deadline: number): Promise<number> {
  let saved = 0;
  for (let i = 0; i < links.length; i += LINK_CONCURRENCY) {
    if (Date.now() > deadline + LINK_GRACE_MS) {
      warn(`${links.length - i} row links left for the next run (out of time)`);
      break;
    }
    const results = await Promise.all(links.slice(i, i + LINK_CONCURRENCY).map((l) => admin.from('profiles').update({ monday_item_id: l.itemId }).eq('id', l.userId)));
    for (const r of results) {
      if (r.error) warn(`link not saved: ${r.error.message}`);
      else saved += 1;
    }
  }
  return saved;
}

function summary(plan: FunnelPlan) {
  return {
    updates: plan.updates.length,
    moves: plan.updates.filter((u) => u.to).length,
    creates: plan.creates.length,
    unchanged: plan.unchanged,
    excluded: plan.excluded.length,
    duplicates: plan.duplicates,
    noRow: plan.noRow.length,
  };
}

async function applyPlan(admin: Admin, token: string, plan: FunnelPlan, deadline: number): Promise<WriteOutcome & { linked: number }> {
  const written = await writePlan(token, plan.updates, plan.creates, deadline);
  const linked = await saveLinks(admin, [...written.created, ...plan.links], deadline);
  if (written.failed.length > 0) warn(`${written.failed.length} rows not written: ${written.failed[0].error}`);
  if (written.stopped) warn(`stopped early: ${written.stopped}`);
  return { ...written, linked };
}

// ── The queue ──

export interface DrainOutcome {
  queued: number;
  synced: number;
  failed: number;
  dropped: number;
  plan?: ReturnType<typeof summary>;
  table?: ReturnType<typeof planTable>;
  error?: string;
  mondayCalls: number;
  ms: number;
}

/** A few members, their own rows only (the stored one, else by email). Never creates a row: that is the nightly's. */
export async function drainQueue(admin: Admin, opts: { dry: boolean; token: string; deadline: number; now: Date }): Promise<DrainOutcome> {
  const started = Date.now();
  const out: DrainOutcome = { queued: 0, synced: 0, failed: 0, dropped: 0, mondayCalls: 0, ms: 0 };
  const done = () => ({ ...out, ms: Date.now() - started });
  const { data, error } = await admin.from('monday_funnel_queue').select('user_id, queued_at, attempts').order('queued_at', { ascending: true }).limit(QUEUE_BATCH);
  if (error) return { ...done(), error: `queue unreadable (schema not run?): ${error.message}` };
  const rows = (data ?? []) as { user_id: string; queued_at: string; attempts: number }[];
  out.queued = rows.length;
  if (rows.length === 0) return done();

  // A run that cannot get as far as writing still counts as an attempt, so a
  // fault that never clears cannot hold the head of the queue for ever (the
  // nightly puts anyone dropped right).
  const failAll = async (error: string): Promise<DrainOutcome> => {
    if (!opts.dry) {
      for (const r of rows) {
        if (r.attempts + 1 >= MAX_ATTEMPTS) {
          await admin.from('monday_funnel_queue').delete().eq('user_id', r.user_id).eq('queued_at', r.queued_at);
          out.dropped += 1;
        } else {
          await admin.from('monday_funnel_queue').update({ attempts: r.attempts + 1, last_error: error.slice(0, 500), last_attempt_at: new Date().toISOString() }).eq('user_id', r.user_id).eq('queued_at', r.queued_at);
        }
      }
    }
    return { ...done(), error };
  };
  const facts = await loadFacts(admin, { userIds: rows.map((r) => r.user_id), now: opts.now });
  if (!facts.ok) return failAll(facts.error);
  const settings = await getBillingSettings();
  // Their rows: stored ids first, then email for anyone whose stored row is gone or never was.
  const byStored = await readItems(opts.token, facts.facts.map((f) => f.mondayItemId).filter((id): id is string => Boolean(id)));
  out.mondayCalls += byStored.calls;
  if (!byStored.ok) return failAll(byStored.error);
  const found = new Set(byStored.items.map((i) => i.id));
  const byEmail = await findItemsByEmail(opts.token, facts.facts.filter((f) => !f.mondayItemId || !found.has(f.mondayItemId)).map((f) => f.email ?? ''));
  out.mondayCalls += byEmail.calls;
  if (!byEmail.ok) return failAll(byEmail.error);
  const items = new Map<string, BoardItem>([...byStored.items, ...byEmail.items].map((i) => [i.id, i]));
  const plan = planFunnel(facts.facts, [...items.values()], { lowCreditPence: settings.lifecycle.lowCreditPence, now: opts.now, createMissing: false, createMinAgeMs: CREATE_MIN_AGE_MS });
  if (opts.dry) {
    const emails = new Map(facts.facts.map((f) => [f.userId, f.email]));
    return { ...done(), plan: summary(plan), table: planTable(plan, (id) => emails.get(id) ?? null) };
  }

  const written = await applyPlan(admin, opts.token, plan, opts.deadline);
  out.mondayCalls += written.calls;
  const failed = new Map(written.failed.map((f) => [f.userId, f.error]));
  const succeeded = new Set(written.succeeded);
  const planned = new Set([...plan.updates.map((u) => u.userId), ...plan.creates.map((c) => c.userId)]);
  for (const r of rows) {
    const err = failed.get(r.user_id);
    if (err) {
      // The nightly puts it right in the end; the queue does not hold a member for ever.
      if (r.attempts + 1 >= MAX_ATTEMPTS) {
        await admin.from('monday_funnel_queue').delete().eq('user_id', r.user_id).eq('queued_at', r.queued_at);
        out.dropped += 1;
      } else {
        await admin.from('monday_funnel_queue').update({ attempts: r.attempts + 1, last_error: err.slice(0, 500), last_attempt_at: new Date().toISOString() }).eq('user_id', r.user_id).eq('queued_at', r.queued_at);
      }
      out.failed += 1;
      continue;
    }
    // Stopped before their row was reached: they stay queued for the next run.
    if (planned.has(r.user_id) && !succeeded.has(r.user_id)) continue;
    // Written, or nothing to write (no row yet, Excluded, a team member): off the queue, unless queued again meanwhile.
    await admin.from('monday_funnel_queue').delete().eq('user_id', r.user_id).eq('queued_at', r.queued_at);
    out.synced += 1;
  }
  return done();
}

// ── The nightly ──

export interface NightlyOutcome {
  day: string;
  ran: boolean;
  why?: string;
  inactivity?: InactivityOutcome | { skipped: string };
  plan?: ReturnType<typeof summary>;
  table?: ReturnType<typeof planTable>;
  written?: { updated: number; moved: number; created: number; failed: number; linked: number; stopped: string | null };
  finished?: boolean;
  error?: string;
  members?: number;
  boardRows?: number;
  mondayCalls: number;
  ms: { inactivity?: number; facts?: number; board?: number; write?: number; total: number };
}

async function runRow(admin: Admin, day: string): Promise<{ finished_at: string | null; inactivity_at: string | null; stats: Record<string, unknown> } | null> {
  const { data, error } = await admin.from('monday_funnel_runs').select('finished_at, inactivity_at, stats').eq('day', day).maybeSingle();
  if (error) throw new Error(`monday_funnel_runs unreadable (schema not run?): ${error.message}`);
  return (data as { finished_at: string | null; inactivity_at: string | null; stats: Record<string, unknown> } | null) ?? null;
}

export async function runNightly(admin: Admin, opts: { dry: boolean; token: string | null; writeMonday: boolean; deadline: number; now: Date; force: boolean }): Promise<NightlyOutcome> {
  const started = Date.now();
  const day = londonDay(opts.now);
  const out: NightlyOutcome = { day, ran: false, mondayCalls: 0, ms: { total: 0 } };
  const done = () => ({ ...out, ms: { ...out.ms, total: Date.now() - started } });
  let row;
  try {
    row = await runRow(admin, day);
  } catch (err) {
    return { ...done(), error: (err as Error).message };
  }
  // The inactivity step is retried until it is done, even once the Monday pass has finished.
  const inactivityDue = !row?.inactivity_at || opts.force;
  if (row?.finished_at && !inactivityDue) return { ...done(), why: 'already finished today' };
  out.ran = true;
  if (!opts.dry && !row) await admin.from('monday_funnel_runs').upsert({ day, started_at: new Date().toISOString() }, { onConflict: 'day', ignoreDuplicates: true });

  // 1. Inactivity: database only, before any Monday call (and before the 07:00 UTC picks run).
  if (inactivityDue) {
    const t = Date.now();
    const step = await runInactivityStep({ apply: !opts.dry, now: opts.now, budgetMs: 20_000 });
    out.ms.inactivity = Date.now() - t;
    out.inactivity = step;
    if (!step.ok) warn(`inactivity step failed: ${step.error}`);
    else if (step.incomplete) warn('inactivity step stopped before the end of the activity log: nobody newly marked; it runs again next time');
    else if (!opts.dry) await admin.from('monday_funnel_runs').update({ inactivity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('day', day);
  } else {
    out.inactivity = { skipped: 'done earlier today' };
  }
  if (row?.finished_at && !opts.force) return { ...done(), why: 'Monday already finished today' };

  // 2. Every member's row and group.
  if (!opts.token) return { ...done(), why: 'MONDAY_API_KEY is not set: Monday skipped' };
  if (!opts.dry && !opts.writeMonday) return { ...done(), why: 'MONDAY_FUNNEL_ENABLED is not "true": Monday skipped' };
  let t = Date.now();
  const facts = await loadFacts(admin, { now: opts.now });
  out.ms.facts = Date.now() - t;
  if (!facts.ok) return { ...done(), error: facts.error };
  out.members = facts.facts.length;
  t = Date.now();
  const board = await readBoard(opts.token, opts.deadline);
  out.ms.board = Date.now() - t;
  out.mondayCalls += board.calls;
  if (!board.ok) {
    warn(`board not read: ${board.error}`);
    return { ...done(), error: `board not read: ${board.error}` };
  }
  out.boardRows = board.items.length;
  const settings = await getBillingSettings();
  const plan = planFunnel(facts.facts, board.items, { lowCreditPence: settings.lifecycle.lowCreditPence, now: opts.now, createMissing: true, createMinAgeMs: CREATE_MIN_AGE_MS });
  out.plan = summary(plan);
  if (opts.dry) {
    const emails = new Map(facts.facts.map((f) => [f.userId, f.email]));
    return { ...done(), table: planTable(plan, (id) => emails.get(id) ?? null) };
  }
  t = Date.now();
  const written = await applyPlan(admin, opts.token, plan, opts.deadline);
  out.ms.write = Date.now() - t;
  out.mondayCalls += written.calls;
  out.written = { updated: written.updated, moved: written.moved, created: written.created.length, failed: written.failed.length, linked: written.linked, stopped: written.stopped };
  // Finished when a pass wrote everything it had; otherwise the next run (every 10 minutes) carries on.
  out.finished = !written.stopped;
  await admin
    .from('monday_funnel_runs')
    .update({ ...(out.finished ? { finished_at: new Date().toISOString() } : {}), stats: { ...(row?.stats ?? {}), ...out.plan, written: out.written, members: out.members, boardRows: out.boardRows }, updated_at: new Date().toISOString() })
    .eq('day', day);
  return done();
}

// ── The cron ──

export interface CronOutcome {
  dry: boolean;
  enabled: boolean;
  lease?: 'held' | 'busy';
  queue?: DrainOutcome | { skipped: string };
  nightly?: NightlyOutcome | { skipped: string };
  ms: number;
}

async function lease(admin: Admin, holder: string, release = false): Promise<boolean> {
  const { data, error } = await admin.rpc('monday_funnel_lease', { p: { holder, seconds: 120, release } });
  if (error) {
    warn(`lease unavailable (schema not run?): ${error.message}`);
    return false;
  }
  return data === true;
}

export async function runFunnelCron(opts: { dry: boolean; now?: Date; nightly?: 'auto' | 'force' | 'skip' }): Promise<CronOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const deadline = started + BUDGET_MS;
  const enabled = funnelEnabled();
  const out: CronOutcome = { dry: opts.dry, enabled, ms: 0 };
  if (!hasServiceRole()) return { ...out, ms: Date.now() - started, queue: { skipped: 'storage not configured' } };
  const admin = createAdminClient();
  const token = mondayToken();
  const holder = `cron:${crypto.randomUUID()}`;
  if (!opts.dry) {
    if (!(await lease(admin, holder))) return { ...out, lease: 'busy', ms: Date.now() - started };
    out.lease = 'held';
  }
  try {
    // The queue: only with Monday on (a dry run looks whatever the switch says).
    if (!token) out.queue = { skipped: 'MONDAY_API_KEY is not set' };
    else if (!enabled && !opts.dry) out.queue = { skipped: 'MONDAY_FUNNEL_ENABLED is not "true"' };
    else out.queue = await drainQueue(admin, { dry: opts.dry, token, deadline, now });

    const mode = opts.nightly ?? 'auto';
    const due = mode === 'force' || (mode === 'auto' && londonParts(now).hour >= NIGHTLY_HOUR);
    if (!due) out.nightly = { skipped: mode === 'skip' ? 'not asked' : `before ${NIGHTLY_HOUR}:00 UK` };
    else out.nightly = await runNightly(admin, { dry: opts.dry, token, writeMonday: enabled, deadline, now, force: mode === 'force' });
  } finally {
    if (!opts.dry) await lease(admin, holder, true);
  }
  const result = { ...out, ms: Date.now() - started };
  console.log('[monday-funnel] run', JSON.stringify({ dry: result.dry, enabled, lease: result.lease, queue: result.queue && 'queued' in result.queue ? { queued: result.queue.queued, synced: result.queue.synced, failed: result.queue.failed, error: result.queue.error } : result.queue, nightly: result.nightly && 'ran' in result.nightly ? { ran: result.nightly.ran, why: result.nightly.why, finished: result.nightly.finished, plan: result.nightly.plan && { ...result.nightly.plan, duplicates: result.nightly.plan.duplicates.length }, written: result.nightly.written, error: result.nightly.error, ms: result.nightly.ms } : result.nightly, ms: result.ms }));
  return result;
}

// ── The backfill ──

export interface BackfillOutcome {
  dry: boolean;
  error?: string;
  members?: number;
  left?: number;
  boardRows?: number;
  plan?: ReturnType<typeof summary>;
  table?: ReturnType<typeof planTable>;
  written?: { updated: number; moved: number; created: number; failed: number; linked: number; stopped: string | null };
  /** Stopped before the end: run it again to carry on (it writes only what still differs). */
  more?: boolean;
  mondayCalls: number;
  ms: { facts?: number; board?: number; write?: number; total: number };
}

export async function runBackfill(opts: { apply: boolean; now?: Date }): Promise<BackfillOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const deadline = started + BUDGET_MS;
  const out: BackfillOutcome = { dry: !opts.apply, mondayCalls: 0, ms: { total: 0 } };
  const done = () => ({ ...out, ms: { ...out.ms, total: Date.now() - started } });
  if (!hasServiceRole()) return { ...done(), error: 'Storage not configured' };
  const token = mondayToken();
  if (!token) return { ...done(), error: 'MONDAY_API_KEY is not set' };
  if (opts.apply && !funnelEnabled()) return { ...done(), error: 'MONDAY_FUNNEL_ENABLED is not "true": run the dry run, then switch it on' };
  const admin = createAdminClient();
  const holder = `backfill:${crypto.randomUUID()}`;
  if (opts.apply && !(await lease(admin, holder))) return { ...done(), error: 'Another Monday run is writing right now; try again in a minute.' };
  try {
    let t = Date.now();
    const facts = await loadFacts(admin, { now });
    out.ms.facts = Date.now() - t;
    if (!facts.ok) return { ...done(), error: facts.error };
    out.members = facts.facts.length;
    out.left = facts.left.length;
    t = Date.now();
    const board = await readBoard(token, deadline);
    out.ms.board = Date.now() - t;
    out.mondayCalls += board.calls;
    if (!board.ok) return { ...done(), error: `board not read: ${board.error}` };
    out.boardRows = board.items.length;
    const settings = await getBillingSettings();
    const plan = planFunnel(facts.facts, board.items, { lowCreditPence: settings.lifecycle.lowCreditPence, now, createMissing: true, createMinAgeMs: CREATE_MIN_AGE_MS });
    out.plan = summary(plan);
    const emails = new Map(facts.facts.map((f) => [f.userId, f.email]));
    out.table = planTable(plan, (id) => emails.get(id) ?? null);
    if (!opts.apply) return done();
    t = Date.now();
    const written = await applyPlan(admin, token, plan, deadline);
    out.ms.write = Date.now() - t;
    out.mondayCalls += written.calls;
    out.written = { updated: written.updated, moved: written.moved, created: written.created.length, failed: written.failed.length, linked: written.linked, stopped: written.stopped };
    out.more = Boolean(written.stopped);
    return done();
  } finally {
    if (opts.apply) await lease(admin, holder, true);
  }
}
