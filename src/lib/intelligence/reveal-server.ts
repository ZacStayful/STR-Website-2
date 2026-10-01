import 'server-only';

/**
 * Batch 22, Part B: the signup reveal's reads and writes (signup_reveals).
 * Every read fails open: if the table is missing or unreadable, nobody is sent
 * to the reveal and Today works as before.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { teamOf } from '../team';
import { logActivity } from '../activity/log';
import { isRevealAccount } from './settings';

export interface RevealRow {
  userId: string;
  profileId: string | null;
  day: string;
  dealIds: string[];
  offerDealIds: string[];
  shownIds: string[];
  checked: number | null;
  noMatch: boolean;
  viewedAt: string | null;
  firstKeepAt: string | null;
  choicesAt: string | null;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function parse(r: Record<string, unknown> | null): RevealRow | null {
  if (!r || typeof r.user_id !== 'string') return null;
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    userId: r.user_id,
    profileId: s(r.profile_id),
    day: String(r.day),
    dealIds: ids(r.deal_ids),
    offerDealIds: ids(r.offer_deal_ids),
    shownIds: ids(r.shown_ids),
    checked: typeof r.checked === 'number' ? r.checked : null,
    noMatch: r.no_match === true,
    viewedAt: s(r.viewed_at),
    firstKeepAt: s(r.first_keep_at),
    choicesAt: s(r.choices_at),
  };
}

const COLUMNS = 'user_id, profile_id, day, deal_ids, offer_deal_ids, shown_ids, checked, no_match, viewed_at, first_keep_at, choices_at';

/** The member's reveal row; null when there is none, or it cannot be read. */
export async function revealRowFor(userId: string): Promise<RevealRow | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient().from('signup_reveals').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) return null;
  return parse(data as Record<string, unknown> | null);
}

/**
 * Is this a new member the reveal is for? Created at or after reveal_from,
 * not a team seat. False on any doubt.
 */
export async function isRevealMember(userId: string, createdAt: string | null | undefined): Promise<boolean> {
  try {
    const settings = await getBillingSettings();
    if (!isRevealAccount(createdAt, settings.intelligence)) return false;
    const team = await teamOf(userId);
    return team.role !== 'member';
  } catch {
    return false;
  }
}

/**
 * The gate (AppShell, after the quiz gate): a new member whose mandatory
 * answers are done and who has not viewed their reveal goes there. Fails
 * open: any error, and the member carries on to the page they asked for.
 */
export async function revealPending(userId: string, createdAt: string | null | undefined): Promise<boolean> {
  try {
    if (!hasServiceRole()) return false;
    if (!(await isRevealMember(userId, createdAt))) return false;
    const { data, error } = await createAdminClient().from('signup_reveals').select('viewed_at').eq('user_id', userId).maybeSingle();
    if (error) return false;
    return !(data as { viewed_at?: string | null } | null)?.viewed_at;
  } catch {
    return false;
  }
}

/**
 * The reveal, recorded before it renders (so the welcome price works on the
 * first tap). The first write wins; a reload reads it back unchanged.
 */
export async function recordReveal(input: { userId: string; profileId: string | null; day: string; dealIds: string[]; checked: number | null; noMatch: boolean; level: number }): Promise<RevealRow | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const { error } = await admin
    .from('signup_reveals')
    .upsert(
      { user_id: input.userId, profile_id: input.profileId, day: input.day, deal_ids: input.dealIds, offer_deal_ids: input.dealIds, shown_ids: input.dealIds, checked: input.checked, no_match: input.noMatch, level: input.level },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
  if (error) {
    console.error('[reveal] record failed:', error.message);
    return null;
  }
  return revealRowFor(input.userId);
}

/** First view: stamped once, and logged once (it counts towards weekly active). */
export async function markRevealViewed(userId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  const { data, error } = await createAdminClient()
    .from('signup_reveals')
    .update({ viewed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('user_id', userId)
    .is('viewed_at', null)
    .select('user_id');
  if (error) {
    console.error('[reveal] view stamp failed:', error.message);
    return;
  }
  if ((data ?? []).length > 0) logActivity(userId, 'reveal_viewed', { dedupeKey: 'reveal_viewed' });
}

/**
 * A Keep: if it is the member's first since their reveal, how long it took
 * (for "time to first Keep"). Null otherwise, or on any failure.
 */
export async function noteRevealKeep(userId: string, now: Date = new Date()): Promise<{ ms: number } | null> {
  if (!hasServiceRole()) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('signup_reveals')
      .update({ first_keep_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('user_id', userId)
      .is('first_keep_at', null)
      .not('viewed_at', 'is', null)
      .select('viewed_at');
    if (error || !data || data.length === 0) return null;
    const viewed = Date.parse(String((data[0] as { viewed_at: string }).viewed_at));
    if (!Number.isFinite(viewed)) return null;
    const ms = Math.max(0, now.getTime() - viewed);
    await admin.from('signup_reveals').update({ first_keep_ms: Math.min(ms, 2_000_000_000) }).eq('user_id', userId);
    return { ms };
  } catch {
    return null;
  }
}

/** The notification choices screen was answered (or skipped). */
export async function markChoicesDone(userId: string, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  await createAdminClient().from('signup_reveals').update({ choices_at: now.toISOString(), updated_at: now.toISOString() }).eq('user_id', userId).is('choices_at', null);
}

/** A search refresh replaced a card the member was shown: it stays in shown_ids. */
export async function addRevealShown(userId: string, dealIds: readonly string[]): Promise<void> {
  if (!hasServiceRole() || dealIds.length === 0) return;
  const row = await revealRowFor(userId);
  if (!row) return;
  const shown = [...new Set([...row.shownIds, ...dealIds])];
  await createAdminClient().from('signup_reveals').update({ shown_ids: shown, updated_at: new Date().toISOString() }).eq('user_id', userId);
}

/** Every deal any member's reveal showed, of these: the morning pick never repeats one (bug 5, revealed deals). */
export async function revealedFor(userIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!hasServiceRole() || userIds.length === 0) return out;
  for (let i = 0; i < userIds.length; i += 200) {
    const { data, error } = await createAdminClient().from('signup_reveals').select('user_id, shown_ids').in('user_id', userIds.slice(i, i + 200));
    if (error) return out;
    for (const r of (data ?? []) as { user_id: string; shown_ids: unknown }[]) out.set(r.user_id, new Set(ids(r.shown_ids)));
  }
  return out;
}
