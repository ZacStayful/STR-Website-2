import type { ListingSnapshot, ListingStatus } from '../types.ts';
import { unflatten } from '../devalue.ts';
import { jsonAfter, metaContent, titleOf, parsePrice, findOutcode } from '../html.ts';
import { toNum, toStr, strArray, statusFromText, baseSnapshot, type ParseContext } from './shared.ts';

export const RIGHTMOVE_PARSER_VERSION = 1;

interface RmPropertyData {
  id?: unknown;
  transactionType?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  propertySubType?: unknown;
  address?: { displayAddress?: unknown; outcode?: unknown; incode?: unknown };
  location?: { latitude?: unknown; longitude?: unknown; pinType?: unknown };
  prices?: { primaryPrice?: unknown; secondaryPrice?: unknown; displayPriceQualifier?: unknown };
  tenure?: { tenureType?: unknown };
  livingCosts?: { councilTaxBand?: unknown };
  keyFeatures?: unknown;
  images?: unknown;
  status?: { published?: unknown; archived?: unknown };
  tags?: unknown;
  text?: { pageTitle?: unknown; propertyPhrase?: unknown };
  lettings?: { letType?: unknown; furnishType?: unknown } | null;
}

/** Decodes `window.PAGE_MODEL` (flattened `data` string or a plain object). */
export function rightmovePageModel(html: string): RmPropertyData | null {
  const outer = jsonAfter(html, 'PAGE_MODEL') as Record<string, unknown> | null;
  if (!outer) return null;
  let model: unknown = outer;
  if (typeof outer.data === 'string') {
    try {
      model = unflatten(JSON.parse(outer.data));
    } catch {
      return null;
    }
  }
  const pd = (model as Record<string, unknown> | undefined)?.propertyData;
  return pd && typeof pd === 'object' ? (pd as RmPropertyData) : null;
}

export function parseRightmove(html: string, ctx: ParseContext): ListingSnapshot | null {
  const p = rightmovePageModel(html);
  const ogTitle = metaContent(html, 'og:title');
  const pageTitle = titleOf(html);
  const title = toStr(p?.text?.pageTitle) ?? ogTitle ?? pageTitle;
  if (!p && !title) return null;

  const snap = baseSnapshot('rightmove', ctx, RIGHTMOVE_PARSER_VERSION);
  snap.title = title ?? `Rightmove listing ${ctx.id}`;
  const tx = toStr(p?.transactionType)?.toUpperCase();
  snap.kind = tx === 'RENT' ? 'rent' : tx === 'BUY' ? 'sale' : /for rent|to rent|to let/i.test(snap.title) ? 'rent' : 'sale';

  snap.displayAddress = toStr(p?.address?.displayAddress) ?? undefined;
  const outcode = toStr(p?.address?.outcode)?.toUpperCase();
  const incode = toStr(p?.address?.incode)?.toUpperCase();
  if (outcode && incode) {
    snap.postcode = `${outcode} ${incode}`;
    snap.outcode = outcode;
  } else if (outcode) {
    snap.outcode = outcode;
  } else {
    snap.outcode = findOutcode(snap.displayAddress ?? snap.title) ?? undefined;
  }

  const lat = toNum(p?.location?.latitude);
  const lng = toNum(p?.location?.longitude);
  if (lat !== null && lng !== null) {
    snap.lat = lat;
    snap.lng = lng;
  }
  snap.locationConfidence = snap.postcode ? 'exact' : snap.outcode ? 'outcode' : 'none';

  snap.bedrooms = toNum(p?.bedrooms) ?? undefined;
  snap.bathrooms = toNum(p?.bathrooms) ?? undefined;
  snap.rawType = toStr(p?.propertySubType) ?? undefined;

  const price = parsePrice(toStr(p?.prices?.primaryPrice)) ?? parsePrice(toStr(p?.prices?.secondaryPrice));
  if (price) {
    snap.price = { ...price };
    const q = toStr(p?.prices?.displayPriceQualifier);
    if (q) snap.price.qualifier = q;
  }

  snap.tenure = toStr(p?.tenure?.tenureType)?.toLowerCase() ?? undefined;
  snap.councilTaxBand = toStr(p?.livingCosts?.councilTaxBand) ?? undefined;
  snap.features = strArray(p?.keyFeatures);
  if (p?.lettings) {
    const furnish = toStr(p.lettings.furnishType);
    if (furnish) snap.features.push(furnish);
  }
  const images = Array.isArray(p?.images) ? (p.images as { url?: unknown }[]) : [];
  snap.photos = images.map((i) => toStr(i?.url)).filter((u): u is string => Boolean(u)).slice(0, 6);
  if (snap.photos.length === 0) {
    const og = metaContent(html, 'og:image');
    if (og) snap.photos.push(og);
  }

  snap.status = rightmoveStatus(p, snap.title);
  return snap;
}

function rightmoveStatus(p: RmPropertyData | null, title: string): ListingStatus {
  if (p?.status?.archived === true || p?.status?.published === false) return 'removed';
  const tags = strArray(p?.tags).join(' ');
  const fromTags = statusFromText(tags.replace(/_/g, ' '));
  if (fromTags) return fromTags;
  return statusFromText(title) ?? 'available';
}
