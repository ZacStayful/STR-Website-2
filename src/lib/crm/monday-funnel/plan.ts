/**
 * What a sync would do to the board (Batch 20, Part F): for every member,
 * their row (./match.ts), the group they belong in (./precedence.ts) and the
 * columns that differ (./values.ts). The nightly, the backfill and the queue
 * all run through this, so a dry run prints exactly what a real run writes.
 * Pure.
 *
 * Moves: a row moves only between the site's own stages. Excluded is never
 * left or entered; "Customer – plan to confirm" is left only once the
 * member's state is known; a group the site does not know is left alone.
 *
 * Creates: only when asked (the nightly and the backfill, never the queue),
 * and only for an account at least an hour old, so the row sign-up makes
 * (src/lib/apis/monday.ts ensureEnquiry) is found rather than duplicated. A
 * new row goes straight into its group; a member the site cannot place (a
 * plan set by hand with no tier) goes to "Customer – plan to confirm".
 */
import { GROUP_TITLES, groupOf, type ColumnKey, type FunnelGroup } from './config.ts';
import type { MemberFacts } from './facts.ts';
import { matchMembers, type BoardItem, type MatchResult, type MatchVia } from './match.ts';
import { funnelGroup } from './precedence.ts';
import { changedColumns, currentRow, desiredRow, type Cell } from './values.ts';

export interface RowUpdate {
  userId: string;
  itemId: string;
  via: MatchVia;
  from: FunnelGroup | null;
  /** The group to move to; null stays put. */
  to: FunnelGroup | null;
  changes: Partial<Record<ColumnKey, Cell>>;
}

export interface RowCreate {
  userId: string;
  group: FunnelGroup;
  name: string;
  changes: Partial<Record<ColumnKey, Cell>>;
}

export interface FunnelPlan {
  updates: RowUpdate[];
  creates: RowCreate[];
  /** Profiles whose stored row id should change (matched, or linked to their Excluded row). */
  links: { userId: string; itemId: string }[];
  excluded: string[];
  duplicates: MatchResult['duplicates'];
  /** Members with no row: too new to create yet, or not asked to create. */
  noRow: { userId: string; reason: 'too_new' | 'not_created' }[];
  unchanged: number;
}

export interface PlanOptions {
  lowCreditPence: number;
  now: Date;
  createMissing: boolean;
  createMinAgeMs: number;
}

/** A known stage the site may move a row out of. */
function movable(from: FunnelGroup | null): boolean {
  return from !== null && from !== 'excluded';
}

export function planFunnel(facts: readonly MemberFacts[], items: readonly BoardItem[], o: PlanOptions): FunnelPlan {
  const match = matchMembers(
    facts.map((f) => ({ userId: f.userId, email: f.email, mobileKey: f.mobileKey, storedItemId: f.mondayItemId, createdAt: f.createdAt })),
    items,
  );
  const plan: FunnelPlan = { updates: [], creates: [], links: [], excluded: [], duplicates: match.duplicates, noRow: [], unchanged: 0 };
  for (const f of facts) {
    const excludedRow = match.excluded.get(f.userId);
    if (excludedRow) {
      plan.excluded.push(f.userId);
      if (f.mondayItemId !== excludedRow.id) plan.links.push({ userId: f.userId, itemId: excludedRow.id });
      continue;
    }
    const target = funnelGroup(f, o.lowCreditPence);
    const desired = desiredRow(f, o.lowCreditPence);
    const hit = match.matched.get(f.userId);
    if (hit) {
      if (f.mondayItemId !== hit.item.id) plan.links.push({ userId: f.userId, itemId: hit.item.id });
      const from = groupOf(hit.item.groupId);
      const to = target !== 'untouched' && movable(from) && from !== target ? target : null;
      const changes = changedColumns(currentRow(hit.item.columns), desired);
      if (to === null && Object.keys(changes).length === 0) {
        plan.unchanged += 1;
        continue;
      }
      plan.updates.push({ userId: f.userId, itemId: hit.item.id, via: hit.via, from, to, changes });
      continue;
    }
    if (!o.createMissing) {
      plan.noRow.push({ userId: f.userId, reason: 'not_created' });
      continue;
    }
    const created = f.createdAt ? Date.parse(f.createdAt) : Number.NaN;
    if (!Number.isFinite(created) || o.now.getTime() - created < o.createMinAgeMs) {
      plan.noRow.push({ userId: f.userId, reason: 'too_new' });
      continue;
    }
    plan.creates.push({ userId: f.userId, group: target === 'untouched' ? 'toConfirm' : target, name: f.name?.trim() || f.email || 'Stayful member', changes: changedColumns(null, desired) });
  }
  return plan;
}

/** One line per member for the dry run: who, where from → where to, and every value written. */
export function planTable(plan: FunnelPlan, emailOf: (userId: string) => string | null): { member: string | null; row: string; group: string; values: Record<string, Cell> }[] {
  const title = (g: FunnelGroup | null) => (g ? GROUP_TITLES[g] : 'a group the site does not know');
  return [
    ...plan.updates.map((u) => ({ member: emailOf(u.userId), row: u.itemId, group: u.to ? `${title(u.from)} → ${GROUP_TITLES[u.to]}` : `${title(u.from)} (stays)`, values: u.changes as Record<string, Cell> })),
    ...plan.creates.map((c) => ({ member: emailOf(c.userId), row: 'new', group: `(no row) → ${GROUP_TITLES[c.group]}`, values: c.changes as Record<string, Cell> })),
  ];
}

