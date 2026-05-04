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
  heroProperty: placeholder(
    2400,
    1500,
    "Modern UK city apartment interior at golden hour, warm wood and sage palette, ready to be analysed by the Stayful software"
  ),
  comparablesMap: placeholder(
    1800,
    1200,
    "Stylised aerial map showing a central property pin surrounded by eight comparable nearby short-term rental listings"
  ),
  propertySplit: placeholder(
    2000,
    1200,
    "Victorian terraced UK house photographed from the front, used to compare long-let and short-let earning potential"
  ),
  atmosphereCottageDusk: placeholder(
    2880,
    1200,
    "UK countryside cottage at dusk with warm interior lights glowing through the windows"
  ),
  team: placeholder(
    1200,
    1500,
    "The Stayful team working in a converted warehouse office"
  ),
  property: {
    cityFlat: placeholder(1200, 1500, "Modern Manchester city flat interior with sage walls and warm wood"),
    terraced: placeholder(1200, 1500, "Yorkshire stone terraced house exterior in mid-afternoon light"),
    semi: placeholder(1200, 1500, "Suburban UK semi-detached home with mature garden"),
    cottage: placeholder(1200, 1500, "Cotswold stone cottage with climbing roses on a summer afternoon"),
    coastal: placeholder(1200, 1500, "Cornish coastal cottage with the sea visible in the distance"),
    period: placeholder(1200, 1500, "Edinburgh New Town period flat interior with original cornicing"),
  },
  managed: {
    one: placeholder(1200, 900, "Stayful-managed UK property interior, bright living room"),
    two: placeholder(1200, 900, "Stayful-managed UK property interior, modern kitchen"),
    three: placeholder(1200, 900, "Stayful-managed UK property interior, well-styled bedroom"),
    four: placeholder(1200, 900, "Stayful-managed UK property exterior at golden hour"),
    five: placeholder(1200, 900, "Stayful-managed UK property interior, dining area"),
    six: placeholder(1200, 900, "Stayful-managed UK property interior, comfortable lounge"),
  },
  details: {
    coffee: placeholder(1000, 1000, "A cup of coffee on a paint-bare windowsill in soft morning light"),
    keys: placeholder(1000, 1000, "Brass keys on a sage-painted counter"),
    plant: placeholder(1000, 1000, "A trailing plant on a wooden shelf with books behind"),
    stairwell: placeholder(1000, 1000, "Looking up a sage-painted spiral stairwell"),
    vinyl: placeholder(1000, 1000, "Vinyl records on a sideboard next to a record player"),
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
