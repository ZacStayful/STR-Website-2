/**
 * The entry hold (Part B, decided): what happens to a sale whose own words
 * say it needs work, before anything is spent on it.
 *
 *   not flagged, a rental, or an auction lot (Q10: it stays one of Batch
 *   16's auction deals)                          → the ordinary flow
 *   an exclusion in its own words (non-standard construction, a lease under
 *   80 years, listed, a conservation area, a structural red flag)
 *                                                → retired project_excluded
 *   a page we can never read (Zoopla), so no photo check
 *                                                → retired project_uncheckable
 *   the free best case cannot pass the value test → retired not_project
 *   otherwise                                    → held: pending_check in the
 *                                                  Project stream, for its
 *                                                  comparables check and then
 *                                                  the Project photo check
 *
 * Retired this way it is never shown and never revived (Q3: a listing that
 * needs work is a Project deal or nothing). The hold only runs while
 * project_checks.enabled is on and Batch 16's checks are (DEAL_CHECKS_ENABLED);
 * off, every listing takes the ordinary flow, as before this batch.
 *
 * Pure: no network, no database, no server-only.
 */
import type { SourcingKind } from '../listing/sourcing.ts';
import type { ProjectSettings } from './config.ts';
import type { PropertyFacts } from './costing.ts';
import { bestCase } from './estimate.ts';
import { exclusionFor, type ExclusionReason } from './exclusions.ts';
import type { NeedsWork } from './needs-work.ts';

export type HoldRetireReason = 'project_excluded' | 'project_uncheckable' | 'not_project';

export type HoldDecision =
  | { kind: 'none' }
  | { kind: 'hold' }
  | { kind: 'retire'; reason: HoldRetireReason; detail: string };

export interface HoldInput {
  kind: SourcingKind;
  needsWork: NeedsWork | null | undefined;
  auction: boolean | null | undefined;
  /**
   * Whether the source's pages can ever be read (SERVER_FETCHABLE: never
   * Zoopla's). Not the LISTING_SERVER_FETCH / LISTING_SOURCES switches: a
   * listing held while fetching is switched off waits (and at worst expires
   * unchecked, revivable); it is never retired for good over a switch.
   */
  fetchable: boolean;
  /** The page's own first exclusion once it has been read (null: none found); undefined: never read. */
  pageExclusion?: ExclusionReason | null;
  /** Card text (title, features, price qualifier) for the free exclusions before any page read. Read, never kept. */
  texts: readonly (string | null | undefined)[];
  tenure?: string | null;
  yearsRemainingOnLease?: number | null;
  listedFlag?: boolean | null;
  price: number | null;
  /** Null when the bedrooms are unknown: the best case then waits for the page. */
  facts: PropertyFacts | null;
}

export function projectHoldFor(input: HoldInput, settings: ProjectSettings): HoldDecision {
  if (input.kind !== 'sale' || !input.needsWork?.flag) return { kind: 'none' };
  if (input.auction === true) return { kind: 'none' };
  const excluded =
    input.pageExclusion !== undefined && input.pageExclusion !== null
      ? input.pageExclusion
      : exclusionFor({ texts: input.texts, tenure: input.tenure ?? null, yearsRemainingOnLease: input.yearsRemainingOnLease ?? null, listedFlag: input.listedFlag ?? null });
  if (excluded) return { kind: 'retire', reason: 'project_excluded', detail: excluded };
  if (!input.fetchable) return { kind: 'retire', reason: 'project_uncheckable', detail: 'its page cannot be read' };
  if (input.price !== null && input.price > 0 && input.facts) {
    const best = bestCase(input.price, input.facts, settings);
    if (!best.passes) return { kind: 'retire', reason: 'not_project', detail: 'best case' };
  }
  return { kind: 'hold' };
}
