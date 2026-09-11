/**
 * A normalised snapshot of a third-party property listing (Rightmove,
 * OnTheMarket, Zoopla, Airbnb, Booking.com). Parsers produce this from the
 * page's embedded JSON; everything downstream (analyser prefill, quick view,
 * deal maths, the explorer's listing tab) works from it and never from HTML.
 *
 * Only typed fields are stored. Descriptions, agent/host details and photo
 * copies are deliberately NOT kept — photos are referenced by URL only.
 */

export type ListingSource = 'rightmove' | 'onthemarket' | 'zoopla' | 'airbnb' | 'booking';

/** sale / rent = property portals; str = an existing short-let listing. */
export type ListingKind = 'sale' | 'rent' | 'str';

export type ListingStatus = 'available' | 'under_offer' | 'let_agreed' | 'sold' | 'removed';

export type PricePeriod = 'total' | 'pcm' | 'pw' | 'night';

/** How sure we are about where the property is. */
export type LocationConfidence = 'exact' | 'outcode' | 'reverse-geocoded' | 'none';

/** The analyser's own property-type vocabulary (form values). */
export type AnalyserPropertyType = 'Flat' | 'Terraced' | 'Semi-detached' | 'Detached';

export interface ListingPrice {
  amount: number;
  period: PricePeriod;
  /** Qualifier as shown by the site, e.g. "Guide price", "Offers over". */
  qualifier?: string;
}

export interface ListingSnapshot {
  source: ListingSource;
  id: string;
  canonicalUrl: string;
  fetchedAt: string;
  parserVersion: number;
  kind: ListingKind;

  title: string;
  displayAddress?: string;
  postcode?: string; // full, spaced, uppercase ("M4 5AE")
  outcode?: string; // "M4"
  lat?: number;
  lng?: number;

  bedrooms?: number;
  bathrooms?: number;
  guests?: number;
  /** The site's own wording ("Apartment", "Semi-Detached", "Entire home"). */
  rawType?: string;
  propertyType?: AnalyserPropertyType;

  price?: ListingPrice;
  status?: ListingStatus;
  tenure?: string;
  councilTaxBand?: string;
  features: string[];
  photos: string[];

  /** Short-let specific (Airbnb / Booking.com). */
  str?: {
    rating?: number; // 0–5
    reviewCount?: number;
    roomType?: string;
    isSuperhost?: boolean;
    localizedLocation?: string;
  };

  locationConfidence: LocationConfidence;
}

export interface DetectedListing {
  source: ListingSource;
  id: string;
  canonicalUrl: string;
}
