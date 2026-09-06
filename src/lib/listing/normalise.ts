import type { AnalyserPropertyType, ListingSnapshot } from './types.ts';

/**
 * Turns a listing snapshot into the analyser's form values. Pure: the
 * reverse-geocode step (for Airbnb listings that only carry coordinates)
 * happens in the resolve route before this is called, so by the time we get
 * here a postcode is either present or genuinely unknown.
 */

export type ParkingOption = 'no_parking' | 'on_street' | 'allocated' | 'garage' | 'driveway_1' | 'driveway_2';
export type OutdoorOption = 'none' | 'balcony' | 'garden' | 'roof_terrace';

export interface AnalyserPrefill {
  address: string;
  postcode: string; // may be '' when unknown
  bedrooms: number;
  guests: number;
  bathrooms: number;
  propertyType: AnalyserPropertyType;
  parking: ParkingOption;
  outdoorSpace: OutdoorOption;
  /** Asking price for sale listings, pounds. */
  purchasePrice?: number;
  /** Advertised rent for lettings, pounds per calendar month. */
  advertisedRent?: number;
}

export interface NormaliseResult {
  prefill: AnalyserPrefill;
  warnings: string[];
}

export function defaultGuests(bedrooms: number): number {
  return Math.max(1, Math.min(16, bedrooms * 2 + 2));
}

const TYPE_RULES: [RegExp, AnalyserPropertyType][] = [
  [/flat|apartment|maisonette|penthouse|studio|duplex|entire (?:rental )?unit|condo|loft|serviced/i, 'Flat'],
  [/semi/i, 'Semi-detached'],
  [/terrace|town ?house|end of terrace|mews|link/i, 'Terraced'],
  [/detached|bungalow|cottage|house|villa|barn|farm|lodge|chalet|cabin|entire home|home/i, 'Detached'],
];

export function mapPropertyType(raw: string | undefined | null, bedrooms?: number): AnalyserPropertyType {
  if (raw) {
    for (const [re, type] of TYPE_RULES) if (re.test(raw)) return type;
  }
  // Unknown wording: flats dominate 1–2 bed stock, houses 3+.
  return (bedrooms ?? 2) >= 3 ? 'Terraced' : 'Flat';
}

export function parkingFromFeatures(features: string[]): ParkingOption {
  const text = features.join(' | ').toLowerCase();
  if (/no parking|permit only/.test(text)) return 'no_parking';
  if (/garage/.test(text)) return 'garage';
  if (/double driveway|driveway for (?:two|2)|2 (?:car )?driveway|off[- ]road parking for (?:two|2)|two parking|2 parking/.test(text)) return 'driveway_2';
  if (/driveway|off[- ]street|off[- ]road/.test(text)) return 'driveway_1';
  if (/allocated|designated|residents? parking|secure parking|underground parking|parking space|car ?park|parking/.test(text)) return 'allocated';
  if (/on[- ]street/.test(text)) return 'on_street';
  return 'no_parking';
}

export function outdoorFromFeatures(features: string[]): OutdoorOption {
  const text = features.join(' | ').toLowerCase();
  if (/roof terrace|rooftop/.test(text)) return 'roof_terrace';
  if (/garden|lawn|yard|patio|outdoor space/.test(text)) return 'garden';
  if (/balcony|terrace|juliet/.test(text)) return 'balcony';
  return 'none';
}

/** Weekly rent → monthly (52 weeks / 12 months). */
export function pcmFromPrice(price: ListingSnapshot['price']): number | null {
  if (!price) return null;
  if (price.period === 'pcm') return Math.round(price.amount);
  if (price.period === 'pw') return Math.round((price.amount * 52) / 12);
  return null;
}

export function snapshotToPrefill(snap: ListingSnapshot): NormaliseResult {
  const warnings: string[] = [];
  const bedrooms = snap.bedrooms ?? 2;
  if (snap.bedrooms === undefined) warnings.push('Bedrooms were not on the listing; defaulted to 2.');
  const bathrooms = snap.bathrooms && snap.bathrooms >= 1 ? Math.round(snap.bathrooms) : 1;
  const guests = snap.guests && snap.guests >= 1 ? Math.min(16, Math.round(snap.guests)) : defaultGuests(bedrooms);

  let address = snap.displayAddress ?? snap.title;
  if (snap.source === 'airbnb' || snap.source === 'booking') {
    address = snap.title + (snap.displayAddress ? `, ${snap.displayAddress}` : '');
  }
  if (!snap.postcode) {
    warnings.push(
      snap.outcode
        ? `Only the outcode (${snap.outcode}) is on the listing; add the full postcode for a closer estimate.`
        : 'No postcode on the listing; add one before running a full analysis.',
    );
  }
  if (snap.locationConfidence === 'reverse-geocoded') {
    warnings.push('Location is approximate (the site only shows a rough pin), so the postcode may be a neighbouring one.');
  }

  const prefill: AnalyserPrefill = {
    address,
    postcode: snap.postcode ?? '',
    bedrooms: Math.max(0, Math.min(10, Math.round(bedrooms))),
    guests,
    bathrooms: Math.max(1, Math.min(5, bathrooms)),
    propertyType: mapPropertyType(snap.rawType, bedrooms),
    parking: parkingFromFeatures(snap.features),
    outdoorSpace: outdoorFromFeatures(snap.features),
  };

  if (snap.kind === 'sale' && snap.price?.period === 'total') prefill.purchasePrice = Math.round(snap.price.amount);
  if (snap.kind === 'rent') {
    const pcm = pcmFromPrice(snap.price);
    if (pcm) prefill.advertisedRent = pcm;
    else warnings.push('Could not read the advertised rent; enter it to see rent-to-rent figures.');
    if (snap.features.some((f) => /student/i.test(f))) warnings.push('Advertised as a student let; the rent may be per person per week.');
  }
  return { prefill, warnings };
}
