/**
 * Why the quick view has no estimate, rung by rung, with the number of
 * reports or listings each rung needed against what it found. Pure, so the
 * wording is unit-tested and the same list appears on the analyser's source
 * card and the explorer's deal drawer.
 */
import type { EstimateSource } from './quick-types.ts';

export type NoEstimateStatus = 'short' | 'skipped' | 'unavailable';

export interface NoEstimateReason {
  source: EstimateSource;
  label: string;
  needed: number;
  found: number | null;
  status: NoEstimateStatus;
  detail: string;
}

export interface NoEstimate {
  reasons: NoEstimateReason[];
  summary: string;
  unlock: string;
}

export interface NoEstimateInput {
  postcode: string | null;
  outcode: string | null;
  bedrooms: number;
  areaName: string | null;
  /** Reports for this postcode and size in the last 90 days; null when the lookup was skipped. */
  postcodeSamples: number | null;
  /** Tracked same-size Airbnbs earning within 1 km, and the total tracked; null without coordinates or when skipped. */
  sameSizeEarning: number | null;
  nearbyTotal: number | null;
  /** True when the tracked-listing lookup ran out of time or budget. */
  nearbySkipped?: boolean;
  areaBedroomSamples: number;
  areaSamples: number;
  pmi: 'no-data' | 'skipped' | 'not-configured' | 'not-tried';
}

/** Minimum evidence each rung of the quick-view ladder needs. */
export const LADDER_MIN = { postcode: 1, competitors: 3, areaBedrooms: 1, area: 1 } as const;
/** Live comparables the full report targets (DataQuality.comparablesTarget). */
export const FULL_REPORT_COMPARABLES = 12;

const bed = (n: number) => `${n}-bed`;

export function explainNoEstimate(input: NoEstimateInput): NoEstimate {
  const area = input.areaName;
  const reasons: NoEstimateReason[] = [];

  if (!input.postcode) {
    reasons.push({ source: 'postcode-reports', label: 'Stayful reports for this postcode', needed: LADDER_MIN.postcode, found: null, status: 'unavailable', detail: 'The listing has no full postcode, so recent reports for it cannot be matched.' });
  } else if (input.postcodeSamples === null) {
    reasons.push({ source: 'postcode-reports', label: 'Stayful reports for this postcode', needed: LADDER_MIN.postcode, found: null, status: 'skipped', detail: `Need ${LADDER_MIN.postcode} Stayful report for ${input.postcode} with ${input.bedrooms} bedrooms in the last 90 days; the lookup was skipped this time.` });
  } else {
    reasons.push({ source: 'postcode-reports', label: 'Stayful reports for this postcode', needed: LADDER_MIN.postcode, found: input.postcodeSamples, status: 'short', detail: `Need ${LADDER_MIN.postcode} Stayful report for ${input.postcode} with ${input.bedrooms} bedrooms in the last 90 days; found ${input.postcodeSamples}.` });
  }

  if (input.nearbySkipped) {
    reasons.push({ source: 'competitors', label: 'Tracked Airbnbs within 1 km', needed: LADDER_MIN.competitors, found: null, status: 'skipped', detail: `Need ${LADDER_MIN.competitors} tracked ${bed(input.bedrooms)} Airbnbs earning within 1 km; the lookup was skipped this time.` });
  } else if (input.sameSizeEarning === null || input.nearbyTotal === null) {
    reasons.push({ source: 'competitors', label: 'Tracked Airbnbs within 1 km', needed: LADDER_MIN.competitors, found: null, status: 'unavailable', detail: 'The listing could not be placed on the map, so nearby tracked Airbnbs could not be searched.' });
  } else {
    reasons.push({ source: 'competitors', label: 'Tracked Airbnbs within 1 km', needed: LADDER_MIN.competitors, found: input.sameSizeEarning, status: 'short', detail: `Need ${LADDER_MIN.competitors} tracked ${bed(input.bedrooms)} Airbnbs earning within 1 km; found ${input.sameSizeEarning} of ${input.nearbyTotal} tracked.` });
  }

  if (!area) {
    reasons.push({ source: 'area-bedrooms', label: 'Area average for this size', needed: LADDER_MIN.areaBedrooms, found: null, status: 'unavailable', detail: 'No area data for this postcode yet: no Stayful report has been run in its postcode area.' });
    reasons.push({ source: 'area', label: 'Area average across all sizes', needed: LADDER_MIN.area, found: null, status: 'unavailable', detail: 'No area data for this postcode yet.' });
  } else {
    reasons.push({ source: 'area-bedrooms', label: 'Area average for this size', needed: LADDER_MIN.areaBedrooms, found: input.areaBedroomSamples, status: 'short', detail: `Need ${LADDER_MIN.areaBedrooms} report for a ${bed(input.bedrooms)} in ${area}; found ${input.areaBedroomSamples}.` });
    reasons.push({ source: 'area', label: 'Area average across all sizes', needed: LADDER_MIN.area, found: input.areaSamples, status: 'short', detail: `Need ${LADDER_MIN.area} report anywhere in ${area}; found ${input.areaSamples}.` });
  }

  const where = input.outcode ?? input.postcode ?? 'this postcode';
  const pmiDetail =
    input.pmi === 'no-data' ? `Property Market Intel has no area snapshot for ${where}.`
    : input.pmi === 'skipped' ? 'The Property Market Intel snapshot was skipped (time or spend limit).'
    : input.pmi === 'not-configured' ? 'The Property Market Intel snapshot is not configured.'
    : 'The Property Market Intel snapshot was not tried.';
  reasons.push({ source: 'pmi-market', label: 'Property Market Intel area snapshot', needed: 1, found: input.pmi === 'no-data' ? 0 : null, status: input.pmi === 'no-data' ? 'short' : input.pmi === 'skipped' ? 'skipped' : 'unavailable', detail: pmiDetail });

  const short = reasons.filter((r) => r.status === 'short');
  const summary = (short.length > 0 ? short.slice(0, 2) : reasons.slice(0, 2)).map((r) => r.detail).join(' ');
  const unlock = `Run the full report: it searches live comparables around the exact address (${FULL_REPORT_COMPARABLES} targeted, widening the radius until it finds them), so it always produces a figure.${area ? ` Every Stayful report run in ${area} also improves this quick view.` : ''}`;
  return { reasons, summary, unlock };
}
