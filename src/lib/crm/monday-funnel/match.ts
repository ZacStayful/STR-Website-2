/**
 * Which Monday row is which member's (Batch 20, Part F). Pure.
 *
 * A member's rows are found by the row stored on their profile
 * (profiles.monday_item_id), by email (exact, then ignoring case: the board
 * has rows typed with capitals) and by mobile number (the board's text
 * normalised as the welcome check does). Rows in every group count, so
 * nobody who has a row is ever given a second.
 *
 *   One row, two members     the member it matches best keeps it: email
 *                            before the stored link before the number; then
 *                            the older account.
 *   One member, two rows     the stored row, else the best match, else the
 *                            oldest; the others are listed and never touched
 *                            (rows are not merged).
 *   A row in Excluded        never touched. When it is the member's own row
 *                            (the one kept above), the member is left alone
 *                            entirely: no update, no move, no second row. A
 *                            duplicate in Excluded that only shares their
 *                            number does not exclude a member whose own row
 *                            is elsewhere.
 *   A row nobody matches     untouched.
 */
import { normaliseMobile } from '../../credit/abuse.ts';
import { GROUPS } from './config.ts';
import type { RawColumn } from './values.ts';

export interface BoardItem {
  id: string;
  name: string;
  groupId: string;
  createdAt: string | null;
  /** The Email Address column's text. */
  email: string | null;
  /** The Mobile Number column's text. */
  mobile: string | null;
  columns: RawColumn[];
}

export interface MemberKeys {
  userId: string;
  email: string | null;
  mobileKey: string | null;
  storedItemId: string | null;
  createdAt: string | null;
}

export type MatchVia = 'email' | 'email_case' | 'stored' | 'mobile';
const STRENGTH: Record<MatchVia, number> = { email: 0, email_case: 1, stored: 2, mobile: 3 };

export interface MatchResult {
  matched: Map<string, { item: BoardItem; via: MatchVia }>;
  /** Members whose row is in Excluded, with that row (their profile is linked to it). */
  excluded: Map<string, BoardItem>;
  duplicates: { userId: string; kept: string; others: string[] }[];
}

/** Oldest first: by creation time (unknown last), then by id (Monday's ids are numbers, so shorter is older). */
function older(a: { createdAt: string | null; id: string }, b: { createdAt: string | null; id: string }): number {
  const key = (x: { createdAt: string | null }) => {
    const t = x.createdAt ? Date.parse(x.createdAt) : Number.NaN;
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  const d = key(a) - key(b);
  if (d !== 0) return d;
  return a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function matchMembers(members: readonly MemberKeys[], items: readonly BoardItem[]): MatchResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const byEmail = new Map<string, BoardItem[]>();
  const byEmailCase = new Map<string, BoardItem[]>();
  const byMobile = new Map<string, BoardItem[]>();
  for (const item of items) {
    const email = item.email?.trim();
    if (email) {
      push(byEmail, email, item);
      push(byEmailCase, email.toLowerCase(), item);
    }
    const key = normaliseMobile(item.mobile);
    if (key) push(byMobile, key, item);
  }

  // Every member's candidate rows, with how well each matches.
  const claims = new Map<string, { member: MemberKeys; via: MatchVia }[]>();
  for (const m of members) {
    const mine = new Map<string, MatchVia>();
    const add = (list: BoardItem[] | undefined, via: MatchVia) => {
      for (const item of list ?? []) {
        const had = mine.get(item.id);
        if (!had || STRENGTH[via] < STRENGTH[had]) mine.set(item.id, via);
      }
    };
    const email = m.email?.trim();
    if (email) {
      add(byEmail.get(email), 'email');
      add(byEmailCase.get(email.toLowerCase()), 'email_case');
    }
    if (m.storedItemId && byId.has(m.storedItemId)) add([byId.get(m.storedItemId)!], 'stored');
    if (m.mobileKey) add(byMobile.get(m.mobileKey), 'mobile');
    for (const [itemId, via] of mine) push(claims, itemId, { member: m, via });
  }

  // A row claimed twice goes to the best match, then the older account.
  const won = new Map<string, { item: BoardItem; via: MatchVia }[]>();
  for (const [itemId, list] of claims) {
    const best = [...list].sort((a, b) => STRENGTH[a.via] - STRENGTH[b.via] || older({ createdAt: a.member.createdAt, id: a.member.userId }, { createdAt: b.member.createdAt, id: b.member.userId }))[0];
    push(won, best.member.userId, { item: byId.get(itemId)!, via: best.via });
  }

  const result: MatchResult = { matched: new Map(), excluded: new Map(), duplicates: [] };
  for (const m of members) {
    const rows = won.get(m.userId);
    if (!rows?.length) continue;
    const stored = m.storedItemId ? rows.find((r) => r.item.id === m.storedItemId) : undefined;
    const kept = stored ?? [...rows].sort((a, b) => STRENGTH[a.via] - STRENGTH[b.via] || older(a.item, b.item))[0];
    if (kept.item.groupId === GROUPS.excluded) {
      result.excluded.set(m.userId, kept.item);
      continue;
    }
    result.matched.set(m.userId, kept);
    if (rows.length > 1) result.duplicates.push({ userId: m.userId, kept: kept.item.id, others: rows.filter((r) => r !== kept).map((r) => r.item.id) });
  }
  return result;
}
