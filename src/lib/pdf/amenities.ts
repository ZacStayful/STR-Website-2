/**
 * Amenity recommendations, derived from the comparable set rather than asserted.
 *
 * Airbtics returns a per-listing amenity map. The share of nearby listings
 * carrying an amenity is exactly the thing worth telling an owner: an amenity
 * everybody already has is table stakes, one almost nobody has is a chance to
 * stand out. So penetration drives both the score and the grouping.
 *
 * Reports analysed before the amenity map was captured have nothing to work
 * with. `scoreAmenities` returns null for those and the caller falls back, so
 * an old saved report still renders.
 */

import { median } from "./design/charts/geometry.ts";

export interface AmenityStat {
  name: string;
  /** 1–5, derived from penetration. */
  score: number;
  /** 0–1 share of the comparable set carrying it. */
  penetration: number;
  /**
   * How much more per night listings with this amenity charge, as a
   * percentage. Null when too few comparables sit either side to mean
   * anything.
   */
  premiumPct: number | null;
}

export interface AmenityBreakdown {
  /** Everyone has these. Missing one is a problem. */
  essential: AmenityStat[];
  /** Common enough to matter, rare enough to be worth having. */
  edge: AmenityStat[];
  /** Rare. The things that let a listing charge more. */
  differentiators: AmenityStat[];
}

export interface AmenityComp {
  amenities?: Record<string, boolean> | null;
  nightly: number;
}

/**
 * The amenities worth reporting on, with the spellings Airbtics has been seen
 * to use. The API is inconsistent — `getShortLetData` already has to handle
 * four spellings of "parking" — so keys are matched on a normalised form and
 * anything unrecognised is ignored rather than printed raw at a customer.
 */
const CATALOGUE: Array<{ name: string; match: string[] }> = [
  { name: "WiFi", match: ["wifi", "internet", "wirelessinternet", "pocketwifi"] },
  { name: "Kitchen", match: ["kitchen", "fullkitchen", "kitchenette"] },
  { name: "Heating", match: ["heating", "centralheating", "indoorfireplace"] },
  { name: "Washer", match: ["washer", "washingmachine"] },
  { name: "Dryer", match: ["dryer", "tumbledryer"] },
  { name: "Smart TV", match: ["tv", "smarttv", "cabletv", "hdtv", "television"] },
  { name: "Workspace", match: ["workspace", "laptopfriendlyworkspace", "dedicatedworkspace", "desk"] },
  { name: "Free parking", match: ["parking", "freeparking", "freeparkingonpremises", "freeparkingonstreet", "parkingonpremises"] },
  { name: "Garden", match: ["garden", "backyard", "patioorbalcony", "patio", "balcony", "outdoorspace"] },
  { name: "Air conditioning", match: ["airconditioning", "ac", "aircon"] },
  { name: "Self check-in", match: ["selfcheckin", "keypad", "lockbox", "smartlock"] },
  { name: "Pet friendly", match: ["petsallowed", "petfriendly", "petsallowedfree"] },
  { name: "Hot tub", match: ["hottub", "jacuzzi", "jacuzzibathtub"] },
  { name: "Pool", match: ["pool", "swimmingpool", "privatepool", "sharedpool"] },
  { name: "EV charger", match: ["evcharger", "electricvehiclecharger", "evchargingstation"] },
  { name: "Gym", match: ["gym", "exerciseequipment", "fitnesscentre", "fitnesscenter"] },
];

/** Strips case, spaces and punctuation so `Free parking on premises` matches. */
const normalise = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const LOOKUP = new Map<string, string>();
for (const entry of CATALOGUE) {
  for (const alias of entry.match) LOOKUP.set(alias, entry.name);
}

/** The display names a single listing's amenity map resolves to. */
export function canonicalAmenities(
  raw: Record<string, boolean> | null | undefined,
): Set<string> {
  const found = new Set<string>();
  if (!raw) return found;
  for (const [key, present] of Object.entries(raw)) {
    if (!present) continue;
    const name = LOOKUP.get(normalise(key));
    if (name) found.add(name);
  }
  return found;
}

/** Penetration ≥ this share counts as table stakes. */
const ESSENTIAL_AT = 0.8;
/** Below this share an amenity is a differentiator rather than an expectation. */
const EDGE_AT = 0.2;
/** Comparables needed either side of a split before a price premium means anything. */
const MIN_PER_SIDE = 3;

/** How many of each band the page has room for. */
const LIMITS = { essential: 3, edge: 4, differentiators: 5 } as const;

export function scoreAmenities(comps: AmenityComp[]): AmenityBreakdown | null {
  const withData = comps.filter(
    (c) => c.amenities && Object.keys(c.amenities).length > 0,
  );
  // One listing's amenities is an anecdote, not a market.
  if (withData.length < 3) return null;

  const resolved = withData.map((c) => ({
    has: canonicalAmenities(c.amenities),
    nightly: c.nightly,
  }));

  const stats: AmenityStat[] = [];
  for (const { name } of CATALOGUE) {
    const yes = resolved.filter((r) => r.has.has(name));
    const no = resolved.filter((r) => !r.has.has(name));
    // An amenity nothing in the set reports is more likely absent from the
    // feed than absent from the market, so it is left out entirely.
    if (yes.length === 0) continue;

    const penetration = yes.length / resolved.length;

    let premiumPct: number | null = null;
    if (yes.length >= MIN_PER_SIDE && no.length >= MIN_PER_SIDE) {
      const withMed = median(yes.map((r) => r.nightly));
      const withoutMed = median(no.map((r) => r.nightly));
      if (withMed !== null && withoutMed !== null && withoutMed > 0) {
        premiumPct = Math.round((withMed / withoutMed - 1) * 100);
      }
    }

    stats.push({
      name,
      score: Math.min(5, Math.max(1, Math.round(penetration * 5))),
      penetration,
      premiumPct,
    });
  }

  if (stats.length === 0) return null;

  const byPenetrationDesc = (a: AmenityStat, b: AmenityStat) =>
    b.penetration - a.penetration;

  return {
    essential: stats
      .filter((s) => s.penetration >= ESSENTIAL_AT)
      .sort(byPenetrationDesc)
      .slice(0, LIMITS.essential),
    edge: stats
      .filter((s) => s.penetration < ESSENTIAL_AT && s.penetration >= EDGE_AT)
      .sort(byPenetrationDesc)
      .slice(0, LIMITS.edge),
    differentiators: stats
      .filter((s) => s.penetration < EDGE_AT)
      // Rarest first: the biggest opportunities to stand out.
      .sort((a, b) => a.penetration - b.penetration)
      .slice(0, LIMITS.differentiators),
  };
}

/**
 * The headline on the differentiators box: the observed nightly-rate premium
 * across those amenities, or null when the sample was too thin to say.
 */
export function differentiatorPremium(
  differentiators: AmenityStat[],
): { low: number; high: number } | null {
  const pcts = differentiators
    .map((d) => d.premiumPct)
    .filter((p): p is number => p !== null && p > 0);
  if (pcts.length === 0) return null;
  return { low: Math.min(...pcts), high: Math.max(...pcts) };
}
