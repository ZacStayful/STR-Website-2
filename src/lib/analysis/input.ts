/**
 * Parsing and validation of an analysis request body, lifted out of
 * `/api/analyse` so every caller validates identically — the members-only
 * SSE route, the public funnel and the v1 API.
 *
 * Pure module: no I/O, no `server-only`, no env reads, relative `.ts`
 * imports only, so it can be unit-tested under `node --test`. The one
 * env-dependent decision — whether the PMI second opinion is available —
 * stays with the caller: this module only reports what was *asked* for
 * (`enhancedRequested`).
 */

import { detectListingUrl } from '../listing/detect.ts';
import type { PropertyInput, SourceListingRef } from '../types.ts';

/** Everything the analysis needs, normalised and known-valid. */
export interface AnalysisInput {
  property: PropertyInput;
  /** Contact email supplied with the request, when there was one. */
  email: string | null;
  /** PropertyData property-type slug, e.g. 'flat' | 'terraced_house'. */
  propertyType: string;
  bathrooms: number | undefined;
  /** Numeric parking spaces for the provider APIs (0 when none). */
  parkingSpaces: number;
  /** True for allocated/garage/driveway — on-street does not count. */
  hasParking: boolean;
  /** PropertyData outdoor-space slug. */
  outdoorSpace: string;
  askingPrice: number | null;
  rentPcm: number | null;
  sourceListing: SourceListingRef | null;
  checkedListingId: string | null;
  /**
   * Run from a deal's Full report button: a pipeline row that already has a
   * report is not analysed (or charged) again. See src/lib/analysis/report-claim.ts.
   */
  fromDeal: boolean;
  /** The form asked for the PMI second opinion. The kill switch is the caller's. */
  enhancedRequested: boolean;
}

export type ParseResult =
  | { ok: true; input: AnalysisInput }
  | { ok: false; error: string };

// Parking selection → numeric value for the provider APIs.
const PARKING: Record<string, number> = {
  no_parking: 0,
  on_street: 0,
  allocated: 1,
  garage: 1,
  driveway_1: 1,
  driveway_2: 2,
};

// Outdoor space → PropertyData format.
const OUTDOOR: Record<string, string> = {
  none: 'none',
  balcony: 'balcony_terrace',
  garden: 'garden',
  roof_terrace: 'balcony_terrace',
};

// Property type → PropertyData format. The lower-case entries are the
// current form values; the title-case ones are kept for older clients.
const PROPERTY_TYPE: Record<string, string> = {
  Flat: 'flat',
  Terraced: 'terraced_house',
  'Semi-detached': 'semi-detached_house',
  Detached: 'detached_house',
  // Legacy values (backwards compat)
  'Terraced House': 'terraced_house',
  'Semi-Detached House': 'semi-detached_house',
  'Detached House': 'detached_house',
};

/** A positive, sane money value, or null. */
function money(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : null;
}

function sourceRef(raw: unknown, askingPrice: number | null, rentPcm: number | null): SourceListingRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const sl = raw as Record<string, unknown>;
  const detected = typeof sl.url === 'string' ? detectListingUrl(sl.url) : null;
  if (!detected) return null;
  const source: SourceListingRef = {
    url: detected.canonicalUrl,
    source: detected.source,
    kind: sl.kind === 'rent' ? 'rent' : sl.kind === 'str' ? 'str' : 'sale',
    title: typeof sl.title === 'string' ? sl.title.slice(0, 200) : undefined,
    photo: typeof sl.photo === 'string' && /^https:\/\//.test(sl.photo) ? sl.photo.slice(0, 500) : undefined,
  };
  if (askingPrice && source.kind === 'sale') source.price = { amount: askingPrice, period: 'total' };
  if (rentPcm && source.kind === 'rent') source.price = { amount: rentPcm, period: 'pcm' };
  return source;
}

/**
 * Validates a posted body. The error strings are the ones the analyser has
 * always returned, so the client's messaging is unchanged.
 */
export function parseAnalysisInput(body: unknown): ParseResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (!b.address || typeof b.address !== 'string' || b.address.trim().length === 0) {
    return { ok: false, error: 'A valid property address is required.' };
  }
  if (!b.postcode || typeof b.postcode !== 'string' || b.postcode.trim().length < 3) {
    return { ok: false, error: 'A valid UK postcode is required.' };
  }

  const bedrooms = Number(b.bedrooms);
  if (!Number.isFinite(bedrooms) || bedrooms < 0 || bedrooms > 10) {
    return { ok: false, error: 'Bedrooms must be a number between 0 and 10.' };
  }

  const guests = Number(b.guests);
  if (!Number.isFinite(guests) || guests < 1 || guests > 16) {
    return { ok: false, error: 'Guests must be a number between 1 and 16.' };
  }

  const askingPrice = money(b.purchasePrice, 50_000_000);
  const rentPcm = money(b.advertisedRent, 50_000);

  const bathroomCount = Number(b.bathrooms);
  const parking = typeof b.parking === 'string' && b.parking in PARKING ? b.parking : 'no_parking';

  return {
    ok: true,
    input: {
      property: {
        address: b.address.trim(),
        postcode: b.postcode.trim().toUpperCase(),
        bedrooms,
        guests,
      },
      email: typeof b.email === 'string' && b.email.includes('@') ? b.email.trim() : null,
      propertyType: b.propertyType ? PROPERTY_TYPE[b.propertyType as string] ?? 'flat' : 'flat',
      bathrooms: Number.isFinite(bathroomCount) && bathroomCount >= 1 ? bathroomCount : undefined,
      parkingSpaces: PARKING[parking] ?? 0,
      hasParking: parking !== 'no_parking' && parking !== 'on_street',
      outdoorSpace: typeof b.outdoorSpace === 'string' && b.outdoorSpace in OUTDOOR ? OUTDOOR[b.outdoorSpace] : 'none',
      askingPrice,
      rentPcm,
      sourceListing: sourceRef(b.sourceListing, askingPrice, rentPcm),
      checkedListingId:
        typeof b.checkedListingId === 'string' && /^[0-9a-f-]{36}$/i.test(b.checkedListingId) ? b.checkedListingId : null,
      fromDeal: b.fromDeal === true,
      enhancedRequested: b.enhanced === true,
    },
  };
}
