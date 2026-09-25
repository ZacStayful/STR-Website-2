/**
 * A normalised snapshot of a third-party property listing (Rightmove,
 * OnTheMarket, Zoopla, Airbnb, Booking.com). Parsers produce this from the
 * page's embedded JSON; everything downstream (analyser prefill, quick view,
 * deal maths, the explorer's listing tab) works from it and never from HTML.
 *
 * Only typed fields are stored. Descriptions, agent/host details and photo
 * copies are deliberately NOT kept — photos are referenced by URL only. The
 * one concession is `agentHash`: a keyed one-way digest that answers "is this
 * a different agent than last time" without keeping who the agent is.
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
  /** The page flags the sale as shared ownership (Rightmove) or the text says so. */
  sharedOwnership?: boolean;
  /**
   * What the description says about short-term letting: `true` permitted,
   * `false` prohibited, `null` silent. The description itself is not kept.
   */
  shortLetsPermitted?: boolean | null;
  features: string[];
  photos: string[];

  /**
   * When the portal says the listing first appeared, as an ISO date. This is
   * the portal's own clock, not ours — the only trustworthy basis for days on
   * market, since our own first sighting can be months late.
   */
  listedDate?: string;
  /** The portal's last listing event: what changed and when. */
  listingUpdate?: { reason: 'added' | 'reduced' | 'increased'; on: string | null };
  /** Keyed digest of the marketing agent's name. Never the name itself. */
  agentHash?: string | null;
  /** Years left on the lease, when the portal states it. Under ~80 is unmortgageable. */
  yearsRemainingOnLease?: number;
  /** Rentals: when the property is free, as an ISO date. Already past means a live void. */
  letAvailableDate?: string;
  /** Rentals: the shortest tenancy the landlord will take, in months. */
  minimumTermInMonths?: number;

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
