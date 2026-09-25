/**
 * The deals grid a member's goals point at.
 *
 * /deals reads nothing but its URL, so "show me the deals that match" is a
 * URL built from the goals: the kind, the areas, and the price bounds one
 * kind can carry. Areas near a home postcode are chosen exactly as the daily
 * picks choose them (an area counts when its centroid is within the radius),
 * plus the postcode's own area, so the two never disagree about "near".
 *
 * `maxPrice` on /deals applies to the asking price for sales and the monthly
 * rent for rentals, so a member who wants both gets both kinds with no price
 * cap rather than a cap that would hide one of them.
 *
 * Pure, so the mapping is tested rather than trusted.
 */
import type { MarketGoals } from '../market/goals.ts';
import { AREA_META } from '../market/areas.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { areaCodeFrom } from '../market/lead-goals.ts';
import { budgetBounds } from '../listing/sourcing.ts';
import { filtersToSearch, type DealFilters } from '../marketplace/grid.ts';

const KNOWN_AREAS = new Set(AREA_META.map((a) => a.code));

/** `?from=welcome` marks a grid the member was sent to straight from the welcome questions. */
export const WELCOME_QUERY = { key: 'from', value: 'welcome' } as const;

export function cameFromWelcome(raw: string | string[] | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === WELCOME_QUERY.value;
}

/** Every postcode area whose centroid is within `miles` of `home`, in AREA_META order. */
export function areasNear(home: { lat: number; lng: number }, miles: number): string[] {
  return AREA_META.map((a) => a.code).filter((code) => {
    const c = areaCentroid(code);
    return c !== null && haversineMiles(home, c) <= miles;
  });
}

/**
 * The areas a member's goals cover: their saved areas, plus — for a home
 * postcode — its own area and, once geocoded, every area within the radius.
 */
export function goalAreas(goals: MarketGoals, savedAreas: readonly string[]): string[] {
  const codes = new Set<string>();
  for (const raw of savedAreas) {
    const code = raw.trim().toUpperCase();
    if (KNOWN_AREAS.has(code)) codes.add(code);
  }
  if (goals.home) {
    const own = areaCodeFrom(goals.home.postcode);
    if (own) codes.add(own);
    if (goals.home.lat !== null && goals.home.lng !== null && goals.maxDistanceMiles) {
      for (const code of areasNear({ lat: goals.home.lat, lng: goals.home.lng }, goals.maxDistanceMiles)) codes.add(code);
    }
  }
  return [...codes];
}

export function dealFiltersForGoals(goals: MarketGoals, savedAreas: readonly string[]): Partial<DealFilters> {
  const f: Partial<DealFilters> = { kind: goals.sourcingKind, areas: goalAreas(goals, savedAreas) };
  if (goals.sourcingKind === 'sale') {
    const b = budgetBounds(goals.budget);
    f.minPrice = b.min;
    f.maxPrice = b.max;
  } else if (goals.sourcingKind === 'rent') {
    f.maxPrice = goals.maxRentPcm;
  }
  return f;
}

/** The /deals URL for these goals, marked as arriving from the welcome questions. */
export function dealsPathForGoals(goals: MarketGoals, savedAreas: readonly string[]): string {
  const search = filtersToSearch(dealFiltersForGoals(goals, savedAreas));
  return `/deals${search}${search ? '&' : '?'}${WELCOME_QUERY.key}=${WELCOME_QUERY.value}`;
}
