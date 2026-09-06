import type { ListingSnapshot } from '../types.ts';
import { jsonLdBlocks, metaContent, titleOf, parsePrice, findPostcode, findNode } from '../html.ts';
import { toNum, toStr, baseSnapshot, type ParseContext } from './shared.ts';

export const BOOKING_PARSER_VERSION = 1;

const LODGING_TYPES = new Set(['Hotel', 'LodgingBusiness', 'Apartment', 'House', 'Hostel', 'BedAndBreakfast', 'Resort', 'Motel', 'VacationRental']);

/**
 * Booking.com blocks server fetches; pages arrive via the extension. The
 * JSON-LD block is the most stable thing on the page, so it is the source of
 * truth, with Open Graph tags as the fallback.
 */
export function parseBooking(html: string, ctx: ParseContext): ListingSnapshot | null {
  const ld = jsonLdBlocks(html)
    .map((b) => findNode(b, (o) => typeof o['@type'] === 'string' && LODGING_TYPES.has(o['@type'] as string)))
    .find((o): o is Record<string, unknown> => Boolean(o));
  const ogTitle = metaContent(html, 'og:title');
  const title = toStr(ld?.name) ?? ogTitle ?? titleOf(html);
  if (!ld && !title) return null;

  const snap = baseSnapshot('booking', ctx, BOOKING_PARSER_VERSION);
  snap.kind = 'str';
  snap.title = title ?? `Booking.com property ${ctx.id}`;
  snap.rawType = toStr(ld?.['@type']) ?? undefined;

  const addr = ld?.address as Record<string, unknown> | string | undefined;
  const addrText = typeof addr === 'string' ? addr : [addr?.streetAddress, addr?.addressLocality, addr?.postalCode].map((x) => toStr(x)).filter(Boolean).join(', ');
  snap.displayAddress = addrText || undefined;
  const pc = findPostcode(typeof addr === 'object' ? toStr(addr?.postalCode) : null) ?? findPostcode(addrText);
  if (pc) {
    snap.postcode = pc.postcode;
    snap.outcode = pc.outcode;
    snap.locationConfidence = 'exact';
  }
  const geo = ld?.geo as Record<string, unknown> | undefined;
  const lat = toNum(geo?.latitude);
  const lng = toNum(geo?.longitude);
  if (lat !== null && lng !== null) {
    snap.lat = lat;
    snap.lng = lng;
  }

  const agg = ld?.aggregateRating as Record<string, unknown> | undefined;
  const ratingValue = toNum(agg?.ratingValue);
  const best = toNum(agg?.bestRating) ?? 10;
  snap.str = {
    rating: ratingValue === null ? undefined : Math.round((ratingValue / best) * 5 * 100) / 100,
    reviewCount: toNum(agg?.reviewCount) ?? toNum(agg?.ratingCount) ?? undefined,
    roomType: snap.rawType,
  };
  const price = parsePrice(toStr(ld?.priceRange));
  if (price) snap.price = { amount: price.amount, period: 'night' };

  const og = metaContent(html, 'og:image') ?? toStr(ld?.image);
  if (og) snap.photos.push(og);
  snap.status = 'available';
  return snap;
}
