/**
 * Who may see a marketplace deal, and when.
 *
 * A paying account (any subscription ever, any top-up, admins — see
 * hasEverPaid in src/lib/access.ts) sees a deal the moment it goes live.
 * Every other account, and every signed-out visitor, sees it
 * `free_deal_delay_hours` later (billing_settings, 48 by default). Inside
 * that window the deal is simply absent for them: not on the grid, not in
 * the counts, not by id, not as a daily pick. No badge, no teaser.
 *
 * Pure, so the rule is tested once and every reader applies the same one.
 */

export type DealTier = 'paid' | 'free';

export interface DealVisibility {
  tier: DealTier;
  /** Deals that went live at or before this instant are visible. Null = everything live is visible. */
  cutoffIso: string | null;
  /** The same cutoff floored to the hour: the cache key for the shared readers (counts, teaser). */
  hourCutoffIso: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** No delay for anyone: what an open or an admin read uses. */
export const PAID_VISIBILITY: DealVisibility = { tier: 'paid', cutoffIso: null, hourCutoffIso: null };

export function dealVisibility(tier: DealTier, now: Date, delayHours: number): DealVisibility {
  if (tier === 'paid' || !Number.isFinite(delayHours) || delayHours <= 0) return { tier, cutoffIso: null, hourCutoffIso: null };
  const cutoff = now.getTime() - delayHours * HOUR_MS;
  return { tier, cutoffIso: new Date(cutoff).toISOString(), hourCutoffIso: new Date(Math.floor(cutoff / HOUR_MS) * HOUR_MS).toISOString() };
}

/**
 * Whether one deal is visible under a cutoff. A live deal with no
 * `live_since` (a row the trigger has not stamped yet) is treated as brand
 * new: hidden from the delayed tier rather than shown early.
 */
export function dealVisible(liveSinceIso: string | null | undefined, cutoffIso: string | null): boolean {
  if (cutoffIso === null) return true;
  if (!liveSinceIso) return false;
  const live = Date.parse(liveSinceIso);
  const cutoff = Date.parse(cutoffIso);
  if (!Number.isFinite(live) || !Number.isFinite(cutoff)) return false;
  return live <= cutoff;
}
