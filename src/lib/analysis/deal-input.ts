/**
 * What a Full analysis of a deal in the feed runs on: the listing's own
 * facts, exactly as the analyser prefills them from a listing link
 * (snapshotToPrefill), with no form to change them. Fixed inputs are what
 * make one member's analysis reusable by the next (src/lib/analysis/reuse.ts):
 * the reuse key below is those inputs.
 *
 * Pure: no server-only, relative `.ts` imports only.
 */

import { snapshotToPrefill, pcmFromPrice } from '../listing/normalise.ts';
import { parseAnalysisInput, type AnalysisInput } from './input.ts';
import type { ListingPrice, ListingSnapshot } from '../listing/types.ts';

/** A full UK postcode, spaced and upper-case ("M4 5AE"), or null for an outcode or nothing. */
export function fullPostcode(raw: string | null | undefined): string | null {
  const m = raw?.trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

export type DealInputResult =
  | { ok: true; input: AnalysisInput; key: string }
  | { ok: false; code: 'no_postcode' | 'no_price' | 'invalid'; message: string };

export const DEAL_INPUT_MESSAGES = {
  no_postcode: 'A Full analysis needs the property’s full postcode, and this listing doesn’t show one. You can still take a Quick look.',
  no_price: 'A Full analysis of a rental needs its rent, and this listing doesn’t show one. You can still take a Quick look.',
} as const;

/**
 * The analysis input for one deal. `price` is the deal's CURRENT price (the
 * marketplace row, which the rechecks keep up to date); the snapshot's own
 * may be older. A sale with no price still runs on the estimated value, as
 * the analyser does; a rental with no rent cannot be judged at all.
 */
export function dealAnalysisInput(
  snapshot: ListingSnapshot,
  opts: { canonicalUrl: string; kind: 'sale' | 'rent'; price: ListingPrice | null; withPmi: boolean; checkedListingId: string | null },
): DealInputResult {
  const { prefill } = snapshotToPrefill({ ...snapshot, kind: opts.kind, price: opts.price ?? snapshot.price });
  const postcode = fullPostcode(prefill.postcode || snapshot.postcode);
  if (!postcode) return { ok: false, code: 'no_postcode', message: DEAL_INPUT_MESSAGES.no_postcode };
  const purchasePrice = opts.kind === 'sale' && opts.price?.period === 'total' ? Math.round(opts.price.amount) : opts.kind === 'sale' ? prefill.purchasePrice : undefined;
  const advertisedRent = opts.kind === 'rent' ? (opts.price ? pcmFromPrice(opts.price) ?? undefined : prefill.advertisedRent) : undefined;
  if (opts.kind === 'rent' && !advertisedRent) return { ok: false, code: 'no_price', message: DEAL_INPUT_MESSAGES.no_price };
  const parsed = parseAnalysisInput({
    address: prefill.address,
    postcode,
    bedrooms: prefill.bedrooms,
    guests: prefill.guests,
    bathrooms: prefill.bathrooms,
    propertyType: prefill.propertyType,
    parking: prefill.parking,
    outdoorSpace: prefill.outdoorSpace,
    purchasePrice,
    advertisedRent,
    sourceListing: { url: opts.canonicalUrl, kind: opts.kind, title: snapshot.title, photo: snapshot.photos?.[0] },
    checkedListingId: opts.checkedListingId ?? undefined,
    fromDeal: true,
    enhanced: opts.withPmi,
  });
  if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.error };
  return { ok: true, input: parsed.input, key: inputKeyFor(parsed.input) };
}

/**
 * The inputs that decide what the providers answer. Two analyses of one deal
 * with the same key asked every provider the same questions, so the second
 * can reuse the first. The price is deliberately not in it: it changes only
 * the deal maths, which are worked out again for every member anyway.
 */
export function inputKeyFor(i: AnalysisInput): string {
  return ['v1', i.property.postcode, i.property.bedrooms, i.property.guests, i.bathrooms ?? 1, i.propertyType, i.parkingSpaces, i.outdoorSpace, i.rentPcm ? 'rent' : 'sale'].join('|');
}
