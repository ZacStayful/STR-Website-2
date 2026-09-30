import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { isAdminEmail } from '../admin';
import { ACCESS_COLUMNS, accountStatus, isCancelScheduled, type AccessProfile } from '../access';
import { getBillingSettings } from '../credit/unit-costs';
import { QUALIFYING_KINDS } from '../activity/kinds';
import { payersForStrict } from '../team';
import { inactivityChange, inactivityEligible, inactivityState } from './rules';

/**
 * Inactivity (Batch 20, Part C; the rules are in ./rules.ts).
 *
 *   runInactivityStep   the nightly, database only: brings member_active_days
 *                       up to date from the activity log (from a watermark,
 *                       never a rescan), then sets reengage_since at 14 quiet
 *                       days and picks_paused_inactive_at at 25, and clears
 *                       both for anyone active again. The first step of
 *                       /api/internal/monday-funnel's nightly, before any
 *                       Monday call. `apply: false` writes nothing.
 *   inactivePausedIds   whose daily picks are paused (the picks run skips
 *                       them, the digest drops their Today's 5).
 *
 * A qualifying action clears both at once: ./came-back.ts, from
 * src/lib/activity/log.ts.
 *
 * Every read of the Batch 20 columns is its own query: before the schema is
 * run it fails, and nothing is paused or marked.
 */

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const ID_CHUNK = 300;

type ProfileRow = AccessProfile & { id: string; email: string | null; created_at: string | null };
type MarkRow = { id: string; reengage_since: string | null; picks_paused_inactive_at: string | null };

export interface InactivityOutcome {
  ok: boolean;
  error?: string;
  dry: boolean;
  /** The rules are off until billing_settings.inactivity_from is set. */
  rulesOn: boolean;
  activeDays: { added: number; upTo: number | null; more: boolean } | null;
  /**
   * The activity log was not read to the end in the time allowed: nobody is
   * newly marked (their latest actions may not be counted yet), only cleared,
   * and the nightly runs the step again.
   */
  incomplete: boolean;
  considered: number;
  eligible: number;
  reengage: { set: number; cleared: number };
  paused: { set: number; cleared: number };
  /** Who moves tonight (the dry run's list). */
  changes: { user: string; email: string | null; days: number | null; reengage: 'set' | 'clear' | null; picks: 'pause' | 'restart' | null }[];
  ms: number;
}

/**
 * Brings member_active_days up to date. A dry run only counts what it would
 * add, and returns each member's latest day among the actions not yet
 * counted (`pending`), so its preview is as of now, not as of last night.
 */
async function syncActiveDays(admin: Admin, apply: boolean, deadline: number): Promise<{ added: number; upTo: number | null; more: boolean; pending: Map<string, string> } | { error: string }> {
  let added = 0;
  let upTo: number | null = null;
  const pending = new Map<string, string>();
  for (;;) {
    const { data, error } = await admin.rpc('lifecycle_active_days_sync', { p: { qualifying: QUALIFYING_KINDS, apply, limit: 50000 } });
    if (error) return { error: `active days not synced (schema behind?): ${error.message}` };
    const r = (data ?? {}) as { added?: number; to?: number | null; more?: boolean; pending?: { u: string; day: string }[] | null };
    added += Number(r.added) || 0;
    upTo = r.to ?? upTo;
    for (const x of r.pending ?? []) if (x?.u && x.day) pending.set(x.u, x.day);
    // A dry run does not move the watermark, so one pass is all it can count.
    if (!r.more || !apply || Date.now() > deadline) return { added, upTo, more: Boolean(r.more), pending };
  }
}

