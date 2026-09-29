/**
 * "N deals match you so far": the quiz's live count, and the profile page's,
 * use the same filters the grid and Today use (Batch 2's mapping, through
 * the grid's own URL round trip), so the number never disagrees with the
 * deals a member then sees. One difference, for the count only: a home
 * postcode that has not been placed on the map yet (the metered geocode
 * happens when the answer is saved) is stood in for by its postcode area's
 * centre, so the radius slider moves the number as it moves and costs
 * nothing. Nothing here charges credit: the count is a head-only read
 * (src/lib/marketplace/queries.ts countDeals).
 *
 * Pure: no network, no database, no server-only.
 */
import { areaCentroid } from '../market/area-centroids.ts';
import { areaCodeFrom } from '../market/lead-goals.ts';
import type { MarketGoals } from '../market/goals.ts';
import { filtersForGoals } from '../today/candidates.ts';
import { filtersForType } from '../today/type-filters.ts';
import type { DealType } from './deal-types.ts';
import type { DealFilters } from '../marketplace/grid.ts';

/** The goals with the home placed: its own coordinates, else its postcode area's centre. */
export function placedForPreview(goals: MarketGoals): MarketGoals {
  if (!goals.home || (goals.home.lat !== null && goals.home.lng !== null)) return goals;
  const area = areaCodeFrom(goals.home.postcode);
  const centre = area ? areaCentroid(area) : null;
  if (!centre) return goals;
  return { ...goals, home: { ...goals.home, lat: centre.lat, lng: centre.lng } };
}

/** The grid filters a member's answers point at, as Today counts them. */
export function profileFilters(goals: MarketGoals | null, savedAreas: readonly string[]): DealFilters {
  return filtersForGoals(goals ? placedForPreview(goals) : null, savedAreas);
}

/**
 * Batch 17: one set of filters per deal type the profile is shown, each on
 * its own money answer, as Today chooses and counts them; the count is their
 * sum.
 */
export function profileFiltersByType(goals: MarketGoals | null, savedAreas: readonly string[], types: readonly DealType[]): DealFilters[] {
  return types.map((t) => filtersForType(goals ? placedForPreview(goals) : null, savedAreas, t));
}

/** "12 deals match you so far" (the quiz) / "12 deals match you" (the profile page). */
export function matchLabel(count: number | null, soFar: boolean): string | null {
  if (count === null || !Number.isFinite(count)) return null;
  const n = Math.max(0, Math.floor(count));
  return `${n.toLocaleString('en-GB')} deal${n === 1 ? '' : 's'} match${n === 1 ? 'es' : ''} you${soFar ? ' so far' : ''}`;
}
