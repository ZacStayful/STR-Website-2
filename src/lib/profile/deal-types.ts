/**
 * Which deals a profile wants to see (Batch 17, Part I): the one helper
 * every "which deal types are shown" decision goes through — Today and its
 * mix, the daily email, the daily pick, "Your week", Browse's defaults and
 * the demand-led searches (Batch 15; Batches 22 and 25 will call it too).
 *
 *   Buy and let  a sale, ready to go
 *   BRRR         a Project deal: a sale that needs work (buy, refurb, refinance)
 *   Rent-to-rent a rental
 *
 * A profile answers "Which deals do you want to see?" (goals.dealTypes). One
 * that has not yet is mapped from its older answers, as the one-off backfill
 * maps it (decided 29 Sep):
 *   investor → Buy and let; r2r → Rent-to-rent; both → both;
 *   Condition light refresh or full project → also BRRR;
 *   sourcers by who they source for (both, or unanswered: both);
 *   exploring by what they picked; managers from their path (Buy and let).
 * A profile with none of that yet has no types ([]); until it answers it is
 * shown Buy and let + Rent-to-rent and no BRRR, what an unanswered profile
 * was shown before (Q22). Nothing here ever throws on a missing answer.
 *
 * Pure: no network, no database, no server-only.
 */

import { GOAL_OPTIONS, type DealType, type MarketGoals, type SourcingKind } from '../market/goals.ts';
import type { AboutYou } from './about.ts';
import { parseProjectCard } from '../project/headline.ts';

export type { DealType };

/** In the question's order. */
export const DEAL_TYPES: readonly DealType[] = GOAL_OPTIONS.dealTypes;

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  buy_let: 'Buy and let',
  brrr: 'BRRR',
  r2r: 'Rent-to-rent',
};

/** The longer names the question and the profile page use. */
export const DEAL_TYPE_LONG_LABELS: Record<DealType, string> = {
  buy_let: 'Buy and let (ready to go)',
  brrr: 'BRRR (buy, refurb, refinance)',
  r2r: 'Rent-to-rent',
};

/** What an unanswered profile is shown (Q22). */
export const UNANSWERED_TYPES: readonly DealType[] = ['buy_let', 'r2r'];

export function isDealType(v: unknown): v is DealType {
  return typeof v === 'string' && (DEAL_TYPES as readonly string[]).includes(v);
}

/** Types in the question's order, no duplicates. */
export function orderedTypes(list: Iterable<DealType>): DealType[] {
  const set = new Set(list);
  return DEAL_TYPES.filter((t) => set.has(t));
}

export interface TypedProfile {
  goals: MarketGoals | null;
  about: AboutYou | null;
}

/**
 * The older answers as deal types (the backfill's mapping, and the reading
 * of a profile not yet migrated). [] when there is nothing to go on.
 */
export function legacyDealTypes(p: TypedProfile): DealType[] {
  const g = p.goals;
  const roles = p.about?.roles ?? [];
  const out = new Set<DealType>();
  if (roles.includes('investor')) out.add('buy_let');
  if (roles.includes('r2r')) out.add('r2r');
  if (roles.includes('sourcer')) {
    const f = g?.sourcer.sourceFor ?? null;
    if (f !== 'r2r') out.add('buy_let');
    if (f !== 'buyers') out.add('r2r');
  }
  if (roles.includes('manager')) out.add('buy_let');
  if (roles.includes('exploring')) {
    const pick = p.about?.exploringPick ?? null;
    if (pick === 'buy') out.add('buy_let');
    else if (pick === 'r2r') out.add('r2r');
    else if (pick === 'source') {
      out.add('buy_let');
      out.add('r2r');
    }
  }
  // No roles to go on: the path the profile was answering on, then the search
  // kind if it chose one ("rent" and "both" are never the default).
  if (out.size === 0 && g && g.path !== null) {
    const f = g.sourcer.sourceFor;
    if (g.path === 'buy' || g.path === 'manage' || (g.path === 'source' && f !== 'r2r')) out.add('buy_let');
    if (g.path === 'r2r' || (g.path === 'source' && f !== 'buyers')) out.add('r2r');
  } else if (out.size === 0 && g && g.sourcingKind !== 'sale') {
    if (g.sourcingKind === 'both') out.add('buy_let');
    out.add('r2r');
  }
  const condition = g?.buyer.condition ?? null;
  if (condition === 'refresh' || condition === 'project') out.add('brrr');
  return orderedTypes(out);
}

/** The types this profile chose, or its older answers mapped; [] when nothing is known yet. */
export function dealTypesFor(p: TypedProfile | null | undefined): DealType[] {
  if (!p) return [];
  const chosen = p.goals?.dealTypes;
  if (chosen && chosen.length > 0) return orderedTypes(chosen);
  return legacyDealTypes(p);
}

/** What the profile is shown: its types, or Buy and let + Rent-to-rent until it answers (Q22). */
export function typesShown(p: TypedProfile | null | undefined): DealType[] {
  const t = dealTypesFor(p);
  return t.length > 0 ? t : [...UNANSWERED_TYPES];
}

/** A deal's own type: a rental is rent-to-rent; a sale with a Project estimate is BRRR; any other sale Buy and let. */
export function dealTypeOf(deal: { kind: 'sale' | 'rent' | string; project?: unknown }): DealType {
  if (deal.kind === 'rent') return 'r2r';
  return parseProjectCard(deal.project) ? 'brrr' : 'buy_let';
}

/** The listing kinds these types search: sale, rent or both. */
export function kindsFor(types: readonly DealType[]): SourcingKind {
  const t = types.length > 0 ? types : UNANSWERED_TYPES;
  const sale = t.includes('buy_let') || t.includes('brrr');
  const rent = t.includes('r2r');
  return sale && rent ? 'both' : rent ? 'rent' : 'sale';
}

/** "Buy and let · Rent-to-rent". */
export function describeTypes(types: readonly DealType[]): string {
  if (types.length === DEAL_TYPES.length) return 'All of them';
  return orderedTypes(types).map((t) => DEAL_TYPE_LABELS[t]).join(' · ');
}
