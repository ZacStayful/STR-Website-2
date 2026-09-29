/**
 * Saved profiles (Batch 13): the rules, with no database.
 *
 * A member keeps up to billing_settings.saved_profiles_max profiles (five),
 * each one set of search criteria: the MarketGoals the quiz writes, the
 * "specific areas" answer and the quiz's answered marks. "About you" stays
 * the member's own. One profile is active (the one the header shows); a
 * profile is running unless the member has paused or deleted it, and each
 * running profile gets its own Today's 5 and its own daily charge.
 *
 * Words used in code:
 *   active    the profile selected in the header          activeProfileFor()
 *   running   not paused, not deleted: gets daily deals   runningProfilesFor()
 *             (the brief's "all active profiles")
 *
 * Pure: no network, no database, no server-only.
 */
import { parseMarketGoals, type DealType, type MarketGoals } from '../market/goals.ts';
import { DEAL_TYPE_LONG_LABELS, DEAL_TYPES, kindsFor, orderedTypes } from '../profile/deal-types.ts';
import { parseAnswered, type AnsweredMap } from '../profile/state.ts';
import type { QuestionId } from '../profile/questions.ts';

export const DEFAULT_PROFILE_NAME = 'My deals';
export const PROFILE_NAME_MAX = 40;
/** The fallback when billing_settings.saved_profiles_max is missing: the seeded value. */
export const DEFAULT_MAX_PROFILES = 5;

export const NAME_HINT = 'Use a nickname or initials for a client, e.g. "Client: JS". No full names needed.';
export const CLIENT_PERMISSION_LINE = 'Only add a client’s details with their permission.';

/**
 * The quiz questions whose answers live in "About you" (profiles.about_you):
 * the member's own, shared by every profile. Every other answer belongs to
 * the profile it was given in. Switching keeps these marks as they are.
 */
export const SHARED_QUESTION_IDS: readonly QuestionId[] = ['roles', 'deals_done', 'units_now', 'unit_areas', 'time', 'next_deal', 'deals_wanted', 'blocker', 'risk'];

/** "Which deals should this profile show?" when a profile is made (Batch 17: the deal types, not a path). */
export const TYPE_CHOICES: readonly { value: DealType; label: string }[] = DEAL_TYPES.map((t) => ({ value: t, label: DEAL_TYPE_LONG_LABELS[t] }));

/** The ticked types from the form, in the question's order; unknown values dropped. */
export function typesFromForm(values: readonly unknown[]): DealType[] {
  return orderedTypes(values.filter((v): v is DealType => (DEAL_TYPES as readonly unknown[]).includes(v)));
}

export interface SavedProfile {
  id: string;
  userId: string;
  name: string;
  /** Null: no preferences yet (house picks). */
  goals: MarketGoals | null;
  areas: string[];
  answered: AnsweredMap;
  forClient: boolean;
  copiedFrom: string | null;
  isActive: boolean;
  pausedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export const PROFILE_COLUMNS = 'id, user_id, name, criteria, areas, answered, for_client, copied_from, is_active, paused_at, deleted_at, created_at';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** A stored row, tolerant of anything malformed (a bad row is dropped, never a crash). */
export function parseProfileRow(raw: unknown): SavedProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const userId = str(r.user_id);
  const name = str(r.name);
  if (!id || !userId || !name) return null;
  return {
    id,
    userId,
    name,
    goals: parseMarketGoals(r.criteria),
    areas: Array.isArray(r.areas) ? r.areas.filter((a): a is string => typeof a === 'string').map((a) => a.toUpperCase()) : [],
    answered: parseAnswered(r.answered),
    forClient: r.for_client === true,
    copiedFrom: str(r.copied_from),
    isActive: r.is_active === true,
    pausedAt: str(r.paused_at),
    deletedAt: str(r.deleted_at),
    createdAt: str(r.created_at) ?? new Date(0).toISOString(),
  };
}

export function isRunning(p: Pick<SavedProfile, 'pausedAt' | 'deletedAt'>): boolean {
  return !p.pausedAt && !p.deletedAt;
}

