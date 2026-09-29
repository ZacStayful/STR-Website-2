/**
 * The nationwide low-entry search's plan (Batch 16, Part F), with no
 * database, so the rotation and the weekly cap are tested rather than
 * trusted.
 *
 * The sweep searches the top scored areas with no price bound and sees the
 * newest 50 listings in each, so cheap stock is a footnote in it and areas
 * without enough reports for a score are never searched at all. This search
 * asks every UK postcode area for sale listings up to the low-entry price
 * cap, a slice of the list each pass, each area about once a week: the
 * areas never searched go first, then the ones searched longest ago. Spend
 * is capped for the UK week (Monday to Sunday), and a pass records the
 * searches it finished in its marketplace_runs summary so later passes
 * carry on from there.
 *
 * Pure: no network, no database, no server-only.
 */
import { AREA_CENTROIDS, MANUAL_CENTROIDS } from '../market/area-centroids.ts';
import { areaMetaForCode } from '../market/areas.ts';
import { queryKey, type SourcingQuery } from '../listing/sourcing.ts';
import { ukDay, ukWeekStart } from '../activity/week.ts';
import type { LowEntrySettings } from './config.ts';

export const LOW_ENTRY_KIND = 'low_entry_search';
export const LOW_ENTRY_ACTION = 'cron:low-entry-search';
/** How far back a pass reads earlier runs: the rotation is about a week, so two weeks show every area's last search. */
export const LOW_ENTRY_HISTORY_DAYS = 14;

/** Every UK postcode area with a centroid to search around, A to Z. */
export function lowEntryAreas(): string[] {
  return [...new Set([...Object.keys(AREA_CENTROIDS), ...Object.keys(MANUAL_CENTROIDS)])].sort();
}

/** The search for one area: sale listings up to the cap with at least the bedroom floor, keyed apart from the sweep's unbounded search. */
export function lowEntryQuery(area: string, s: Pick<LowEntrySettings, 'searchMaxPrice' | 'minBedrooms'>): SourcingQuery {
  const meta = areaMetaForCode(area);
  const minBedrooms = s.minBedrooms > 0 ? s.minBedrooms : null;
  return { key: queryKey('sale', meta.code, null, s.searchMaxPrice, minBedrooms), kind: 'sale', area: meta.code, areaName: meta.name, areaSlug: meta.slug, minPrice: null, maxPrice: s.searchMaxPrice, minBedrooms };
}

/** One earlier pass, as read back from marketplace_runs. */
export interface LowEntryRunRecord {
  startedAt: string;
  doneKeys?: unknown;
  rawCostPence?: unknown;
}

export interface LowEntryPlan {
  /** Every area's search, in the order this pass should ask: never searched first, then searched longest ago. */
  pending: SourcingQuery[];
  /** Finished by an earlier pass today: skipped without asking the broker. */
  doneToday: number;
  /** The UK day (YYYY-MM-DD) each search was last finished, from the runs read. */
  lastDoneDay: Map<string, string>;
  /** The Monday of the UK week `now` is in. */
  weekStart: string;
  /** Raw pence the search has spent this UK week, from the runs read. */
  weekSpentPence: number;
}

function keysOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];
}

function runDay(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ukDay(new Date(t)) : null;
}

/** Raw pence spent by the runs in the UK week `now` is in. */
export function weekSpentPence(runs: readonly LowEntryRunRecord[], now: Date): number {
  const weekStart = ukWeekStart(now);
  let sum = 0;
  for (const run of runs) {
    const day = runDay(run.startedAt);
    if (!day || day < weekStart) continue;
    const pence = Number(run.rawCostPence);
    if (Number.isFinite(pence) && pence > 0) sum += pence;
  }
  return Math.round(sum * 100) / 100;
}

export function planLowEntry(areas: readonly string[], runs: readonly LowEntryRunRecord[], s: Pick<LowEntrySettings, 'searchMaxPrice' | 'minBedrooms'>, now: Date): LowEntryPlan {
  const today = ukDay(now);
  const lastDoneDay = new Map<string, string>();
  for (const run of runs) {
    const day = runDay(run.startedAt);
    if (!day) continue;
    for (const key of keysOf(run.doneKeys)) {
      const prev = lastDoneDay.get(key);
      if (!prev || day > prev) lastDoneDay.set(key, day);
    }
  }
  let doneToday = 0;
  const rest: { q: SourcingQuery; lastDay: string }[] = [];
  for (const area of areas) {
    const q = lowEntryQuery(area, s);
    const lastDay = lastDoneDay.get(q.key) ?? '';
    if (lastDay === today) {
      doneToday += 1;
      continue;
    }
    rest.push({ q, lastDay });
  }
  rest.sort((a, b) => (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : 0) || a.q.area.localeCompare(b.q.area));
  return { pending: rest.map((r) => r.q), doneToday, lastDoneDay, weekStart: ukWeekStart(now), weekSpentPence: weekSpentPence(runs, now) };
}

/**
 * Whether one more search fits under the week's cap: what is spent, what
 * this pass has added, and the worst case of the next search.
 */
export function withinWeeklyCap(capPence: number, weekSpentPence: number, passPence: number, nextWorstPence: number): boolean {
  return weekSpentPence + passPence + nextWorstPence <= capPence;
}
