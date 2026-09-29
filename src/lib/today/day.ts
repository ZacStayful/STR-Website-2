/**
 * The Today screen's calendar and running order: which day a moment belongs
 * to, what order the day's cards are shown in, and when the member is done.
 *
 * A Today-day turns over at 07:00 UTC, the hour the daily picks email goes
 * out (vercel.json), all year round, so the page and the email never
 * disagree about which day it is. Before seven the member is still on
 * yesterday's list.
 *
 * Pure, so the rules are tested rather than trusted.
 */

import type { DealType } from '../market/goals.ts';

/** Hour (UTC) the day turns over: the picks cron's own. */
export const TODAY_ROLLOVER_HOUR_UTC = 7;
/** How many deals the day offers, the daily pick included. */
export const TODAY_SIZE = 5;

const HOUR_MS = 60 * 60 * 1000;

/** The Today-day `now` falls in, as its UTC date: the key a day's list is stored under. */
export function todayKey(now: Date): string {
  return new Date(now.getTime() - TODAY_ROLLOVER_HOUR_UTC * HOUR_MS).toISOString().slice(0, 10);
}

/** When the Today-day `now` falls in began. */
export function todayStart(now: Date): Date {
  return new Date(`${todayKey(now)}T${String(TODAY_ROLLOVER_HOUR_UTC).padStart(2, '0')}:00:00.000Z`);
}

/**
 * The cards in the order they are shown: the daily pick first when there is
 * one, then the day's stored list without it. The pick can land after the
 * list was chosen (the email goes out over the first three quarters of an
 * hour), so it takes the place of the lowest card the member has not yet
 * touched — never one they have kept or passed, which would make an answer
 * vanish. If every card has been answered the pick is simply added.
 *
 * Batch 17: with the cards' deal types (`typeOf`), the card that goes is the
 * lowest untouched one of the type the list holds most of (the pick
 * counted), so a mixed day keeps its mix and every chosen type its floor.
 */
export function displayOrder(stored: readonly string[], pickId: string | null, answered: ReadonlySet<string>, size = TODAY_SIZE, typeOf?: (id: string) => DealType | null): string[] {
  const list = pickId ? [pickId, ...stored.filter((id) => id !== pickId)] : [...new Set(stored)];
  if (typeOf) {
    while (list.length > size) {
      const drop = cardToDrop(list, answered, typeOf, pickId);
      if (drop === null) break;
      list.splice(list.indexOf(drop), 1);
    }
    return list;
  }
  for (let i = list.length - 1; list.length > size && i > 0; i -= 1) {
    if (!answered.has(list[i])) list.splice(i, 1);
  }
  return list;
}

/**
 * Making room for the daily pick: the lowest untouched card of the type most
 * represented on the list (the pick counted). Null when every other card has
 * been answered.
 */
export function cardToDrop(list: readonly string[], answered: ReadonlySet<string>, typeOf: (id: string) => DealType | null, protect: string | null): string | null {
  const counts = new Map<DealType | null, number>();
  for (const id of list) counts.set(typeOf(id), (counts.get(typeOf(id)) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const id = list[i];
    if (id === protect || answered.has(id)) continue;
    const n = counts.get(typeOf(id)) ?? 0;
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

export interface Tally {
  kept: number;
  passed: number;
}

/** Done for the day: there were cards, and every one has been kept or passed. */
export function isDone(ids: readonly string[], answers: ReadonlyMap<string, 'keep' | 'pass'>): boolean {
  return ids.length > 0 && ids.every((id) => answers.has(id));
}

export function tally(ids: readonly string[], answers: ReadonlyMap<string, 'keep' | 'pass'>): Tally {
  let kept = 0;
  let passed = 0;
  for (const id of ids) {
    const a = answers.get(id);
    if (a === 'keep') kept += 1;
    else if (a === 'pass') passed += 1;
  }
  return { kept, passed };
}

/** "You're done for today. 3 kept, 2 passed." */
export function finishLine(t: Tally): string {
  return `You’re done for today. ${t.kept} kept, ${t.passed} passed.`;
}

/** "Good morning, Sam" — by the clock in the UK, where every member is. */
export function greeting(now: Date, name: string | null): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(now));
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** "342 deals match what you’re looking for" — the real count, never a guess. */
export function matchLine(count: number | null, hasGoals: boolean, mustHaves = false, atLeast = false): string | null {
  if (count === null || !Number.isFinite(count)) return null;
  const n = Math.max(0, Math.floor(count));
  const deals = `${n.toLocaleString('en-GB')}${atLeast ? '+' : ''} deal${n === 1 && !atLeast ? '' : 's'}`;
  if (mustHaves) return `${deals} meet${n === 1 && !atLeast ? 's' : ''} your must-haves`;
  if (!hasGoals) return `${deals} on the market in Stayful’s top areas`;
  return `${deals} match${n === 1 ? 'es' : ''} what you’re looking for`;
}