export async function runInactivityStep(opts: { apply: boolean; now?: Date; budgetMs?: number }): Promise<InactivityOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const out: InactivityOutcome = { ok: true, dry: !opts.apply, rulesOn: false, activeDays: null, incomplete: false, considered: 0, eligible: 0, reengage: { set: 0, cleared: 0 }, paused: { set: 0, cleared: 0 }, changes: [], ms: 0 };
  const fail = (error: string): InactivityOutcome => ({ ...out, ok: false, error, ms: Date.now() - started });
  if (!hasServiceRole()) return fail('Storage not configured');
  const admin = createAdminClient();
  const settings = (await getBillingSettings()).lifecycle;
  out.rulesOn = Boolean(settings.inactivityFrom);

  const synced = await syncActiveDays(admin, opts.apply, started + (opts.budgetMs ?? 20_000));
  if ('error' in synced) return fail(synced.error);
  out.activeDays = { added: synced.added, upTo: synced.upTo, more: synced.more };
  out.incomplete = opts.apply && synced.more;

  // Everyone, with the plan columns (the rules need the plan holder's).
  const profiles: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('profiles').select(`id, email, created_at, ${ACCESS_COLUMNS}`).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return fail(`profiles read failed: ${error.message}`);
    profiles.push(...((data ?? []) as unknown as ProfileRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  out.considered = profiles.length;
  // The marks, in a read of their own.
  const marks = new Map<string, MarkRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('profiles').select('id, reengage_since, picks_paused_inactive_at').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return fail(`inactivity columns unreadable (schema not run?): ${error.message}`);
    for (const r of (data ?? []) as MarkRow[]) marks.set(r.id, r);
    if ((data?.length ?? 0) < PAGE) break;
  }
  const ids = profiles.map((p) => p.id);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  // A team member follows their owner's plan: never guessed, so a failed lookup stops the step.
  const payers = await payersForStrict(ids);
  if (!payers) return fail('team lookup failed: nobody marked');
  const lastDay = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin.rpc('lifecycle_member_stats', { p: { users: ids.slice(i, i + ID_CHUNK) } });
    if (error) return fail(`member stats unreadable: ${error.message}`);
    for (const r of (data ?? []) as { u: string; last_day: string | null }[]) lastDay.set(r.u, r.last_day ?? null);
  }
  // A dry run cannot count the actions since the last nightly into the table: its preview adds them here.
  for (const [u, day] of synced.pending) {
    const had = lastDay.get(u) ?? null;
    if (!had || day > had) lastDay.set(u, day);
  }

  const groups = { setReengage: [] as string[], clearReengage: [] as string[], setPaused: [] as string[], clearPaused: [] as string[] };
  for (const p of profiles) {
    // A team member follows their owner's plan; their own activity counts.
    const holder = byId.get(payers.get(p.id)?.payerId ?? p.id) ?? p;
    // A cancellation booked and still to come; a plan granted by hand is never one (a stale date may be left on it).
    const cancelBooked = holder.plan_source !== 'manual' && isCancelScheduled(holder, now.getTime());
    const eligible = inactivityEligible({ planStatus: accountStatus(holder, now.getTime()), cancelBooked, admin: isAdminEmail(p.email), email: p.email });
    if (eligible) out.eligible += 1;
    const target = inactivityState({ eligible, lastActiveDay: lastDay.get(p.id) ?? null, createdAt: p.created_at }, settings, now);
    const mark = marks.get(p.id);
    const change = inactivityChange({ reengageSince: mark?.reengage_since ?? null, picksPausedAt: mark?.picks_paused_inactive_at ?? null }, target);
    if (change.setReengage) groups.setReengage.push(p.id);
    if (change.clearReengage) groups.clearReengage.push(p.id);
    if (change.setPaused) groups.setPaused.push(p.id);
    if (change.clearPaused) groups.clearPaused.push(p.id);
    if (change.setReengage || change.clearReengage || change.setPaused || change.clearPaused) {
      out.changes.push({ user: p.id, email: p.email, days: target.days, reengage: change.setReengage ? 'set' : change.clearReengage ? 'clear' : null, picks: change.setPaused ? 'pause' : change.clearPaused ? 'restart' : null });
    }
  }
  out.reengage = { set: groups.setReengage.length, cleared: groups.clearReengage.length };
  out.paused = { set: groups.setPaused.length, cleared: groups.clearPaused.length };
  if (!opts.apply) return { ...out, ms: Date.now() - started };

  const nowIso = now.toISOString();
  const write = async (list: string[], patch: Record<string, unknown>, onlyIfNull?: string): Promise<string | null> => {
    for (let i = 0; i < list.length; i += ID_CHUNK) {
      let q = admin.from('profiles').update(patch).in('id', list.slice(i, i + ID_CHUNK));
      if (onlyIfNull) q = q.is(onlyIfNull, null);
      const { error } = await q;
      if (error) return error.message;
    }
    return null;
  };
  // Clears are always safe; new marks only once every action has been counted.
  const errors = [
    out.incomplete ? null : await write(groups.setReengage, { reengage_since: nowIso }, 'reengage_since'),
    await write(groups.clearReengage, { reengage_since: null }),
    // A new pause gets its own "while you're away" letter.
    out.incomplete ? null : await write(groups.setPaused, { picks_paused_inactive_at: nowIso, picks_paused_inactive_email_at: null }, 'picks_paused_inactive_at'),
    await write(groups.clearPaused, { picks_paused_inactive_at: null, picks_paused_inactive_email_at: null }),
  ].filter((e): e is string => e !== null);
  if (out.incomplete) {
    out.reengage.set = 0;
    out.paused.set = 0;
  }
  if (errors.length > 0) return fail(`inactivity not written: ${errors[0]}`);
  return { ...out, ms: Date.now() - started };
}

/** Members whose daily picks are paused for inactivity. Unreadable (schema not run): nobody. */
export async function inactivePausedIds(admin: Admin): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('profiles').select('id').not('picks_paused_inactive_at', 'is', null).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.warn('[inactivity] paused members unreadable (schema not run?):', error.message);
      return new Set();
    }
    for (const r of (data ?? []) as { id: string }[]) out.add(r.id);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}
