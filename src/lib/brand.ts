export const BRAND = {
  name: "Stayful Intelligence",
  legalName: "Stayful Limited",
  tagline: "The decision engine for short-term rental",
  managementUrl: "https://stayful.co.uk",
  contactEmail: "hello@stayful.co.uk",
  /** The address printed on the property report and its call to action. */
  reportEmail: "info@stayful.co.uk",
  /**
   * Where the report's "book your call" button and QR code point. It was
   * hardcoded in five places, in two different forms; this is the one that
   * belongs on a report.
   */
  bookingUrl: "https://calendly.com/zac-stayful/call",
} as const;

export const TRUST = {
  propertiesManaged: "70+",
  revenueEarned: "£3M+",
  googleRating: "4.97",
  googleRatingNumeric: 4.97,
  // Google requires ratingCount or reviewCount alongside a ratingValue, and
  // drops the whole aggregateRating without one. Set this to the real number
  // of reviews behind the 4.97 and organizationSchema() will start emitting
  // the rating; left undefined, it omits it rather than guessing.
  googleReviewCount: undefined as number | undefined,
  caption: "Built by the team behind 70+ managed UK short-term lets.",
} as const;
