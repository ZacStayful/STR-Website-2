import type { ListingSnapshot, ListingStatus } from '../types.ts';
import { unflatten } from '../devalue.ts';
import { jsonAfter, metaContent, titleOf, parsePrice, findOutcode } from '../html.ts';
import { toNum, toStr, strArray, statusFromText, baseSnapshot, isoFromCompactDate, isoFromUkDate, parseListingUpdate, type ParseContext } from './shared.ts';
import { agentHash } from '../../crypto/agent.ts';
import { shortLetsAllowed, stripHtml } from '../suitability.ts';

export const RIGHTMOVE_PARSER_VERSION = 2;

interface RmPropertyData {
  id?: unknown;
  transactionType?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  propertySubType?: unknown;
  address?: { displayAddress?: unknown; outcode?: unknown; incode?: unknown };
  location?: { latitude?: unknown; longitude?: unknown; pinType?: unknown };
  prices?: { primaryPrice?: unknown; secondaryPrice?: unknown; displayPriceQualifier?: unknown };
  tenure?: { tenureType?: unknown; yearsRemainingOnLease?: unknown };
  livingCosts?: { councilTaxBand?: unknown };
  keyFeatures?: unknown;
  images?: unknown;
  status?: { published?: unknown; archived?: unknown };
  tags?: unknown;
  text?: { pageTitle?: unknown; propertyPhrase?: unknown; description?: unknown; shortDescription?: unknown };
  lettings?: { letType?: unknown; furnishType?: unknown; letAvailableDate?: unknown; minimumTermInMonths?: unknown } | null;
  listingHistory?: { listingUpdateReason?: unknown } | null;
  customer?: { branchDisplayName?: unknown; companyName?: unknown; displayName?: unknown } | null;
  sharedOwnership?: { sharedOwnershipFlag?: unknown } | null;
}

interface RmModel {
  propertyData: RmPropertyData | null;
  /** Sibling of `propertyData`, and the only place the exact listing date lives. */
  analyticsInfo: { analyticsProperty?: { added?: unknown } } | null;
}

/**
 * Decodes `window.PAGE_MODEL` (flattened `data` string or a plain object) and
 * keeps both branches we read. `analyticsInfo.analyticsProperty.added` carries
 * the listing's exact added date — `propertyData` alone does not have it.
 */
function rightmoveModel(html: string): RmModel | null {
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
  const m = model as Record<string, unknown> | undefined;
  const pd = m?.propertyData;
  const ai = m?.analyticsInfo;
  return {
    propertyData: pd && typeof pd === 'object' ? (pd as RmPropertyData) : null,
    analyticsInfo: ai && typeof ai === 'object' ? (ai as RmModel['analyticsInfo']) : null,
  };
}

/** The property branch alone. Signature unchanged: parsers.test.ts asserts on it. */
export function rightmovePageModel(html: string): RmPropertyData | null {
  return rightmoveModel(html)?.propertyData ?? null;
}

export function parseRightmove(html: string, ctx: ParseContext): ListingSnapshot | null {
  const model = rightmoveModel(html);
  const p = model?.propertyData ?? null;
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
  const yearsLeft = toNum(p?.tenure?.yearsRemainingOnLease);
  // 0 is Rightmove's "not stated" for a freehold, not a lease about to expire.
  if (yearsLeft !== null && yearsLeft > 0) snap.yearsRemainingOnLease = yearsLeft;

  // When the seller started, and what they last did about it. The added date is
  // the portal's own, so days on market no longer depends on when we first looked.
  const added = isoFromCompactDate(model?.analyticsInfo?.analyticsProperty?.added);
  if (added) snap.listedDate = added;
  const update = parseListingUpdate(p?.listingHistory?.listingUpdateReason, snap.fetchedAt.slice(0, 10));
  if (update) {
    snap.listingUpdate = update;
    // "Added on <date>" is the listing date when analytics did not give one.
    if (!snap.listedDate && update.reason === 'added' && update.on) snap.listedDate = update.on;
  }
  snap.agentHash = agentHash(toStr(p?.customer?.branchDisplayName) ?? toStr(p?.customer?.displayName) ?? toStr(p?.customer?.companyName));
  snap.councilTaxBand = toStr(p?.livingCosts?.councilTaxBand) ?? undefined;
  snap.features = strArray(p?.keyFeatures);
  if (p?.lettings) {
    const furnish = toStr(p.lettings.furnishType);
    if (furnish) snap.features.push(furnish);
    // A date already past is a property standing empty; a one-month minimum is a
    // landlord who will already discuss a short term.
    const available = isoFromUkDate(p.lettings.letAvailableDate);
    if (available) snap.letAvailableDate = available;
    const minTerm = toNum(p.lettings.minimumTermInMonths);
    if (minTerm !== null && minTerm > 0) snap.minimumTermInMonths = minTerm;
  }
  // Suitability evidence: the description is read here and dropped (never stored).
  snap.sharedOwnership = false;
  snap.shortLetsPermitted = null;
  if (p) {
    const description = stripHtml([toStr(p.text?.description), toStr(p.text?.shortDescription)].filter((s): s is string => Boolean(s)).join(' '));
    snap.sharedOwnership = p.sharedOwnership?.sharedOwnershipFlag === true || /shared ownership/i.test(description);
    snap.shortLetsPermitted = shortLetsAllowed([description, ...snap.features].join('. '));
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
