/**
 * Batch 22, Part B: the signup reveal's rules.
 *
 * Pure: no network, no database, no server-only.
 */
import { REVEAL_ALTERNATIVES } from './config.ts';

/** "83% match · 5 of 6" → 83; null when there is no match % (fewer than two checks, untailored). */
export function matchPctOf(match: string | null | undefined): number | null {
  const m = typeof match === 'string' ? /^(\d{1,3})% match/.exec(match) : null;
  return m ? Number(m[1]) : null;
}

export type RevealTone = 'match' | 'closest' | 'none';

/**
 * How the reveal speaks about #1: "the closest I have today" when the day is a
 * near miss, or a tailored #1 is under reveal_low_match_pct; nothing at all
 * when there are no cards.
 */
export function revealTone(p: { cards: number; nearMiss: boolean; topMatchPct: number | null; lowMatchPct: number }): RevealTone {
  if (p.cards === 0) return 'none';
  if (p.nearMiss) return 'closest';
  if (p.topMatchPct !== null && p.topMatchPct < p.lowMatchPct) return 'closest';
  return 'match';
}

/** The best match and up to REVEAL_ALTERNATIVES more, from Today's own order. */
export function revealDeals(order: readonly string[]): string[] {
  return order.slice(0, 1 + REVEAL_ALTERNATIVES);
}

export function revealIntro(count: number): string {
  if (count >= 3) return 'Here’s your best match right now, and 2 close alternatives.';
  if (count === 2) return 'Here’s your best match right now, and 1 close alternative.';
  return 'Here’s your best match right now.';
}

/** Where the reveal may send the member on: an internal path, never the reveal itself. */
export function revealNext(raw: string | null | undefined, fallback = '/today'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (raw.startsWith('/welcome')) return fallback;
  return raw;
}

/** The reveal is shown once: a reveal first viewed on an earlier Today-day goes to /today. */
export function revealStale(viewedDay: string | null, today: string): boolean {
  return viewedDay !== null && viewedDay !== today;
}
