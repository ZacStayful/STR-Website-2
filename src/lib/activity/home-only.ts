/**
 * Batch 22e: what Home's own view (home_view, counted towards weekly active,
 * once a UK day) does to the figures. Login lands on Home, so logging in now
 * counts as active. For /admin/weekly-active:
 *
 *   homeOnlyWeeks   per week, members active ONLY because they looked at
 *                   Home: active counting home_view, less active without it
 *   homeKeepsActive whether Home visits alone keep a member out of the
 *                   14-day quiet (re-engage) or the 25-day picks pause, by
 *                   inactivityState with and without those visits
 *
 * Pure: no network, no database, no server-only.
 */
import type { WeekMetrics } from './metrics.ts';
import { inactivityState, type InactivitySettings } from '../inactivity/rules.ts';

export interface HomeOnlyWeek {
  week: string;
  label: string;
  members: number;
}

export function homeOnlyWeeks(withHome: readonly WeekMetrics[], withoutHome: readonly WeekMetrics[]): HomeOnlyWeek[] {
  const without = new Map(withoutHome.map((w) => [w.week, w.members.active]));
  return withHome.map((w) => ({ week: w.week, label: w.label, members: Math.max(0, w.members.active - (without.get(w.week) ?? 0)) }));
}

export interface HomeKeeps {
  /** Out of the 14-day quiet only because of Home. */
  quiet: boolean;
  /** Out of the 25-day picks pause only because of Home. */
  paused: boolean;
}

/** `lastHomeDay`: their latest home_view (UK day); `lastOtherDay`: their latest other qualifying action. */
export function homeKeepsActive(input: { lastHomeDay: string | null; lastOtherDay: string | null; createdAt: string | null; eligible: boolean }, s: InactivitySettings, now: Date): HomeKeeps {
  const latest = [input.lastHomeDay, input.lastOtherDay].filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const withHome = inactivityState({ eligible: input.eligible, lastActiveDay: latest, createdAt: input.createdAt }, s, now);
  const withoutHome = inactivityState({ eligible: input.eligible, lastActiveDay: input.lastOtherDay, createdAt: input.createdAt }, s, now);
  return { quiet: withoutHome.reengage && !withHome.reengage, paused: withoutHome.picksPaused && !withHome.picksPaused };
}
