/**
 * One deal type's own search (Batch 17): its kind, and its own money answer
 * — a BRRR deal's price is judged on the project budget, before works; Buy
 * and let on the budget; Rent-to-rent on the max rent, which the rent kind
 * already reads. Today chooses each type on these, and every "N deals match"
 * counts on them, so the list and the count agree.
 *
 * Pure: no network, no database, no server-only. Kept apart from
 * choose-day.ts so the profile's count (profile/matching.ts) can read it
 * without reaching the tailoring modules that read it back.
 */
import type { DealType, MarketGoals } from '../market/goals.ts';
import type { DealFilters } from '../marketplace/grid.ts';
import { filtersForGoals } from './candidates.ts';

export function goalsForType(g: MarketGoals, t: DealType): MarketGoals {
  return { ...g, sourcingKind: t === 'r2r' ? 'rent' : 'sale', budget: t === 'brrr' ? g.brrr.budget : g.budget };
}

/** Whether this type's list takes light refreshes only: a BRRR "Light refresh" answer (Q24). */
export function lightOnlyFor(goals: MarketGoals | null, t: DealType): boolean {
  return t === 'brrr' && goals?.brrr.work === 'light';
}

/** One type's grid filters, as its own list and its own count read them. */
export function filtersForType(goals: MarketGoals | null, savedAreas: readonly string[], t: DealType): DealFilters {
  return { ...filtersForGoals(goals ? goalsForType(goals, t) : null, savedAreas), types: [t], brrrLightOnly: lightOnlyFor(goals, t) };
}
