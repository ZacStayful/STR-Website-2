/**
 * The daily pick for a tailored profile (Part B): the shared ranking's
 * candidates (feedback rules, income bar, money test, short-let check), put
 * in the same order Today uses, so the pick a member is charged for is the
 * deal their own Today would put first. Must-haves were applied before the
 * ranking (criteria.ts mustHaveTest). Untailored: the ranking's own order,
 * untouched.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AreaCardData } from '../market/explorer.ts';
import { factsFromListing, judgeDeal, wantsFor, type PickCandidateLike } from './criteria.ts';
import { adjustmentsFor, areaLookup, bonusOf, compareKeys, leaningsFor, orderKey } from './order.ts';
import { usesTailoring, type TailoringProfile } from './profile.ts';

export function orderPicks<C extends PickCandidateLike & { fit: number; precheck: string }>(ranked: readonly C[], p: TailoringProfile | null | undefined, cards: readonly AreaCardData[] | null): C[] {
  if (!usesTailoring(p)) return [...ranked];
  const wants = wantsFor(p);
  const leanings = leaningsFor(p);
  const area = areaLookup(cards);
  const keys = new Map(
    ranked.map((c) => {
      const f = factsFromListing(c.listing, c.deal, c.screening, { qualifies: c.motivationQualifies, score: c.motivation?.score ?? 0, fired: c.motivation?.fired }, c.project ?? null);
      const { judgement, figures } = judgeDeal(f, p, wants);
      const bonus = bonusOf(adjustmentsFor(f, figures, leanings, area(f.area, f.bedrooms)));
      return [c, orderKey(c, judgement, bonus, c.screening?.surplus ?? null, c.listing.canonicalUrl)] as const;
    }),
  );
  return [...ranked].sort((a, b) => compareKeys(keys.get(a)!, keys.get(b)!));
}