/** How many profiles a member may keep: team members keep the one they have. */
export function maxProfilesFor(teamMember: boolean, max: number): number {
  return teamMember ? 1 : Math.max(1, Math.floor(max));
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** A profile name: trimmed, 1–40 characters, not the same as another of the member's (ignoring case). */
export function checkName(raw: unknown, others: readonly Pick<SavedProfile, 'id' | 'name' | 'deletedAt'>[], selfId: string | null = null): NameCheck {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { ok: false, error: 'Give the profile a name.' };
  if (name.length > PROFILE_NAME_MAX) return { ok: false, error: `Keep the name to ${PROFILE_NAME_MAX} characters.` };
  const clash = others.some((p) => !p.deletedAt && p.id !== selfId && p.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, error: 'You already have a profile with that name.' };
  return { ok: true, name };
}

export function limitReached(liveCount: number, max: number): boolean {
  return liveCount >= max;
}

export function limitMessage(max: number): string {
  return `You have ${max} profiles, the most you can keep. Delete one you no longer need, or reuse one: rename it and change its answers.`;
}

/** Profile names show on cards, emails, My deals and Usage once a member has two or more (or deleted one). */
export function labelsShown(profiles: readonly Pick<SavedProfile, 'deletedAt'>[]): boolean {
  return profiles.filter((p) => !p.deletedAt).length >= 2 || profiles.some((p) => p.deletedAt);
}

/** "Client: JS", or "Client: JS (deleted profile)". */
export function profileLabel(p: Pick<SavedProfile, 'name' | 'deletedAt'>): string {
  return p.deletedAt ? `${p.name} (deleted profile)` : p.name;
}

/**
 * The name to label something with (a change on a tracked deal, a missed
 * pick, a recap line): the profile's label when the member's labels show,
 * else null. `profiles` is every row the member has, deleted ones included.
 */
export function labelFor(profiles: readonly Pick<SavedProfile, 'id' | 'name' | 'deletedAt'>[] | undefined, profileId: string | null | undefined): string | null {
  if (!profiles || !profileId || !labelsShown(profiles)) return null;
  const p = profiles.find((x) => x.id === profileId);
  return p ? profileLabel(p) : null;
}

/**
 * The order a member's running profiles are served and charged in: the
 * active one first, then oldest first. When credit runs out part-way, the
 * ones at the end are the ones that miss the day.
 */
export function chargeOrder<P extends Pick<SavedProfile, 'id' | 'isActive' | 'createdAt' | 'pausedAt' | 'deletedAt'>>(profiles: readonly P[]): P[] {
  return profiles.filter(isRunning).sort((a, b) => Number(b.isActive) - Number(a.isActive) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * One member's place in a daily run (the picks passes and the digest): a
 * section of the one daily email and one daily charge each. `profile` is null
 * for a member with no profile row (the schema not run yet, or a signup the
 * lazy first profile has not reached): one section, charged as before.
 */
export interface Seat {
  userId: string;
  profile: SavedProfile | null;
  /** The key a run keeps a seat's picks, list and charge under. */
  key: string;
  /** The section heading: the profile's name when labels show, else null (no heading). */
  heading: string | null;
}

export function seatKey(userId: string, profileId: string | null): string {
  return profileId ? `${userId}:${profileId}` : userId;
}

/**
 * A member's seats for the day, in charge order (active first, then oldest).
 * `profiles` is every row the member has (paused and deleted included, for
 * the labels); undefined when they have none. `allPaused`: they have
 * profiles and every one is paused, so no Today's 5 and no charge.
 */
export function seatsFor(userId: string, profiles: readonly SavedProfile[] | undefined): { seats: Seat[]; allPaused: boolean } {
  if (!profiles || profiles.every((p) => p.deletedAt)) return { seats: [{ userId, profile: null, key: seatKey(userId, null), heading: null }], allPaused: false };
  const running = chargeOrder(profiles);
  const labelled = labelsShown(profiles);
  return {
    seats: running.map((p) => ({ userId, profile: p, key: seatKey(userId, p.id), heading: labelled ? p.name : null })),
    allPaused: running.length === 0,
  };
}

/**
 * Where a profile's "Open Today" and "Edit" links go from an email: straight
 * to the page for the active profile, through the switch route for another
 * one (it needs the session and only changes which profile the header shows).
 */
export function profileLinks(siteUrl: string, profile: Pick<SavedProfile, 'id' | 'isActive'> | null, editPath: string): { today: string; edit: string } {
  const base = siteUrl.replace(/\/$/, '');
  if (!profile || profile.isActive) return { today: `${base}/today`, edit: `${base}${editPath}` };
  const via = (next: string) => `${base}/profiles/switch?to=${encodeURIComponent(profile.id)}&next=${encodeURIComponent(next)}`;
  return { today: via('/today'), edit: via(editPath) };
}

/**
 * A new profile's criteria: a copy of the one it was made from, showing the
 * deal types the member ticked ("Which deals should this profile show?"), so
 * the quiz asks those types' questions for it. The search kind follows the
 * types, as the quiz sets it. None ticked: the copy as it is.
 */
export function criteriaForNewProfile(source: MarketGoals | null, types: readonly DealType[]): MarketGoals | null {
  if (!source) return null;
  if (types.length === 0) return source;
  return { ...source, dealTypes: orderedTypes(types), sourcingKind: kindsFor(types) };
}

/** The price line shown before creating a profile and on its settings, from the member's own daily-deals line. */
export function profilePriceLine(dailyLine: string | null): string | null {
  if (!dailyLine) return null;
  return dailyLine.replace(/^Daily deals:/, 'Daily deals for this profile:');
}

/**
 * Which profile a My deals entry belongs to: the same precedence the merge
 * uses for its stage (src/lib/listing/tracked.ts): the pipeline row, else the
 * Keep / Pass, else the pick, else the open. Null when none is tagged.
 */
export function entryProfile(tags: { pipeline?: string | null; reaction?: string | null; pick?: string | null; open?: string | null }): string | null {
  return tags.pipeline ?? tags.reaction ?? tags.pick ?? tags.open ?? null;
}
