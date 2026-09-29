/**
 * Which deals a profile wants to see (Batch 17, Part I): the one helper
 * every "which deal types are shown" decision goes through — Today and its
 * mix, the daily email, the daily pick, "Your week", Browse's defaults and
 * the demand-led searches (Batch 15; Batches 22 and 25 will call it too).
 *
 *   Short-let     a sale to buy and run as a holiday let (buy_str)
 *   BRRR          a Project deal: a sale that needs work (buy, refurb, refinance)
 *   Rent-to-rent  a rental (r2r)
 *   Buy to let    long-term tenants (btl): declared, coming soon (Batch 28).
 *                 No profile can hold it and nothing shows it until it is in
 *                 AVAILABLE_DEAL_TYPES (market/goals.ts), the one list the
 *                 question's "Coming soon" state and "All of them" read.
 *
 * Never call a short-let purchase "buy to let" or "buy and let": Buy to let
 * is its own deal type (long-term tenants).
 *
 * A profile answers "Which deals do you want to see?" (goals.dealTypes). One
 * that has not yet is mapped from its older answers, as the one-off backfill
 * maps it (decided 29 Sep):
 *   investor → Short-let; r2r → Rent-to-rent; both → both;
 *   Condition light refresh or full project → also BRRR;
 *   sourcers by who they source for (both, or unanswered: both);
 *   exploring by what they picked; managers from their path (Short-let).
 * A profile with none of that yet has no types ([]); until it answers it is
 * shown Short-let + Rent-to-rent and no BRRR, what an unanswered profile
 * was shown before (Q22). Nothing here ever throws on a missing answer.
 *
 * Pure: no network, no database, no server-only.
 */

import { AVAILABLE_DEAL_TYPES, GOAL_OPTIONS, type DealType, type MarketGoals, type SourcingKind } from '../market/goals.ts';
import type { AboutYou } from './about.ts';
import { parseProjectCard } from '../project/headline.ts';

export type { DealType };
export { AVAILABLE_DEAL_TYPES };

/** Every declared type, in the question's order: the available ones and the ones coming soon. */
export const DEAL_TYPES: readonly DealType[] = GOAL_OPTIONS.dealTypes;

/** Declared but not yet available: shown greyed out, "Coming soon", never chosen or shown as deals. */
export const COMING_SOON_DEAL_TYPES: readonly DealType[] = DEAL_TYPES.filter((t) => !AVAILABLE_DEAL_TYPES.includes(t));

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  buy_str: 'Short-let',
  brrr: 'BRRR',
  r2r: 'Rent-to-rent',
  btl: 'Buy to let',
};

/** The longer names the question and the profile page use. */
export const DEAL_TYPE_LONG_LABELS: Record<DealType, string> = {
  buy_str: 'Short-let (buy and run it as a holiday let)',
  brrr: 'BRRR (buy, refurb, refinance)',
  r2r: 'Rent-to-rent',
  btl: 'Buy to let (long-term tenants)',
};

/** What an unanswered profile is shown (Q22). */
export const UNANSWERED_TYPES: readonly DealType[] = ['buy_str', 'r2r'];

export function isDealType(v: unknown): v is DealType {
  return typeof v === 'string' && (DEAL_TYPES as readonly string[]).includes(v);
}

/** A type a profile can hold today (AVAILABLE_DEAL_TYPES). */
export function isAvailableDealType(v: unknown): v is DealType {
  return typeof v === 'string' && (AVAILABLE_DEAL_TYPES as readonly string[]).includes(v);
}

/** Types in the question's order, no duplicates. */
export function orderedTypes(list: Iterable<DealType>): DealType[] {
  const set = new Set(list);
  return DEAL_TYPES.filter((t) => set.has(t));
}

