/**
 * What the public share page (/d/<token>) may show about a marketplace deal.
 *
 *   gone          the deal is off the market: say so, and still offer to join
 *   members_only  the deal is inside its early-access window for someone who
 *                 has never paid (every anonymous visitor): no figures, no
 *                 price, no photo, no motivation — a photo and a town are
 *                 enough to find the listing on a portal and get round the delay
 *   card          everything the card shows, and nothing it does not
 *
 * The page and its link-preview metadata both read this one answer, so a
 * preview can never show what the page withholds. Never the address, the
 * postcode or the listing link, whoever shared it and whatever they paid.
 *
 * Pure: the visibility rule is Batch 1's dealVisible, passed the public cutoff.
 */
import { dealVisible } from './visibility.ts';
import { describeType, type DealCard } from './grid.ts';
import { rangeCaption } from './profit-range.ts';
import { projectOf } from '../project/display.ts';
import { valueAddedLabel } from '../project/headline.ts';

export type ShareState = 'gone' | 'members_only' | 'card';

/** Same shape as every other share and pick token in the app (24 random bytes, base64url). */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

export function isShareToken(v: unknown): v is string {
  return typeof v === 'string' && SHARE_TOKEN.test(v);
}

/**
 * `publicCutoffIso` is publicDealVisibility().cutoffIso: what a signed-out
 * visitor may see. A deal still being checked (pending_verify) is treated as
 * not yet public rather than gone.
 */
export function shareState(deal: Pick<DealCard, 'status'> & { live_since?: string | null }, publicCutoffIso: string | null): ShareState {
  if (deal.status === 'retired') return 'gone';
  if (deal.status !== 'live') return 'members_only';
  return dealVisible(deal.live_since ?? null, publicCutoffIso) ? 'card' : 'members_only';
}

/** Referral codes as proxy.ts accepts them for the sf_ref cookie. */
const REFERRAL_CODE = /^[A-Z0-9]{4,20}$/i;

/** The join button: the sharer's referral code when they have one, so both sides get the referral credit. */
export function joinPath(referralCode: string | null | undefined): string {
  return referralCode && REFERRAL_CODE.test(referralCode) ? `/signup?ref=${encodeURIComponent(referralCode.toUpperCase())}` : '/signup';
}

/**
 * "£450–£700/mo area estimate · 3 bed terraced · York" for a link preview:
 * card facts only, and the profit only as the page shows it, a range
 * (`rangeLabel`, src/lib/marketplace/profit-range.ts; Batch 10).
 */
export function shareTitle(card: DealCard, where: string, state: ShareState, rangeLabel: string | null = null): string {
  if (state === 'gone') return 'This deal has gone — Stayful';
  const place = where || 'the UK';
  if (state === 'members_only') return `A new short-let deal in ${place} — available to members`;
  const type = describeType(card);
  // Batch 17: a Project deal leads with what the works add (numbers only, as the card).
  const project = projectOf(card);
  if (project) return [`Project · ${valueAddedLabel(project.valueAdded)}`, type || null, where || null].filter(Boolean).join(' · ');
  return [rangeLabel ? `${rangeLabel} ${rangeCaption(card.check_comps)}` : null, type || null, where || null].filter(Boolean).join(' · ') || 'A short-let deal on Stayful';
}
