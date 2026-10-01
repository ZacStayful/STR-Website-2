/**
 * Batch 22, Part G: what a member's own search does, step by step.
 *
 *   signup (free, layer 2)  only the member's own screenable areas, of the
 *                           kinds their deal types want, where live stock of
 *                           that kind is thin (< signup_thin_stock) or the
 *                           area was not searched within signup_search_fresh_hours.
 *                           Thin areas first, then the least recently searched.
 *                           OnTheMarket first; PMI only where it stays thin.
 *   deep (paid)             the member's areas plus deep_search_nearby_areas
 *                           nearby, every kind they want, paged until done or
 *                           the cap.
 *
 * Every step is claimed against the search's cap before it runs
 * (member_search_claim); the plan only orders the work.
 *
 * Pure: no network, no database, no server-only.
 */
import type { DemandKind } from './demand.ts';

export type SearchSource = 'onthemarket' | 'pmi';

export interface AreaStock {
  area: string;
  kind: DemandKind;
  /** Can a listing here be screened (the area has figures)? */
  screenable: boolean;
  /** Live deals of this kind in this area. */
  live: number;
  /** When a broker answer for this area × kind was last stored; null: never. */
  searchedAt: string | null;
}

export interface SearchStep {
  area: string;
  kind: DemandKind;
  source: SearchSource;
  page: number;
  /** The area was thin when planned (PMI may follow if it stays thin). */
  thin: boolean;
}

export interface SignupPlanOptions {
  thinStock: number;
  freshHours: number;
  now: Date;
}

const hoursSince = (iso: string | null, now: Date) => {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : Number.POSITIVE_INFINITY;
};

/** Layer 2's steps: OnTheMarket page 1 for each thin or stale screenable area × kind. */
export function planSignupSearch(stock: readonly AreaStock[], o: SignupPlanOptions): SearchStep[] {
  const due = stock
    .filter((s) => s.screenable)
    .map((s) => ({ s, thin: s.live < o.thinStock, age: hoursSince(s.searchedAt, o.now) }))
    .filter((x) => x.thin || x.age >= o.freshHours);
  due.sort((a, b) => Number(b.thin) - Number(a.thin) || b.age - a.age || a.s.live - b.s.live || a.s.area.localeCompare(b.s.area) || a.s.kind.localeCompare(b.s.kind));
  return due.map(({ s, thin }) => ({ area: s.area, kind: s.kind, source: 'onthemarket', page: 1, thin }));
}

/** After an OnTheMarket step: try PMI for the same area × kind only if it is still thin. */
export function pmiFollowUp(step: SearchStep, liveAfter: number, thinStock: number): SearchStep | null {
  if (step.source !== 'onthemarket' || !step.thin || liveAfter >= thinStock) return null;
  return { ...step, source: 'pmi', page: 1 };
}

/** The deep search's areas: the member's own, then up to `nearby` more, without repeats. */
export function deepAreas(own: readonly string[], nearby: readonly string[], count: number): string[] {
  const out = [...new Set(own)];
  for (const a of nearby) {
    if (out.length >= own.length + Math.max(0, count)) break;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** The deep search's first steps: page 1 of every area × kind; later pages are added as each answers with a full page. */
export function planDeepSearch(areas: readonly string[], kinds: readonly DemandKind[]): SearchStep[] {
  const steps: SearchStep[] = [];
  for (const area of areas) for (const kind of kinds) steps.push({ area, kind, source: 'onthemarket', page: 1, thin: false });
  return steps;
}

/** The next page of a deep-search step when the page that came back was full. */
export function nextPage(step: SearchStep, returned: number, pageSize: number, maxPages: number): SearchStep | null {
  if (returned < pageSize || step.page >= maxPages) return null;
  return { ...step, page: step.page + 1 };
}

/**
 * A strong match ends the signup search: #1 misses no must-have, was judged on
 * at least `minChecked` checks, and matches at least `pct` (the same rounding
 * as the % shown). Members with no match % (mandatory answers only) never
 * have a strong match.
 */
export function isStrongMatch(top: { matchPct: number | null; checks: number; missedMustHave: boolean } | null, s: { strongMatchPct: number; strongMatchMinChecked: number }): boolean {
  if (!top || top.matchPct === null || top.missedMustHave) return false;
  return top.checks >= s.strongMatchMinChecked && Math.round(top.matchPct) >= s.strongMatchPct;
}
