import type { ListingSnapshot } from '../types.ts';
import { scriptJsonById, metaContent, titleOf, parsePrice, findPostcode, findOutcode } from '../html.ts';
import { toNum, toStr, statusFromText, baseSnapshot, addProjectFacts, floorAreaSqftFrom, leaseYearsFrom, SNAPSHOT_PHOTO_LIMIT, type ParseContext } from './shared.ts';
import { shortLetsAllowed, stripHtml } from '../suitability.ts';
import { AUCTION_WORDING } from '../../deal-quality/auction.ts';

export const ONTHEMARKET_PARSER_VERSION = 2;

interface OtmProperty {
  id?: unknown;
  displayAddress?: unknown;
  price?: unknown;
  priceQualifier?: unknown;
  propertyTitle?: unknown;
  toRent?: unknown;
  forSale?: unknown;
  humanisedPropertyType?: unknown;
  location?: { lat?: unknown; lon?: unknown };
  bedrooms?: unknown;
  bathrooms?: unknown;
  features?: unknown;
  keyInfo?: unknown;
  images?: unknown;
  propertyLabels?: unknown;
  student?: unknown;
  pageTitles?: { pageTitle?: unknown };
  description?: unknown;
  'full-description'?: unknown;
  summary?: unknown;
}

/** The page's property JSON (Batch 17's photo check reads its images and floorplans). */
export function onTheMarketProperty(html: string): (OtmProperty & { floorplans?: unknown }) | null {
  return reduxState(html)?.property ?? null;
}

function reduxState(html: string): { property?: OtmProperty; metadata?: { dataLayer?: Record<string, unknown> } } | null {
  const nd = scriptJsonById(html, '__NEXT_DATA__') as { props?: { initialReduxState?: unknown } } | null;
  const rs = nd?.props?.initialReduxState;
  return rs && typeof rs === 'object' ? (rs as { property?: OtmProperty; metadata?: { dataLayer?: Record<string, unknown> } }) : null;
}

export function parseOnTheMarket(html: string, ctx: ParseContext): ListingSnapshot | null {
  const rs = reduxState(html);
  const p = rs?.property;
  const dl = rs?.metadata?.dataLayer ?? {};
  const ogTitle = metaContent(html, 'og:title');
  const title = toStr(p?.pageTitles?.pageTitle) ?? ogTitle ?? titleOf(html);
  if (!p && !title) return null;

  const snap = baseSnapshot('onthemarket', ctx, ONTHEMARKET_PARSER_VERSION);
  snap.title = title ?? `OnTheMarket listing ${ctx.id}`;
  const channel = toStr(dl.channel);
  snap.kind = p?.toRent === true || channel === 'rent' ? 'rent' : p?.forSale === true || channel === 'sale' ? 'sale' : /to rent|to let/i.test(snap.title) ? 'rent' : 'sale';

  snap.displayAddress = toStr(p?.displayAddress) ?? undefined;
  const pc = findPostcode(toStr(dl.postcode)) ?? findPostcode(snap.displayAddress);
  if (pc) {
    snap.postcode = pc.postcode;
    snap.outcode = pc.outcode;
  } else {
    snap.outcode = findOutcode(snap.displayAddress) ?? undefined;
  }
  const lat = toNum(p?.location?.lat);
  const lng = toNum(p?.location?.lon);
  if (lat !== null && lng !== null) {
    snap.lat = lat;
    snap.lng = lng;
  }
  snap.locationConfidence = snap.postcode ? 'exact' : snap.outcode ? 'outcode' : 'none';

  snap.bedrooms = toNum(p?.bedrooms) ?? undefined;
  const baths = toNum(p?.bathrooms);
  snap.bathrooms = baths && baths > 0 ? baths : undefined;
  snap.rawType = toStr(p?.humanisedPropertyType) ?? undefined;

  const price = parsePrice(toStr(p?.price)) ?? parsePrice(ogTitle);
  if (price) {
    snap.price = { ...price };
    const q = toStr(p?.priceQualifier);
    if (q) snap.price.qualifier = q;
  }

  const features = Array.isArray(p?.features) ? (p.features as { feature?: unknown }[]) : [];
  snap.features = features.map((f) => toStr(f?.feature)).filter((s): s is string => Boolean(s));
  const keyInfo = Array.isArray(p?.keyInfo) ? (p.keyInfo as { title?: unknown; value?: unknown }[]) : [];
  for (const k of keyInfo) {
    const t = toStr(k?.title)?.toLowerCase() ?? '';
    const v = toStr(k?.value);
    if (!v) continue;
    if (t.startsWith('tenure')) {
      snap.tenure = v.split('|')[0].trim().toLowerCase();
      // "Leasehold | 976 yrs left": the years left were dropped before Batch 17.
      const years = leaseYearsFrom(v);
      if (years !== null) snap.yearsRemainingOnLease = years;
    }
    if (t.startsWith('council tax')) snap.councilTaxBand = v.replace(/^band\s*/i, '').trim();
  }
  if (!snap.councilTaxBand) {
    const f = snap.features.find((x) => /council tax band/i.test(x));
    const m = f?.match(/band:?\s*([A-H])/i);
    if (m) snap.councilTaxBand = m[1].toUpperCase();
  }
  if (p?.student === true) snap.features.push('Student let');
  snap.sharedOwnership = false;
  snap.shortLetsPermitted = null;
  snap.auction = false;
  if (p) {
    // Suitability evidence: description read and dropped; tenure / key info lines count too.
    const description = stripHtml([toStr(p.description), toStr(p['full-description']), toStr(p.summary)].filter((s): s is string => Boolean(s)).join(' '));
    const keyLines = keyInfo.map((k) => `${toStr(k?.title) ?? ''}: ${toStr(k?.value) ?? ''}`);
    snap.sharedOwnership = /shared ownership/i.test([description, snap.price?.qualifier ?? '', ...keyLines].join(' '));
    snap.shortLetsPermitted = shortLetsAllowed([description, ...snap.features, ...keyLines].join('. '));
    snap.auction = AUCTION_WORDING.test([description, snap.price?.qualifier ?? '', ...snap.features, ...keyLines].join(' | '));
    // "Tenure: Leasehold (975 years remaining)" in the features; the floor area where it is stated.
    if (snap.yearsRemainingOnLease === undefined) snap.yearsRemainingOnLease = leaseYearsFrom(...snap.features, ...keyLines) ?? undefined;
    snap.floorAreaSqft = floorAreaSqftFrom(...keyLines, ...snap.features, description) ?? undefined;
    // Batch 17: the needs-work flag and the exclusions, from the same words (then dropped).
    addProjectFacts(snap, [description, ...keyLines].join(' | '));
  } else addProjectFacts(snap, '');

  const images = Array.isArray(p?.images) ? (p.images as { largeUrl?: unknown; url?: unknown }[]) : [];
  snap.photos = images.map((i) => toStr(i?.largeUrl) ?? toStr(i?.url)).filter((u): u is string => Boolean(u)).slice(0, SNAPSHOT_PHOTO_LIMIT);
  if (snap.photos.length === 0) {
    const og = metaContent(html, 'og:image');
    if (og) snap.photos.push(og);
  }

  const labels = Array.isArray(p?.propertyLabels) ? (p.propertyLabels as unknown[]).map(String).join(' ') : '';
  snap.status = toStr(dl.status) === 'removed' ? 'removed' : (statusFromText(labels) ?? statusFromText(snap.title) ?? 'available');
  return snap;
}
