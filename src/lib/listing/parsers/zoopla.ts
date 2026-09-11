import type { ListingSnapshot } from '../types.ts';
import { scriptJsonById, metaContent, titleOf, parsePrice, findPostcode, findOutcode, findNode } from '../html.ts';
import { toNum, toStr, strArray, statusFromText, baseSnapshot, type ParseContext } from './shared.ts';

export const ZOOPLA_PARSER_VERSION = 1;

/**
 * Zoopla blocks server fetches, so in practice this parser runs on pages the
 * browser extension hands us. It is deliberately tolerant: it looks for the
 * listing node anywhere in __NEXT_DATA__ and falls back to Open Graph tags.
 */
export function parseZoopla(html: string, ctx: ParseContext): ListingSnapshot | null {
  const nd = scriptJsonById(html, '__NEXT_DATA__');
  const listing = nd ? findNode(nd, (o) => 'listingId' in o && ('counts' in o || 'numBedrooms' in o || 'pricing' in o || 'location' in o)) : null;
  const taxonomy = nd ? findNode(nd, (o) => 'outcode' in o && ('incode' in o || 'postalArea' in o)) : null;
  const ogTitle = metaContent(html, 'og:title');
  const title = toStr(listing?.title) ?? ogTitle ?? titleOf(html);
  if (!listing && !title) return null;

  const snap = baseSnapshot('zoopla', ctx, ZOOPLA_PARSER_VERSION);
  snap.title = title ?? `Zoopla listing ${ctx.id}`;
  const section = toStr(listing?.section) ?? toStr(listing?.category);
  snap.kind = section === 'to-rent' || /to rent|to let/i.test(snap.title) || /to-rent/.test(ctx.canonicalUrl) ? 'rent' : 'sale';

  const address = listing?.address;
  snap.displayAddress = toStr(listing?.displayAddress) ?? (typeof address === 'string' ? address : toStr((address as { displayAddress?: unknown } | undefined)?.displayAddress)) ?? undefined;
  const outcode = toStr(taxonomy?.outcode)?.toUpperCase();
  const incode = toStr(taxonomy?.incode)?.toUpperCase();
  const pc = outcode && incode ? { postcode: `${outcode} ${incode}`, outcode } : findPostcode(snap.displayAddress);
  if (pc) {
    snap.postcode = pc.postcode;
    snap.outcode = pc.outcode;
  } else {
    snap.outcode = outcode ?? findOutcode(snap.displayAddress) ?? undefined;
  }
  const coords = (listing?.location as { coordinates?: { latitude?: unknown; longitude?: unknown } } | undefined)?.coordinates;
  const lat = toNum(coords?.latitude);
  const lng = toNum(coords?.longitude);
  if (lat !== null && lng !== null) {
    snap.lat = lat;
    snap.lng = lng;
  }
  snap.locationConfidence = snap.postcode ? 'exact' : snap.outcode ? 'outcode' : 'none';

  const counts = listing?.counts as { numBedrooms?: unknown; numBathrooms?: unknown } | undefined;
  snap.bedrooms = toNum(counts?.numBedrooms) ?? toNum(listing?.numBedrooms) ?? undefined;
  snap.bathrooms = toNum(counts?.numBathrooms) ?? toNum(listing?.numBathrooms) ?? undefined;
  snap.rawType = toStr(listing?.propertyType) ?? undefined;

  const pricing = listing?.pricing as { label?: unknown; internalValue?: unknown } | undefined;
  const price = parsePrice(toStr(pricing?.label)) ?? parsePrice(ogTitle);
  if (price) snap.price = price;
  snap.tenure = toStr(listing?.tenure)?.toLowerCase() ?? undefined;

  const features = listing?.features as { bullets?: unknown } | undefined;
  snap.features = strArray(features?.bullets);
  const og = metaContent(html, 'og:image');
  if (og) snap.photos.push(og);
  snap.status = statusFromText(toStr(listing?.listingStatus)?.replace(/_/g, ' ')) ?? statusFromText(snap.title) ?? 'available';
  return snap;
}
