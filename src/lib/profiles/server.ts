import 'server-only';

/**
 * Saved profiles (Batch 13): the reads and writes. The rules are pure and
 * tested next door (rules.ts); the schema is the "Batch 13: saved profiles"
 * section of supabase/schema.sql.
 *
 * The active profile's criteria are also the live profiles.market_goals,
 * saved_areas and profile_quiz.answered that every page already reads and
 * the quiz already writes; triggers copy those into the active profile's
 * row, and select_search_profile swaps them in one transaction. So a page
 * that follows the active profile needs nothing from here, and the quiz
 * edits whichever profile is active without knowing it.
 *
 * For other batches:
 *   activeProfileFor(userId)            the profile the header shows
 *   runningProfilesFor(admin, userIds)  every running profile (the brief's
 *                                       "all active profiles"): the daily
 *                                       run, and Batch 15's search areas
 *   profilesByIds(admin, ids)           names for labels, deleted ones too
 *
 * search_profiles is service role only: every caller here has checked the
 * session, and every query is scoped by the member's own id. A database the
 * schema has not caught up with reads as "no profiles" (readable: false), and
 * the app then behaves exactly as it did before this batch.
 */
import { cache } from 'react';
import { after } from 'next/server';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { teamOf, payerFor } from '../team';
import { logActivity } from '../activity/log';
import { quoterFor } from '../credit/quote-server';
import { dailyDealsLineFor } from '../listing/daily-deals';
import { copyFilterModes } from '../tailoring/modes-server';
import type { DealType } from '../market/goals';
import { loadTrackedDeals, type TrackedLoad } from '../listing/tracked-server';
import type { ViewerDeal } from '../listing/tracked';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { profileTagsOrNull } from './deal-tags';
import { awaitingAnswers, blankProfileInput, dealsToHide, resetCandidates, resetPayload, restartActivity, type ResetAnswers, type ResetDeals } from './reset';
import {
  checkName,
  criteriaForNewProfile,
  DEFAULT_MAX_PROFILES,
  DEFAULT_PROFILE_NAME,
  isRunning,
  limitMessage,
  maxProfilesFor,
  parseProfileRow,
  primaryOf,
  profilePriceLine,
  PROFILE_COLUMNS,
  SHARED_QUESTION_IDS,
  type SavedProfile,
} from './rules';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;
const PAGE = 1000;

export interface ProfilesView {
  /** False when search_profiles cannot be read (schema not run): no switcher, nothing tagged. */
  readable: boolean;
  /** Every profile, deleted ones included (for labels), oldest first. */
  all: SavedProfile[];
  /** Not deleted. */
  live: SavedProfile[];
  active: SavedProfile | null;
  /** How many this member may keep: five, one for a team member. */
  max: number;
  teamMember: boolean;
}

const UNREADABLE: ProfilesView = { readable: false, all: [], live: [], active: null, max: 1, teamMember: false };

