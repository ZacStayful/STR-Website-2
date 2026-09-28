/**
 * The marketplace sweep's plan for one pass, with no database, so the order
 * and the skipping are tested rather than trusted.
 *
 * A pass used to start at the top of the list every time and re-read every
 * answer it already had. From about the sixth pass that re-reading took the
 * whole 44 s budget, so the sweep searched the same ~16 areas every day and
 * never reached the rest of its list. Now each pass records the searches it
 * finished and the ones that came back empty, later passes skip what is
 * already done today, and what is left goes in this order:
 *
 *   1. areas the members' running profiles want, most wanted first;
 *   2. searches last finished on an earlier day than the others (never
 *      finished first), so what a busy day leaves out is first in line the
 *      next morning;
 *   3. the Stayful area score, as before.
 *
 * Nothing is ever dropped from the list here: the order only decides what
 * waits when a pass runs out of time.
 *
 * Pure: no network, no database, no server-only.
 */
import { topScoredAreas, type HouseAreaCard } from '../listing/picks.ts';
import { queryKey, type SourcingKind, type SourcingQuery } from '../listing/sourcing.ts';

export const DEFAULT_SWEEP_AREAS = 60;
export const DEFAULT_SWEEP_MAX_QUERIES = 120;
/** A search that comes back empty this many times in a day waits until tomorrow. */
export const MAX_EMPTY_PER_DAY = 2;
/** How far back a pass reads earlier runs to know when each search was last finished. */
export const HISTORY_DAYS = 7;

/** A positive whole number from an env value, else the fallback. */
export function countFrom(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The sweep cron's kill switch: on unless MARKETPLACE_SWEEP_ENABLED is 'false'. */
export function sweepEnabled(): boolean {
  return process.env.MARKETPLACE_SWEEP_ENABLED !== 'false';
}

/** How many top scored areas the sweep covers (MARKETPLACE_SWEEP_AREAS, default 60). */
export function sweepAreaLimit(): number {
  return countFrom(process.env.MARKETPLACE_SWEEP_AREAS, DEFAULT_SWEEP_AREAS);
}

/** The most searches on the sweep's list (MARKETPLACE_SWEEP_MAX_QUERIES, default 120 = 60 areas × 2 kinds). */
export function sweepMaxQueries(): number {
  return countFrom(process.env.MARKETPLACE_SWEEP_MAX_QUERIES, DEFAULT_SWEEP_MAX_QUERIES);
}

const SWEEP_KINDS: readonly SourcingKind[] = ['sale', 'rent'];

/** The searches for one pass: every top area × both kinds, unbounded. */
export function sweepQueries(cards: HouseAreaCard[], areas: number, maxQueries: number): SourcingQuery[] {
  const out: SourcingQuery[] = [];
  for (const a of topScoredAreas(cards, areas)) {
    for (const kind of SWEEP_KINDS) {
      out.push({ key: queryKey(kind, a.code, null, null, null), kind, area: a.code, areaName: a.name, areaSlug: a.slug, minPrice: null, maxPrice: null, minBedrooms: null });
    }
  }
  return out.slice(0, maxQueries);
}

/**
 * The areas the sweep's list covers for both kinds. A list cut short by the
 * query limit covers its last areas partly or not at all; those are left to
 * the demand-led searches (a kind both jobs ask for shares one cached answer).
 */
export function fullyCoveredAreas(queries: readonly Pick<SourcingQuery, 'area' | 'kind'>[]): Set<string> {
  const kinds = new Map<string, Set<SourcingKind>>();
  for (const q of queries) {
    const area = q.area.toUpperCase();
    kinds.set(area, (kinds.get(area) ?? new Set<SourcingKind>()).add(q.kind));
  }
  return new Set([...kinds].filter(([, k]) => k.size === SWEEP_KINDS.length).map(([area]) => area));
}

/** One earlier pass, as read back from marketplace_runs. */
export interface SweepRunRecord {
  startedAt: string;
  doneKeys?: unknown;
  emptyKeys?: unknown;
}

export interface SweepHistory {
  /** Searches finished today (the UTC day of `now`). */
  doneToday: Set<string>;
  /** Times each search came back empty today. */
  emptyToday: Map<string, number>;
  /** The UTC day (YYYY-MM-DD) each search was last finished, from the runs read. */
  lastDoneDay: Map<string, string>;
}

function keysOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];
}

function utcDay(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

export function sweepHistory(runs: readonly SweepRunRecord[], now: Date = new Date()): SweepHistory {
  const today = now.toISOString().slice(0, 10);
  const doneToday = new Set<string>();
  const emptyToday = new Map<string, number>();
  const lastDoneDay = new Map<string, string>();
  for (const run of runs) {
    const day = utcDay(run.startedAt);
    if (!day) continue;
    for (const key of keysOf(run.doneKeys)) {
      if (day === today) doneToday.add(key);
      const prev = lastDoneDay.get(key);
      if (!prev || day > prev) lastDoneDay.set(key, day);
    }
    if (day === today) for (const key of keysOf(run.emptyKeys)) emptyToday.set(key, (emptyToday.get(key) ?? 0) + 1);
  }
  return { doneToday, emptyToday, lastDoneDay };
}

export interface PassPlan {
  /** What this pass should ask for, in order. */
  pending: SourcingQuery[];
  /** Already finished today: skipped without asking the broker. */
  doneToday: number;
  /** Came back empty MAX_EMPTY_PER_DAY times today: left until tomorrow. */
  leftForTomorrow: number;
}

/**
 * Today's remaining searches in the order this pass should ask for them.
 * `demandScore` is postcode area → how much members want it (0 or missing =
 * nobody); an empty map keeps the old score order for everything else.
 */
export function planPass(queries: readonly SourcingQuery[], history: SweepHistory, demandScore: ReadonlyMap<string, number> = new Map()): PassPlan {
  let doneToday = 0;
  let leftForTomorrow = 0;
  const rest: { q: SourcingQuery; i: number; demand: number; lastDay: string }[] = [];
  queries.forEach((q, i) => {
    if (history.doneToday.has(q.key)) {
      doneToday += 1;
      return;
    }
    if ((history.emptyToday.get(q.key) ?? 0) >= MAX_EMPTY_PER_DAY) {
      leftForTomorrow += 1;
      return;
    }
    const demand = demandScore.get(q.area.toUpperCase()) ?? 0;
    rest.push({ q, i, demand: Number.isFinite(demand) && demand > 0 ? demand : 0, lastDay: history.lastDoneDay.get(q.key) ?? '' });
  });
  rest.sort((a, b) => b.demand - a.demand || (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : 0) || a.i - b.i);
  return { pending: rest.map((r) => r.q), doneToday, leftForTomorrow };
}
