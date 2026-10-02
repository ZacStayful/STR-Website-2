import 'server-only';

/**
 * Which saved profile each of a member's My deals entries belongs to (Batch
 * 13). Read apart from My deals' own fixed selects (tracked-server.ts), so a
 * database the schema has not caught up with shows My deals exactly as
 * before, just without labels. Only the viewer's own entries are tagged: a
 * teammate's deal belongs to the teammate's profile, which is not theirs to
 * name or filter by.
 */
import { createAdminClient } from '../supabase/admin';
import { entryProfile } from './rules';

type Admin = ReturnType<typeof createAdminClient>;

const CHUNK = 150;

export interface TaggableEntry {
  key: string;
  dealId: string | null;
  checkedListingId: string | null;
  mine: boolean;
}

async function tagMap(admin: Admin, table: string, keyColumn: string, userColumn: string, userId: string, keys: string[]): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await admin.from(table).select(`${keyColumn}, profile_id`).eq(userColumn, userId).in(keyColumn, keys.slice(i, i + CHUNK)).not('profile_id', 'is', null);
    if (error) {
      console.warn(`[profiles] ${table} tags unreadable (schema behind?):`, error.message);
      return null;
    }
    for (const r of (data ?? []) as unknown as Record<string, string>[]) if (r[keyColumn] && r.profile_id && !out.has(r[keyColumn])) out.set(r[keyColumn], r.profile_id);
  }
  return out;
}

/** entry key → profile id, for the viewer's own entries. Empty when the tags cannot be read. */
export async function profileTagsFor(userId: string, payerId: string, entries: readonly TaggableEntry[]): Promise<Map<string, string>> {
  return (await profileTagsOrNull(userId, payerId, entries)) ?? new Map();
}

/**
 * The same, but null when the tags cannot be read: Batch 22d's Start again,
 * which must never take "unreadable" for "untagged" (an untagged entry counts
 * as the active profile's there, so it could clear another profile's deal).
 */
export async function profileTagsOrNull(userId: string, payerId: string, entries: readonly TaggableEntry[]): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  const own = entries.filter((e) => e.mine);
  if (own.length === 0) return out;
  const admin = createAdminClient();
  const rowIds = [...new Set(own.map((e) => e.checkedListingId).filter((x): x is string => Boolean(x)))];
  const dealIds = [...new Set(own.map((e) => e.dealId).filter((x): x is string => Boolean(x)))];
  const [rows, reactions, picks, opens] = await Promise.all([
    tagMap(admin, 'checked_listings', 'id', 'user_id', userId, rowIds),
    tagMap(admin, 'deal_reactions', 'deal_id', 'user_id', userId, dealIds),
    tagMap(admin, 'sourcing_sent', 'deal_id', 'user_id', userId, dealIds),
    // An open is the payer's; only someone paying for themselves has theirs tagged.
    payerId === userId ? tagMap(admin, 'deal_opens', 'deal_id', 'user_id', userId, dealIds) : Promise.resolve(new Map<string, string>()),
  ]);
  if (!rows || !reactions || !picks || !opens) return null;
  for (const e of own) {
    const id = entryProfile({
      pipeline: e.checkedListingId ? rows.get(e.checkedListingId) : null,
      reaction: e.dealId ? reactions.get(e.dealId) : null,
      pick: e.dealId ? picks.get(e.dealId) : null,
      open: e.dealId ? opens.get(e.dealId) : null,
    });
    if (id) out.set(e.key, id);
  }
  return out;
}

/** pick id → profile id, for the member's own picks (the Daily picks page). Empty when unreadable. */
export async function pickProfileTags(userId: string, pickIds: readonly string[]): Promise<Map<string, string>> {
  return (await tagMap(createAdminClient(), 'sourcing_sent', 'id', 'user_id', userId, [...new Set(pickIds)])) ?? new Map();
}