export async function maxProfilesSetting(admin: Admin): Promise<number> {
  const { data, error } = await admin.from('billing_settings').select('value').eq('key', 'saved_profiles_max').maybeSingle();
  if (error) console.warn('[profiles] saved_profiles_max unreadable, using the default:', error.message);
  const n = Number((data as { value: unknown } | null)?.value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_PROFILES;
}

async function readRows(admin: Admin, userId: string): Promise<SavedProfile[] | null> {
  const { data, error } = await admin.from('search_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).order('created_at', { ascending: true });
  if (error) {
    console.warn('[profiles] search_profiles unreadable (schema behind?):', error.message);
    return null;
  }
  return ((data ?? []) as unknown[]).map(parseProfileRow).filter((p): p is SavedProfile => p !== null);
}

/**
 * A member with no profile yet (signed up after the schema ran): their
 * first, "My deals", made from what they have now. A second request racing
 * this one hits the one-active-profile index and simply reads back the
 * winner's row.
 */
async function ensureFirstProfile(admin: Admin, userId: string): Promise<void> {
  const [goalsRes, areasRes, quizRes] = await Promise.all([
    admin.from('profiles').select('market_goals').eq('id', userId).maybeSingle(),
    admin.from('saved_areas').select('postcode_area').eq('user_id', userId),
    admin.from('profile_quiz').select('answered').eq('user_id', userId).maybeSingle(),
  ]);
  const { error } = await admin.rpc('create_search_profile', {
    p: {
      user: userId,
      name: DEFAULT_PROFILE_NAME,
      criteria: (goalsRes.data as { market_goals?: unknown } | null)?.market_goals ?? null,
      areas: ((areasRes.data ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area),
      answered: (quizRes.data as { answered?: unknown } | null)?.answered ?? {},
      for_client: false,
    },
  });
  if (error && error.code !== '23505') console.error('[profiles] first profile failed:', error.message);
}

/**
 * The member's profiles, once per request. Makes the first one if there is
 * none, and marks the oldest active if (somehow) none is.
 */
export const profilesFor = cache(async (userId: string): Promise<ProfilesView> => {
  if (!hasServiceRole()) return UNREADABLE;
  const admin = createAdminClient();
  let rows = await readRows(admin, userId);
  if (rows === null) return UNREADABLE;
  if (!rows.some((p) => !p.deletedAt)) {
    await ensureFirstProfile(admin, userId);
    rows = (await readRows(admin, userId)) ?? [];
  }
  let live = rows.filter((p) => !p.deletedAt);
  if (live.length > 0 && !live.some((p) => p.isActive)) {
    // The live copies are what the member sees: the oldest profile takes them over.
    const { error } = await admin.from('search_profiles').update({ is_active: true, updated_at: new Date().toISOString() }).eq('id', live[0].id).eq('user_id', userId);
    if (error) console.error('[profiles] active repair failed:', error.message);
    else rows = rows.map((p) => (p.id === live[0].id ? { ...p, isActive: true } : p));
    live = rows.filter((p) => !p.deletedAt);
  }
  const [team, max] = await Promise.all([teamOf(userId), maxProfilesSetting(admin), markAwaiting(admin, rows)]);
  const teamMember = team.role === 'member';
  return { readable: true, all: rows, live, active: live.find((p) => p.isActive) ?? null, max: maxProfilesFor(teamMember, max), teamMember };
});

export async function activeProfileFor(userId: string): Promise<SavedProfile | null> {
  return (await profilesFor(userId)).active;
}

/** Batch 22: the member's primary profile (rules.ts primaryOf): the reveal, the signup search and Batch 25 use it. */
export async function primaryProfileFor(userId: string): Promise<SavedProfile | null> {
  const view = await profilesFor(userId);
  if (!view.readable) return null;
  const id = primaryOf(view.all);
  return view.all.find((p) => p.id === id) ?? null;
}

/**
 * The id of the member's active profile, read-only (never creates one): what
 * a charge made outside a page names in its metadata for the Usage split.
 * Null when there is none or it cannot be read.
 */
export async function activeProfileIdOf(userId: string): Promise<string | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient().from('search_profiles').select('id').eq('user_id', userId).eq('is_active', true).is('deleted_at', null).limit(1);
  if (error) return null;
  const id = (data ?? [])[0]?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * Every running profile of these members, oldest first. Null when the table
 * cannot be read; a member missing from the map has no profile row yet (the
 * run then serves them as one profile, exactly as before this batch).
 */
export async function runningProfilesFor(admin: Admin, userIds: readonly string[]): Promise<Map<string, SavedProfile[]> | null> {
  const out = new Map<string, SavedProfile[]>();
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const some = userIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('search_profiles')
        .select(PROFILE_COLUMNS)
        .in('user_id', some)
        .is('deleted_at', null)
        .is('paused_at', null)
        .order('user_id', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn('[profiles] running profiles unreadable (schema behind?):', error.message);
        return null;
      }
      for (const raw of (data ?? []) as unknown[]) {
        const p = parseProfileRow(raw);
        if (p) out.set(p.userId, [...(out.get(p.userId) ?? []), p]);
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  await markAwaiting(admin, [...out.values()].flat());
  return out;
}

/**
 * Every profile row of these members, paused and deleted included (the
 * labels need both), oldest first: what the daily runs make seats from
 * (seatsFor). Null when the table cannot be read (schema not run): the runs
 * then serve every member as one seat, exactly as before this batch.
 */
export async function allProfilesFor(admin: Admin, userIds: readonly string[]): Promise<Map<string, SavedProfile[]> | null> {
  const out = new Map<string, SavedProfile[]>();
  const unique = [...new Set(userIds)];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const some = unique.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('search_profiles')
        .select(PROFILE_COLUMNS)
        .in('user_id', some)
        .order('user_id', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn('[profiles] profiles unreadable (schema behind?):', error.message);
        return null;
      }
      for (const raw of (data ?? []) as unknown[]) {
        const p = parseProfileRow(raw);
        if (p) out.set(p.userId, [...(out.get(p.userId) ?? []), p]);
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  await markAwaiting(admin, [...out.values()].flat());
  return out;
}

/** Profiles by id, deleted ones included: the names on labels. Empty on any failure. */
export async function profilesByIds(admin: Admin, ids: readonly string[]): Promise<Map<string, SavedProfile>> {
  const out = new Map<string, SavedProfile>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('search_profiles').select(PROFILE_COLUMNS).in('id', unique.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[profiles] profiles by id unreadable:', error.message);
      return out;
    }
    for (const raw of (data ?? []) as unknown[]) {
      const p = parseProfileRow(raw);
      if (p) out.set(p.id, p);
    }
  }
  return out;
}

/** "Daily deals for this profile: 43p a day (33p on a plan), about £13 a month, …" at this member's own price. */
export async function profilePriceLineFor(userId: string, adminUser: boolean): Promise<string | null> {
  const { payerId } = await payerFor(userId);
  const quoter = await quoterFor(payerId, adminUser);
  const daily = quoter.pricing.todays5DailyPence;
  return profilePriceLine(dailyDealsLineFor(quoter.label(adminUser ? 0 : daily), daily));
}

// ── Changes (each one the member's own, from a server action) ──

export type ProfileOutcome = { ok: true; id: string } | { ok: false; error: string };

const fail = (error: string): ProfileOutcome => ({ ok: false, error });

function own(view: ProfilesView, id: string): SavedProfile | null {
  return view.live.find((p) => p.id === id) ?? null;
}

export async function createProfile(input: { userId: string; name: unknown; copyFrom: string | null; types: DealType[]; forClient: boolean; blank?: boolean }): Promise<ProfileOutcome> {
  const view = await profilesFor(input.userId);
  if (!view.readable) return fail('Saved profiles are not available yet. Please try again shortly.');
  if (view.teamMember) return fail('Team members use the team’s profile.');
  if (view.live.length >= view.max) return fail(limitMessage(view.max));
  const name = checkName(input.name, view.all);
  if (!name.ok) return fail(name.error);
  // Batch 22d: "Start blank" copies nothing (and ignores the ticked types: the quiz asks them).
  const blank = input.blank === true;
  const source = blank ? null : ((input.copyFrom ? own(view, input.copyFrom) : null) ?? view.active);
  const { data, error } = await createAdminClient().rpc('create_search_profile', {
    p: blank
      ? blankProfileInput({ userId: input.userId, name: name.name, forClient: input.forClient })
      : {
          user: input.userId,
          name: name.name,
          criteria: criteriaForNewProfile(source?.goals ?? null, input.types),
          areas: source?.areas ?? [],
          // The types ticked here are this profile's answer to "Which deals do you want to see?".
          answered: source && input.types.length > 0 ? { ...source.answered, deal_types: { at: new Date().toISOString(), notSure: false } } : (source?.answered ?? {}),
          for_client: input.forClient,
          copied_from: source?.id ?? null,
        },
  });
  if (error) {
    if (error.code === 'P0409' || /profile_limit/.test(error.message)) return fail(limitMessage(view.max));
    if (error.code === '23505') return fail('You already have a profile with that name.');
    console.error('[profiles] create failed:', error.message);
    return fail('Could not create the profile. Please try again.');
  }
  const id = String(data);
  // Batch 14: the must-have / nice-to-have switches come with the copy.
  if (source) await copyFilterModes(source.id, id);
  // Batch 22d: a blank profile is a restart: no daily deals until it is answered, no signup reveal.
  // So is a copy of one still waiting for its answers (it would otherwise be charged on house picks).
  if (blank || source?.awaitingAnswers) await recordBlank(input.userId, id);
  logActivity(input.userId, 'saved_profile_created', { profileId: id, extras: { copied: Boolean(source), blank, for_client: input.forClient, deal_types: !blank && input.types.length > 0 ? input.types.join(',') : null } });
  return { ok: true, id };
}

export async function switchProfile(userId: string, profileId: string): Promise<ProfileOutcome> {
  const view = await profilesFor(userId);
  if (!view.readable) return fail('Saved profiles are not available yet.');
  const target = own(view, profileId);
  if (!target) return fail('That profile no longer exists.');
  if (target.isActive) return { ok: true, id: target.id };
  const { error } = await createAdminClient().rpc('select_search_profile', { p: { user: userId, profile: profileId, shared: SHARED_QUESTION_IDS } });
  if (error) {
    console.error('[profiles] switch failed:', error.message);
    return fail('Could not switch profile. Please try again.');
  }
  logActivity(userId, 'saved_profile_switched', { profileId, extras: { from: view.active?.id ?? null } });
  return { ok: true, id: profileId };
}

export async function renameProfile(userId: string, profileId: string, rawName: unknown): Promise<ProfileOutcome> {
  const view = await profilesFor(userId);
  const target = own(view, profileId);
  if (!target) return fail('That profile no longer exists.');
  const name = checkName(rawName, view.all, profileId);
  if (!name.ok) return fail(name.error);
  if (name.name === target.name) return { ok: true, id: profileId };
  const { error } = await createAdminClient().from('search_profiles').update({ name: name.name, updated_at: new Date().toISOString() }).eq('id', profileId).eq('user_id', userId).is('deleted_at', null);
  if (error) {
    if (error.code === '23505') return fail('You already have a profile with that name.');
    console.error('[profiles] rename failed:', error.message);
    return fail('Could not rename the profile. Please try again.');
  }
  logActivity(userId, 'saved_profile_renamed', { profileId });
  return { ok: true, id: profileId };
}

/** Pause or resume a profile's daily deals. Only ever the member's own choice: nothing pauses a profile automatically. */
export async function setProfilePaused(userId: string, profileId: string, paused: boolean): Promise<ProfileOutcome> {
  const view = await profilesFor(userId);
  const target = own(view, profileId);
  if (!target) return fail('That profile no longer exists.');
  if (isRunning(target) === !paused) return { ok: true, id: profileId };
  const nowIso = new Date().toISOString();
  const { error } = await createAdminClient().from('search_profiles').update({ paused_at: paused ? nowIso : null, updated_at: nowIso }).eq('id', profileId).eq('user_id', userId).is('deleted_at', null);
  if (error) {
    console.error('[profiles] pause failed:', error.message);
    return fail('Could not change the profile. Please try again.');
  }
  logActivity(userId, paused ? 'saved_profile_paused' : 'saved_profile_resumed', { profileId });
  return { ok: true, id: profileId };
}

/**
 * Deletes a profile: its daily deals stop from the next run, and its deals
 * stay on My deals as "(deleted profile)". The active profile cannot be
 * deleted (switch first), which also means the last one never can be.
 */
export async function deleteProfile(userId: string, profileId: string): Promise<ProfileOutcome> {
  const view = await profilesFor(userId);
  const target = own(view, profileId);
  if (!target) return fail('That profile no longer exists.');
  if (target.isActive) return fail('Switch to another profile before deleting this one.');
  const nowIso = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from('search_profiles')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('id', profileId)
    .eq('user_id', userId)
    .eq('is_active', false)
    .is('deleted_at', null)
    .select('id');
  if (error) {
    console.error('[profiles] delete failed:', error.message);
    return fail('Could not delete the profile. Please try again.');
  }
  if ((data ?? []).length === 0) return fail('Switch to another profile before deleting this one.');
  logActivity(userId, 'saved_profile_deleted', { profileId });
  return { ok: true, id: profileId };
}

// ── Batch 22d: Start again and Start blank (rules in reset.ts) ──

/**
 * Marks the profiles that were reset or made blank and have not answered
 * their own mandatory search questions (seatsFor then gives them no daily
 * deals and no charge). Only profiles with a restart are ever marked, so a
 * member who never used either is served exactly as before. Fails open.
 */
async function markAwaiting(admin: Admin, rows: SavedProfile[]): Promise<void> {
  const ids = [...new Set(rows.map((p) => p.id))];
  const restarted = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('profile_restarts').select('profile_id').in('profile_id', ids.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[profiles] restarts unreadable (schema behind?):', error.message);
      return;
    }
    for (const r of (data ?? []) as { profile_id: string | null }[]) if (r.profile_id) restarted.add(r.profile_id);
  }
  for (const p of rows) if (restarted.has(p.id)) p.awaitingAnswers = awaitingAnswers(p);
}

async function recordBlank(userId: string, profileId: string): Promise<void> {
  const { error } = await createAdminClient().from('profile_restarts').insert({ user_id: userId, profile_id: profileId, kind: 'blank' });
  if (error) console.warn('[profiles] blank restart not recorded (schema behind?):', error.message);
}

/**
 * Each profile's latest restart at or after `since` (profile id → ISO), for
 * the learning cutoff: only what came after it counts. Empty when unreadable.
 */
export async function latestRestartsFor(admin: Admin, profileIds: readonly (string | null | undefined)[], since: Date): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(profileIds.filter((x): x is string => Boolean(x)))];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('profile_restarts').select('profile_id, created_at').in('profile_id', ids.slice(i, i + ID_CHUNK)).gte('created_at', since.toISOString());
    if (error) {
      console.warn('[profiles] restarts unreadable (schema behind?):', error.message);
      return out;
    }
    for (const r of (data ?? []) as { profile_id: string; created_at: string }[]) {
      const prev = out.get(r.profile_id);
      if (!prev || Date.parse(r.created_at) > Date.parse(prev)) out.set(r.profile_id, r.created_at);
    }
  }
  return out;
}

