/**
 * Planning signals per postcode area (the `area_planning_signals` table):
 * large planning applications within a radius of the area's centre over
 * the last 12 months and the 12 before. Refreshed by
 * /api/internal/planning-signals from PlanIt; read into the snapshot by
 * source.ts. Pure helpers here so the merge and the refresh schedule are
 * unit-tested.
 */

export interface PlanningSignal {
  postcode_area: string;
  large_apps_12m: number | null;
  large_apps_prev_12m: number | null;
  fetched_at: string | null;
}

/** Search radius around an area centroid (km): a city and its fringe. */
export const PLANNING_RADIUS_KM = 8;
/** A signal older than this is refreshed. */
export const PLANNING_MAX_AGE_DAYS = 30;

export type PlanningByArea = Map<string, PlanningSignal>;

export function planningByArea(signals: PlanningSignal[]): PlanningByArea {
  return new Map(signals.map((s) => [s.postcode_area.trim().toUpperCase(), s]));
}

/** Areas that have no signal yet or whose signal is older than the max age, oldest first. */
export function areasToRefresh(areaCodes: string[], signals: PlanningSignal[], now: Date, maxAgeDays = PLANNING_MAX_AGE_DAYS): string[] {
  const byArea = planningByArea(signals);
  const cutoff = now.getTime() - maxAgeDays * 24 * 3600 * 1000;
  const age = (code: string) => {
    const s = byArea.get(code);
    const t = s?.fetched_at ? new Date(s.fetched_at).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  return [...new Set(areaCodes.map((c) => c.trim().toUpperCase()))]
    .filter((c) => age(c) < cutoff)
    .sort((a, b) => age(a) - age(b) || a.localeCompare(b));
}

/** The mean of the areas' counts (regions), or null when none carry one. */
export function meanPlanning(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (known.length === 0) return null;
  return Math.round(known.reduce((s, v) => s + v, 0) / known.length);
}
