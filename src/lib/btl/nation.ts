/**
 * The rules a landlord meets in each nation, and the EPC line (Batch 28,
 * Parts A and F). DRAFT WORDING for Zac to approve: these are legal facts in
 * plain words, kept here so the deal page, the £2 report and the knowledge
 * entries say the same thing, and so one edit changes them all.
 *
 *   England    Renters' Rights Act: periodic tenancies, no Section 21
 *              "no-fault" evictions since 1 May 2026.
 *   Wales      Renting Homes (Wales) Act: occupation contracts, a longer
 *              no-fault notice, and Rent Smart Wales registration.
 *   Scotland   Private residential tenancies: open-ended, no no-fault
 *              eviction, landlord registration.
 *   N. Ireland Private Tenancies Act: longer notice periods, landlord
 *              registration and deposit protection.
 *
 * The EPC line (Q11): England's plan is EPC C for new tenancies by 2030 with
 * a £10,000 cost cap; Wales keeps the current minimum of E for now; Scotland
 * and Northern Ireland say nothing.
 *
 * Pure: no network, no database, no server-only.
 */

import type { TaxCountry } from '../listing/stamp-duty.ts';
import type { EpcRating } from './deal.ts';

export const NATION_NAMES: Record<TaxCountry, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
};

export const RULES_NOTE: Record<TaxCountry, string> = {
  england: 'England: the Renters’ Rights Act applies. Tenancies roll on month to month, and there have been no Section 21 “no-fault” evictions since 1 May 2026.',
  wales: 'Wales: the Renting Homes (Wales) Act applies. Tenants hold occupation contracts, a no-fault notice is at least six months, and landlords register with Rent Smart Wales.',
  scotland: 'Scotland: lets are private residential tenancies. They are open-ended, there is no no-fault eviction, and landlords must register with their council.',
  northern_ireland: 'Northern Ireland: the Private Tenancies Act applies, with longer notice periods, landlord registration and deposit protection.',
};

const BELOW_C = new Set<EpcRating>(['D', 'E', 'F', 'G']);

/** The EPC warning for this rating and nation, or null when there is nothing to say. */
export function epcLine(country: TaxCountry, rating: EpcRating | null): string | null {
  if (country === 'england') {
    if (rating === null) return 'EPC not checked yet. New tenancies in England need EPC C by 2030 (upgrade costs capped at £10,000).';
    return BELOW_C.has(rating) ? `EPC ${rating}: new tenancies in England need EPC C by 2030 (upgrade costs capped at £10,000).` : null;
  }
  if (country === 'wales') {
    if (rating === null) return 'EPC not checked yet. Homes let in Wales need at least EPC E.';
    return rating === 'F' || rating === 'G' ? `EPC ${rating}: homes let in Wales need at least EPC E.` : null;
  }
  return null;
}

/** The line every BTL screen ends with. */
export const BTL_DISCLAIMER = 'Before tax. An estimate, not advice. Get a mortgage broker’s view.';
