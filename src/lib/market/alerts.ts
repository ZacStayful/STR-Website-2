/**
 * Weekly trend-alert digest: which of a member's saved areas changed since
 * the last digest. Pure — the route feeds it data and sends the result.
 *
 * A "change" is either the enquiry trend flipping (up / flat / down /
 * insufficient) or the confidence tier crossing into Confirmed. Nothing
 * changed → no email.
 */

import type { AreaCardData } from './explorer.ts';
import type { AreaTrend } from './trend.ts';
import { formatMonth } from './trend.ts';

export interface SavedAreaState {
  postcode_area: string;
  last_alerted_direction: string | null;
  last_alerted_tier: string | null;
}

export interface AlertChange {
  code: string;
  name: string;
  direction: AreaTrend['enquiries']['direction'];
  previousDirection: string | null;
  tier: string;
  previousTier: string | null;
  deltaPct: number | null;
  since: string | null;
  becameConfirmed: boolean;
  trendChanged: boolean;
}

export function digestChanges(
  saved: SavedAreaState[],
  cards: Map<string, AreaCardData>,
  trends: Map<string, AreaTrend | null>,
): AlertChange[] {
  const out: AlertChange[] = [];
  for (const s of saved) {
    const card = cards.get(s.postcode_area);
    if (!card) continue;
    const t = trends.get(s.postcode_area) ?? null;
    const direction = t?.enquiries.direction ?? 'insufficient';
    const tier = card.confidence.tier;
    const trendChanged = s.last_alerted_direction !== null && s.last_alerted_direction !== direction && direction !== 'insufficient';
    const becameConfirmed = tier === 'confirmed' && s.last_alerted_tier !== null && s.last_alerted_tier !== 'confirmed';
    if (!trendChanged && !becameConfirmed) continue;
    out.push({
      code: card.code,
      name: card.name,
      direction,
      previousDirection: s.last_alerted_direction,
      tier,
      previousTier: s.last_alerted_tier,
      deltaPct: t?.enquiries.deltaPct ?? null,
      since: t?.since ?? null,
      becameConfirmed,
      trendChanged,
    });
  }
  return out;
}

/** One area's change in words: "Leeds (LS): enquiries now rising (+12%), previously steady". */
export function areaChangeLine(c: AlertChange): string {
  const parts: string[] = [];
  if (c.trendChanged) {
    const pct = c.deltaPct === null ? '' : ` (${c.deltaPct > 0 ? '+' : ''}${Math.round(c.deltaPct * 100)}%)`;
    const word = (d: string | null) => (d === 'up' ? 'rising' : d === 'down' ? 'falling' : d === 'flat' ? 'steady' : 'not enough data');
    parts.push(`enquiries now ${word(c.direction)}${pct}, previously ${word(c.previousDirection)}`);
  }
  if (c.becameConfirmed) parts.push('now backed by enough reports to be Confirmed');
  return `${c.name} (${c.code}): ${parts.join('; ')}${c.since ? ` — tracking since ${formatMonth(c.since)}` : ''}`;
}
