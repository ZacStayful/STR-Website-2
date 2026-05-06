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
} as const;

// Helper: returns true if the image manifest entry has a real file behind it.
export function hasImage(img: Img): boolean {
  return img.src.length > 0;
}
