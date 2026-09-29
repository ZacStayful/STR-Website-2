/**
 * PropertyData's answers in the costing engine's terms (Batch 17): the sold
 * prices a Project deal's value ceiling rests on (value.ts), and the listed-
 * building and conservation-area checks that rule a candidate out (Q9).
 *
 *   Home type     PropertyData filter        Ceiling compared on
 *   flat          flat                       flat
 *   terraced      terraced_house             terraced
 *   semi          semi-detached_house        semi
 *   detached      detached_house             detached
 *   bungalow      detached_house             detached (Land Registry has no
 *                                            bungalow type: an assumption)
 *
 * Pure: no network, no database, no server-only.
 */
import { flagPossiblyListed, type Designation, type ListedBuilding, type PdSoldSale, type PdSoldType } from '../apis/propertydata-parse.ts';
import type { ExclusionReason } from './exclusions.ts';
import { homeTypeOf, type HomeType, type SoldSale } from './value.ts';

/** The type a subject's sales are asked for and compared on (a bungalow on detached sales). */
export function ceilingTypeFor(t: HomeType | null): HomeType | null {
  return t === 'bungalow' ? 'detached' : t;
}

/** PropertyData's `type` filter for a subject; null: no filter. */
export function pdSoldTypeFor(t: HomeType | null): PdSoldType | null {
  switch (ceilingTypeFor(t)) {
    case 'flat':
      return 'flat';
    case 'terraced':
      return 'terraced_house';
    case 'semi':
      return 'semi-detached_house';
    case 'detached':
      return 'detached_house';
    default:
      return null;
  }
}

/** Land Registry's one-letter types, as PropertyData can pass them through. */
const LETTER: Record<string, HomeType> = { F: 'flat', T: 'terraced', S: 'semi', D: 'detached' };

/** The sales the ceiling can use: a distance known, the type read; a bungalow's own type never appears. */
export function soldSalesFrom(sales: readonly PdSoldSale[]): SoldSale[] {
  const out: SoldSale[] = [];
  for (const s of sales) {
    if (s.distanceMiles === null || !Number.isFinite(s.distanceMiles)) continue;
    const raw = (s.type ?? '').trim();
    const homeType = LETTER[raw.toUpperCase()] ?? homeTypeOf(raw.replace(/_/g, ' '));
    out.push({ price: s.price, soldOn: s.date, distanceMiles: s.distanceMiles, homeType: homeType === 'bungalow' ? 'detached' : homeType, bedrooms: s.bedrooms });
  }
  return out;
}

/**
 * PropertyData's listed-building and conservation-area answers as an
 * exclusion (Q9): a listed building within a few yards of the postcode's
 * point (flagPossiblyListed), or inside a conservation area. Unknown (a
 * failed call) is never an exclusion.
 */
export function designationExclusion(listed: readonly ListedBuilding[] | null, conservation: Designation | null): ExclusionReason | null {
  if (listed && flagPossiblyListed(listed)) return 'listed';
  if (conservation?.inside === true) return 'conservation';
  return null;
}
