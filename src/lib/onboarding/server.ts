import 'server-only';

import { getAreaCardsWithin } from '../market/cached';
import { AREA_META } from '../market/areas';

/** One row of the quiz's area picker: ranked areas carry a score, the rest do not. */
export interface QuizArea {
  code: string;
  name: string;
  score: number | null;
}

/** How long the area picker waits for the market snapshot before falling back to the plain list. */
const AREAS_WAIT_MS = 5_000;

/**
 * Every postcode area for the quiz's pickers ("specific areas", where your
 * units are, the cities you operate in): the ranked ones first, in the
 * explorer's order (data confidence, then score), then the rest by name so
 * all 124 stay selectable even when the snapshot is cold.
 */
export async function rankedAreasForQuiz(): Promise<QuizArea[]> {
  const cards = (await getAreaCardsWithin(AREAS_WAIT_MS).catch((err) => {
    console.error('[profile] area cards failed:', (err as Error)?.message ?? err);
    return null;
  })) ?? [];
  const out: QuizArea[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    out.push({ code: c.code, name: c.name, score: c.score?.score ?? null });
  }
  const rest = AREA_META.filter((a) => !seen.has(a.code)).sort((a, b) => a.name.localeCompare(b.name));
  for (const a of rest) out.push({ code: a.code, name: a.name, score: null });
  return out;
}
