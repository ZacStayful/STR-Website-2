/**
 * The saved-profile figures on /admin/profiles (Batch 13): how many profiles
 * members keep, how many are running, the share with two or more, and weekly
 * active split by members with one profile against two or more (profiles
 * held at the end of each week). Members are Batch 9's counted members
 * (admin, staff and switched-off accounts already left out); a member with
 * no profile row yet counts as having one, which they get on their next visit.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MemberRow, Share } from '../activity/metrics.ts';

export interface ProfileFact {
  userId: string;
  createdAt: string;
  pausedAt: string | null;
  deletedAt: string | null;
}

export interface ProfileMetrics {
  members: number;
  /** Members by how many live (not deleted) profiles they keep: index 1..5 (6+ folded into 5). */
  byCount: number[];
  /** Members by how many profiles are running now (not paused, not deleted): index 0..5. */
  byRunning: number[];
  twoPlus: Share;
  weeks: { week: string; label: string; one: Share; many: Share }[];
}

const time = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Live profiles a member held at `at`: created by then and not deleted by then. At least one. */
export function heldAt(facts: readonly ProfileFact[], at: number): number {
  const n = facts.filter((f) => (time(f.createdAt) ?? Infinity) <= at && !((time(f.deletedAt) ?? Infinity) <= at)).length;
  return Math.max(1, n);
}

export function profileMetrics(members: readonly Pick<MemberRow, 'id' | 'joined' | 'weeks'>[], facts: readonly ProfileFact[], opts: { now: Date; weekEnd: (week: string) => number; weekLabel: (week: string) => string }): ProfileMetrics {
  const byUser = new Map<string, ProfileFact[]>();
  for (const f of facts) byUser.set(f.userId, [...(byUser.get(f.userId) ?? []), f]);
  const byCount = [0, 0, 0, 0, 0, 0];
  const byRunning = [0, 0, 0, 0, 0, 0];
  let twoPlus = 0;
  const now = opts.now.getTime();
  for (const m of members) {
    const mine = byUser.get(m.id) ?? [];
    const live = heldAt(mine, now);
    byCount[Math.min(5, live)] += 1;
    if (live >= 2) twoPlus += 1;
    // No row yet: their one profile is running (it is made running).
    const running = mine.length === 0 ? 1 : mine.filter((f) => !f.deletedAt && !f.pausedAt).length;
    byRunning[Math.min(5, running)] += 1;
  }
  const weekList = members[0]?.weeks.map((w) => w.week) ?? [];
  const weeks = weekList.map((week, i) => {
    const end = opts.weekEnd(week);
    const one: Share = { base: 0, active: 0 };
    const many: Share = { base: 0, active: 0 };
    for (const m of members) {
      // A member counts from the week they joined.
      if ((time(m.joined) ?? -Infinity) >= end) continue;
      const group = heldAt(byUser.get(m.id) ?? [], end - 1) >= 2 ? many : one;
      group.base += 1;
      if (m.weeks[i]?.active) group.active += 1;
    }
    return { week, label: opts.weekLabel(week), one, many };
  });
  return { members: members.length, byCount, byRunning, twoPlus: { base: members.length, active: twoPlus }, weeks };
}
