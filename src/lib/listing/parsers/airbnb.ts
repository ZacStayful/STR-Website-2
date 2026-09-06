import type { ListingSnapshot } from '../types.ts';
import { scriptJsonById, metaContent, titleOf, findNode } from '../html.ts';
import { toNum, toStr, baseSnapshot, type ParseContext } from './shared.ts';

export const AIRBNB_PARSER_VERSION = 1;

/** "Home in Greater Manchester · ★4.91 · 4 bedrooms · 7 beds · 2 bathrooms" */
export function parseAirbnbSummary(text: string | null | undefined): { bedrooms?: number; bathrooms?: number; beds?: number; rating?: number; place?: string } {
  if (!text) return {};
  const out: { bedrooms?: number; bathrooms?: number; beds?: number; rating?: number; place?: string } = {};
  const parts = text.split('·').map((s) => s.trim());
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/★\s*([\d.]+)/))) out.rating = Number(m[1]);
    else if ((m = part.match(/^(\d+)\s+bedrooms?$/i))) out.bedrooms = Number(m[1]);
    else if (/^studio$/i.test(part)) out.bedrooms = 0;
    else if ((m = part.match(/^([\d.]+)\s+(?:shared\s+|private\s+)?bath(?:room)?s?$/i))) out.bathrooms = Number(m[1]);
    else if ((m = part.match(/^(\d+)\s+beds?$/i))) out.beds = Number(m[1]);
    else if ((m = part.match(/\bin\s+(.+)$/i)) && !out.place) out.place = m[1];
  }
  return out;
}

function deferredState(html: string): unknown | null {
  // The id carries a numeric suffix; the first chunk holds the listing.
  const m = html.match(/<script[^>]*\sid=["'](data-deferred-state-\d+)["']/i);
  return m ? scriptJsonById(html, m[1]) : null;
}

export function parseAirbnb(html: string, ctx: ParseContext): ListingSnapshot | null {
  const state = deferredState(html);
  const ogTitle = metaContent(html, 'og:title');
  const ogDesc = metaContent(html, 'og:description');
  const pageTitle = titleOf(html);
  if (!state && !ogTitle && !pageTitle) return null;

  const snap = baseSnapshot('airbnb', ctx, AIRBNB_PARSER_VERSION);
  snap.kind = 'str';

  const log = state ? findNode(state, (o) => 'listingLat' in o && 'listingLng' in o) : null;
  const overview = state ? findNode(state, (o) => o.__typename === 'StaysPdpOverview') : null;
  const rating = state ? findNode(state, (o) => o.__typename === 'DemandReviewRatingStats') : null;
  const location = state ? findNode(state, (o) => o.__typename === 'StaysPdpLocation') : null;
  const sharing = state ? findNode(state, (o) => typeof o.__typename === 'string' && /SharingConfig$/.test(o.__typename) && typeof o.title === 'string') : null;
  const localized = state ? findNode(state, (o) => typeof o.localizedLocation === 'string') : null;

  const summaryText = toStr(sharing?.title) ?? ogTitle;
  const summary = parseAirbnbSummary(summaryText);
  const overviewItems = Array.isArray(overview?.items) ? (overview!.items as unknown[]).map(String) : [];
  const fromOverview = parseAirbnbSummary(overviewItems.join(' · '));

  // Listing name: og:description carries the host's title; <title> is "<name> - <category> in <place> - Airbnb".
  const name = toStr(ogDesc) ?? (pageTitle ? pageTitle.split(' - ')[0].trim() : null) ?? summaryText ?? `Airbnb listing ${ctx.id}`;
  snap.title = name;

  const lat = toNum(log?.listingLat) ?? toNum(location?.latitude);
  const lng = toNum(log?.listingLng) ?? toNum(location?.longitude);
  if (lat !== null && lng !== null) {
    snap.lat = lat;
    snap.lng = lng;
  }
  // Airbnb deliberately fuzzes the pin; a postcode has to come from a reverse geocode.
  snap.locationConfidence = 'none';
  const place = toStr(localized?.localizedLocation) ?? toStr(location?.subtitle) ?? summary.place;
  snap.displayAddress = place ?? undefined;

  snap.bedrooms = fromOverview.bedrooms ?? summary.bedrooms;
  snap.bathrooms = fromOverview.bathrooms ?? summary.bathrooms;
  const guests = toNum(log?.personCapacity) ?? overviewItems.map((s) => s.match(/^(\d+)\s+guests?$/i)?.[1]).map(Number).find((n) => Number.isFinite(n) && n > 0);
  if (guests) snap.guests = guests;
  snap.rawType = toStr(log?.roomType) ?? (ogTitle ? ogTitle.split('·')[0].trim() : undefined) ?? undefined;

  const ratingAvg = toNum(rating?.ratingAverage) ?? toNum(log?.guestSatisfactionOverall) ?? summary.rating;
  const reviewCount = toNum(rating?.ratingCount) ?? toNum(log?.visibleReviewCount);
  snap.str = {
    rating: ratingAvg ?? undefined,
    reviewCount: reviewCount ?? undefined,
    roomType: snap.rawType,
    isSuperhost: log?.isSuperhost === true ? true : undefined,
    localizedLocation: place ?? undefined,
  };

  const og = metaContent(html, 'og:image');
  if (og) snap.photos.push(og);
  snap.status = 'available';
  return snap;
}