/** The available ones among these, in the question's order: what a profile may hold and be shown. */
export function availableTypes(list: Iterable<DealType>): DealType[] {
  return orderedTypes(list).filter(isAvailableDealType);
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
  if (roles.includes('investor')) out.add('buy_str');
  if (roles.includes('r2r')) out.add('r2r');
  if (roles.includes('sourcer')) {
    const f = g?.sourcer.sourceFor ?? null;
    if (f !== 'r2r') out.add('buy_str');
    if (f !== 'buyers') out.add('r2r');
  }
  if (roles.includes('manager')) out.add('buy_str');
  if (roles.includes('exploring')) {
    const pick = p.about?.exploringPick ?? null;
    if (pick === 'buy') out.add('buy_str');
    else if (pick === 'r2r') out.add('r2r');
    else if (pick === 'source') {
      out.add('buy_str');
      out.add('r2r');
    }
  }
  // No roles to go on: the path the profile was answering on, then the search
  // kind if it chose one ("rent" and "both" are never the default).
  if (out.size === 0 && g && g.path !== null) {
    const f = g.sourcer.sourceFor;
    if (g.path === 'buy' || g.path === 'manage' || (g.path === 'source' && f !== 'r2r')) out.add('buy_str');
    if (g.path === 'r2r' || (g.path === 'source' && f !== 'buyers')) out.add('r2r');
  } else if (out.size === 0 && g && g.sourcingKind !== 'sale') {
    if (g.sourcingKind === 'both') out.add('buy_str');
    out.add('r2r');
  }
  const condition = g?.buyer.condition ?? null;
  if (condition === 'refresh' || condition === 'project') out.add('brrr');
  // Nobody is mapped to Buy to let: every older "buy" answer meant a short-let purchase.
  return availableTypes(out);
}

/** The types this profile chose (available ones only), or its older answers mapped; [] when nothing is known yet. */
export function dealTypesFor(p: TypedProfile | null | undefined): DealType[] {
  if (!p) return [];
  const chosen = availableTypes(p.goals?.dealTypes ?? []);
  if (chosen.length > 0) return chosen;
  return legacyDealTypes(p);
}

/** What the profile is shown: its types, or Short-let + Rent-to-rent until it answers (Q22). */
export function typesShown(p: TypedProfile | null | undefined): DealType[] {
  const t = dealTypesFor(p);
  return t.length > 0 ? t : [...UNANSWERED_TYPES];
}

/** A deal's own type: a rental is rent-to-rent; a sale with a Project estimate is BRRR; any other sale Short-let. */
export function dealTypeOf(deal: { kind: 'sale' | 'rent' | string; project?: unknown }): DealType {
  if (deal.kind === 'rent') return 'r2r';
  return parseProjectCard(deal.project) ? 'brrr' : 'buy_str';
}

/** The listing kinds these types search: sale, rent or both (only available types count). */
export function kindsFor(types: readonly DealType[]): SourcingKind {
  const available = availableTypes(types);
  const t = available.length > 0 ? available : UNANSWERED_TYPES;
  const sale = t.includes('buy_str') || t.includes('brrr') || t.includes('btl');
  const rent = t.includes('r2r');
  return sale && rent ? 'both' : rent ? 'rent' : 'sale';
}

/** "Short-let · Rent-to-rent"; "All of them" when every available type is there. */
export function describeTypes(types: readonly DealType[]): string {
  const available = availableTypes(types);
  if (available.length === AVAILABLE_DEAL_TYPES.length) return 'All of them';
  return available.map((t) => DEAL_TYPE_LABELS[t]).join(' · ');
}

/**
 * "I want rent-to-rent, not to buy" on a pick (and the reverse) adds that
 * type to the profile's types rather than switching the search for the day
 * (Q25; the reverse is treated the same way). Both at once cancel out, as
 * they always have. Null: nothing to add.
 */
export function typeFromPickReasons(reasons: readonly string[]): DealType | null {
  const r2r = reasons.includes('want_r2r');
  const buy = reasons.includes('want_buy');
  if (r2r === buy) return null;
  return r2r ? 'r2r' : 'buy_str';
}

/**
 * The profile's goals with one more deal type (its older answers mapped
 * first, when it has not chosen any yet), and the search kind they now
 * cover. Null when the type is already there, or there are no goals.
 */
export function withAddedType(p: TypedProfile, type: DealType): MarketGoals | null {
  const g = p.goals;
  if (!g || !isAvailableDealType(type)) return null;
  const current = dealTypesFor(p);
  if (current.includes(type)) return null;
  const types = availableTypes([...current, type]);
  return { ...g, dealTypes: types, sourcingKind: kindsFor(types) };
}
