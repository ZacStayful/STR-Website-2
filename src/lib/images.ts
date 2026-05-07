// Centralised image manifest.
// Every photograph used on the marketing site lives here.
// Swapping any image is a one-line edit in this file.

export type Img = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

const placeholder = (w: number, h: number, alt: string): Img => ({
  src: "",
  width: w,
  height: h,
  alt,
});

export const IMG = {
  heroProperty: {
    src: "/images/hero-property.jpg",
    width: 2400,
    height: 1500,
    alt: "Modern UK city apartment interior at golden hour, sage palette, with the Stayful analyser running over it",
  },
  comparablesMap: {
    src: "/images/comparables-map.png",
    width: 1800,
    height: 1200,
    alt: "Stylised aerial map showing a central property pin surrounded by eight comparable nearby short-term rental listings",
  },
  propertySplit: {
    src: "/images/property-split.jpg",
    width: 2000,
    height: 1200,
    alt: "Victorian terraced UK house photographed from the front, used to compare long-let and short-let earning potential",
  },
  atmosphereCottageDusk: {
    src: "/images/atmosphere-cottage-dusk.jpg",
    width: 2880,
    height: 1200,
    alt: "UK countryside cottage at dusk with warm interior lights glowing through the windows",
  },
  team: {
    src: "/images/team.jpg",
    width: 1200,
    height: 1500,
    alt: "The Stayful team working in a converted warehouse office",
  },
  property: {
    cityFlat: {
      src: "/images/property/01-city-flat.jpg",
      width: 1200,
      height: 1500,
      alt: "Modern Manchester city flat interior with sage walls and warm wood",
    },
    terraced: {
      src: "/images/property/02-terraced.jpg",
      width: 1200,
      height: 1500,
      alt: "Yorkshire stone terraced house exterior with a sage-painted door",
    },
    semi: {
      src: "/images/property/03-semi.jpg",
      width: 1200,
      height: 1500,
      alt: "Suburban UK semi-detached home with a mature garden in golden-hour light",
    },
    cottage: {
      src: "/images/property/04-country-cottage.jpg",
      width: 1200,
      height: 1500,
      alt: "Cotswold stone cottage with hydrangeas and climbing roses on a summer afternoon",
    },
    coastal: {
      src: "/images/property/05-coastal.jpg",
      width: 1200,
      height: 1500,
      alt: "Cornish coastal cottage with the sea visible in the distance",
    },
    period: {
      src: "/images/property/06-period.jpg",
      width: 1200,
      height: 1500,
      alt: "Edinburgh New Town period flat interior with original cornicing and tall sash windows",
    },
  },
  managed: {
    one: {
      src: "/images/managed/01.jpg",
      width: 1200,
      height: 900,
      alt: "Stayful-managed UK property interior, bright living room with sage tones",
    },
    two: placeholder(1200, 900, "Stayful-managed UK property interior, modern kitchen"),
    three: placeholder(1200, 900, "Stayful-managed UK property interior, well-styled bedroom"),
    four: placeholder(1200, 900, "Stayful-managed UK property exterior at golden hour"),
    five: placeholder(1200, 900, "Stayful-managed UK property interior, dining area"),
    six: placeholder(1200, 900, "Stayful-managed UK property interior, comfortable lounge"),
  },
  details: {
    coffee: {
      src: "/images/details/01-coffee-windowsill.jpg",
      width: 1000,
      height: 1000,
      alt: "A cup of coffee on a paint-bare windowsill in soft morning light",
    },
    keys: {
      src: "/images/details/02-keys-on-counter.jpg",
      width: 1000,
      height: 1000,
      alt: "Brass keys on a sage-painted counter",
    },
    plant: {
      src: "/images/details/03-plant-shelf.jpg",
      width: 1000,
      height: 1000,
      alt: "A trailing plant on a wooden shelf with books behind",
    },
    stairwell: {
      src: "/images/details/04-stairwell.jpg",
      width: 1000,
      height: 1000,
      alt: "Looking up a sage-painted spiral stairwell",
    },
    vinyl: {
      src: "/images/details/05-vinyl-records.jpg",
      width: 1000,
      height: 1000,
      alt: "Vinyl records on a sideboard next to a record player",
    },
    aga: placeholder(1000, 1000, "Cream Aga in a country kitchen with ceramic dishes and natural light"),
  },
  demand: {
    university: placeholder(400, 400, "UK university quad"),
    hospital: placeholder(400, 400, "Modern UK hospital exterior"),
    station: placeholder(400, 400, "Manchester Piccadilly station platform"),
    venue: placeholder(400, 400, "Concert hall facade"),
    airport: placeholder(400, 400, "UK airport apron"),
  },
  // Real screenshots of the live Stayful analyser (extracted from the
  // 2026-05-06 product walkthrough). Each is a 1630x856 JPG.
  software: {
    input: {
      src: "/images/software/01-input.jpg",
      width: 1630,
      height: 856,
      alt: "Address entry form in the Stayful property analyser, showing fields for postcode, property type, bedrooms, bathrooms, parking, outdoor space",
    },
    analysing: {
      src: "/images/software/02-analysing.jpg",
      width: 1630,
      height: 856,
      alt: "Loading screen showing the analyser running through Locating property, Fetching short-let data, Long-let valuation, Nearby amenities, Local events, Running analysis",
    },
    headline: {
      src: "/images/software/03-headline.jpg",
      width: 1630,
      height: 856,
      alt: "Sample analysis report header for 17 Park Crescent, York, showing top market potential, net revenue, ADR, occupancy and property value range",
    },
    profitCalc: {
      src: "/images/software/04-profit-calc.jpg",
      width: 1630,
      height: 856,
      alt: "Profit calculator panel with editable booking platform fees, management fees, cleaning, mortgage, bills, and a calculated true profit figure per month and year",
    },
    setupCost: {
      src: "/images/software/05-setup-cost.jpg",
      width: 1630,
      height: 856,
      alt: "Itemised setup cost panel listing dining table, side tables, soft furnishings, paint, TV, kitchen pack and other furnishing items with editable quantities and a running total",
    },
    comparables: {
      src: "/images/software/06-comparables.jpg",
      width: 1630,
      height: 856,
      alt: "Grid of comparable nearby short-term rental listings with photos, nightly rates, occupancy, annual revenue, review counts and exclude-from-estimate buttons",
    },
    amenities: {
      src: "/images/software/07-amenities.jpg",
      width: 1630,
      height: 856,
      alt: "Advised amenities recommendations including Essential Amenities (WiFi, Kitchen) marked Must Have, with target panels for matching versus beating the market",
    },
    forecast: {
      src: "/images/software/08-forecast.jpg",
      width: 1630,
      height: 856,
      alt: "12-month forecast line chart comparing short-let projections against long-let income across all 12 months, with peak month, worst month, and below-long-let month counts",
    },
    demandDrivers: {
      src: "/images/software/09-demand-drivers.jpg",
      width: 1630,
      height: 856,
      alt: "Local Area Intelligence panel showing why people would book this property, with cards for healthcare, educational, construction and events demand drivers nearby",
    },
  },
  clips: {
    inputToResult: {
      src: "/images/software/clip-01-input-to-result.mp4",
      poster: "/images/software/03-headline.jpg",
      label: "From address to full report — 30 seconds",
    },
    profitSetup: {
      src: "/images/software/clip-02-profit-setup.mp4",
      poster: "/images/software/04-profit-calc.jpg",
      label: "Editing profit and setup-cost assumptions",
    },
    forecast: {
      src: "/images/software/clip-03-forecast.mp4",
      poster: "/images/software/08-forecast.jpg",
      label: "12-month forecast and demand-driver reveal",
    },
  },
} as const;

// Helper: returns true if the image manifest entry has a real file behind it.
export function hasImage(img: Img): boolean {
  return img.src.length > 0;
}