/**
 * Whether this profile (or, with none, any of the member's) was restarted at
 * or after `since`: something from before a restart (an old pick email's
 * link) then changes nothing. False on any failure.
 */
export async function restartedSince(admin: Admin, p: { userId: string; profileId: string | null }, since: string): Promise<boolean> {
  let q = admin.from('profile_restarts').select('id').eq('user_id', p.userId).eq('kind', 'reset').gte('created_at', since).limit(1);
  if (p.profileId) q = q.eq('profile_id', p.profileId);
  const { data, error } = await q;
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Whether this member has ever reset a profile or made a blank one: no signup reveal or search after that. False on any failure. */
export const hasRestartFor = cache(async (userId: string): Promise<boolean> => {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient().from('profile_restarts').select('id').eq('user_id', userId).limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
});

export interface ResetChoices {
  /** False: saved profiles cannot be read, so there is nothing to reset. */
  readable: boolean;
  active: SavedProfile | null;
  teamMember: boolean;
  /** Everything My deals shows, for drawing the rows. */
  load: TrackedLoad | null;
  /** The active profile's own tracked deals, as My deals shows them: what the reset may clear. */
  deals: ViewerDeal[];
  /** False: which profile each deal is for cannot be read, so every deal is kept. */
  tagsReadable: boolean;
}

/** The confirm screen's choices: the active profile and its tracked deals. */
export async function resetChoicesFor(userId: string, adminUser: boolean): Promise<ResetChoices> {
  const view = await profilesFor(userId);
  if (!view.readable || !view.active) return { readable: false, active: null, teamMember: view.teamMember, load: null, deals: [], tagsReadable: false };
  const load = await loadTrackedDeals(userId, { scope: 'team', adminUser });
  const tags = await profileTagsOrNull(userId, load.payerId, load.view);
  if (!tags) return { readable: true, active: view.active, teamMember: view.teamMember, load, deals: [], tagsReadable: false };
  const keys = new Set(resetCandidates(load.view, tags, view.active.id));
  return { readable: true, active: view.active, teamMember: view.teamMember, load, deals: load.view.filter((v) => keys.has(v.key)), tagsReadable: true };
}

/**
 * Start again: always the signed-in member's ACTIVE profile (never one named
 * by the form). `shown` are the deal keys the confirm screen listed and `keep`
 * the ticked ones; whatever is posted, only the active profile's own entries
 * that were shown can be cleared (reset.ts dealsToHide). Logs profile_reset
 * once. The £5 is never touched.
 */
export async function resetActiveProfile(input: { userId: string; adminUser: boolean; answers: ResetAnswers; deals: ResetDeals; shown: readonly string[]; keep: readonly string[] }): Promise<ProfileOutcome> {
  const choices = await resetChoicesFor(input.userId, input.adminUser);
  if (!choices.readable || !choices.active) return fail('Your profile can’t be reset right now. Please try again shortly.');
  if (input.deals !== 'keep_all' && !choices.tagsReadable) return fail('Your tracked deals can’t be read right now. Please try again, or keep them all.');
  const candidates = choices.deals.map((d) => d.key);
  const hide = dealsToHide({ candidates, choice: input.deals, shown: input.shown, keep: input.keep });
  const shown = new Set(input.shown);
  const kept = candidates.filter((k) => shown.has(k)).length - hide.length;
  const payload = resetPayload({ userId: input.userId, answers: input.answers, deals: input.deals, hide, kept });
  const { data, error } = await createAdminClient().rpc('reset_search_profile', { p: payload });
  if (error) {
    if (error.code === 'P0404') return fail('That profile no longer exists.');
    console.error('[profiles] reset failed:', error.message);
    return fail('Could not start again. Please try again.');
  }
  const id = String(data);
  const event = restartActivity(id, { answers: input.answers, kept: payload.kept, cleared: payload.cleared });
  logActivity(input.userId, event.kind, { profileId: choices.active.id, extras: event.extras, dedupeKey: event.dedupeKey });
  // "About you" went too: Monday's "Next deal" follows (queued, after the response).
  if (input.answers === 'everything') after(() => queueFunnelSync(input.userId, 'next_deal'));
  return { ok: true, id };
}
