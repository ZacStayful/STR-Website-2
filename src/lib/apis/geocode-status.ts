/**
 * Which Google Geocoding outcomes are the member's postcode, and which are
 * ours. Pure, so the split is tested; src/lib/apis/geocode.ts throws
 * GeocodePostcodeError for the first kind and a plain Error for the rest,
 * and src/lib/analysis/run.ts tells the member to check their postcode only
 * for the first.
 */

/** Google looked and found nothing for what was typed. */
const POSTCODE_FAULTS = new Set(['ZERO_RESULTS', 'INVALID_REQUEST']);

export function isPostcodeFault(status: string | null | undefined, resultCount = 0): boolean {
  if (!status) return false;
  if (POSTCODE_FAULTS.has(status)) return true;
  // "OK" with an empty results list: nothing matched either.
  return status === 'OK' && resultCount === 0;
}
