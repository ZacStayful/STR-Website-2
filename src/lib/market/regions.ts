/**
 * UK regions for the Market Explorer's top level: every postcode area maps
 * to one geographic region (the twelve UK statistical regions, with Wales,
 * Scotland and Northern Ireland as their own). Border areas are placed by
 * their main town (SY → West Midlands, CH → North West, DA → South East,
 * WD → East of England); the licensing dataset's `straddle` flag still
 * notes where rules may differ inside an area.
 */

export interface RegionMeta {
  slug: string;
  name: string;
}

export const OTHER_REGION: RegionMeta = { slug: 'other', name: 'Other' };

export const REGIONS: RegionMeta[] = [
  { slug: 'north-east', name: 'North East' },
  { slug: 'north-west', name: 'North West' },
  { slug: 'yorkshire-humber', name: 'Yorkshire & the Humber' },
  { slug: 'east-midlands', name: 'East Midlands' },
  { slug: 'west-midlands', name: 'West Midlands' },
  { slug: 'east-of-england', name: 'East of England' },
  { slug: 'greater-london', name: 'Greater London' },
  { slug: 'south-east', name: 'South East' },
  { slug: 'south-west', name: 'South West' },
  { slug: 'wales', name: 'Wales' },
  { slug: 'scotland', name: 'Scotland' },
  { slug: 'northern-ireland', name: 'Northern Ireland' },
  OTHER_REGION,
];

const AREAS_BY_REGION: Record<string, string[]> = {
  scotland: ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'],
  'northern-ireland': ['BT'],
  wales: ['CF', 'LD', 'LL', 'NP', 'SA'],
  'north-east': ['DH', 'DL', 'NE', 'SR', 'TS'],
  'north-west': ['BB', 'BL', 'CA', 'CH', 'CW', 'FY', 'L', 'LA', 'M', 'OL', 'PR', 'SK', 'WA', 'WN'],
  'yorkshire-humber': ['BD', 'DN', 'HD', 'HG', 'HU', 'HX', 'LS', 'S', 'WF', 'YO'],
  'east-midlands': ['DE', 'LE', 'LN', 'NG', 'NN'],
  'west-midlands': ['B', 'CV', 'DY', 'HR', 'ST', 'SY', 'TF', 'WR', 'WS', 'WV'],
  'east-of-england': ['AL', 'CB', 'CM', 'CO', 'IP', 'LU', 'NR', 'PE', 'SG', 'SS', 'WD'],
  'greater-london': ['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC', 'BR', 'CR', 'EN', 'HA', 'IG', 'KT', 'RM', 'SM', 'TW', 'UB'],
  'south-east': ['BN', 'CT', 'DA', 'GU', 'HP', 'ME', 'MK', 'OX', 'PO', 'RG', 'RH', 'SL', 'SO', 'TN'],
  'south-west': ['BA', 'BH', 'BS', 'DT', 'EX', 'GL', 'PL', 'SN', 'SP', 'TA', 'TQ', 'TR'],
};

/** Postcode area code → region slug. */
export const AREA_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(AREAS_BY_REGION).flatMap(([slug, codes]) => codes.map((c) => [c, slug])),
);

const BY_SLUG = new Map(REGIONS.map((r) => [r.slug, r]));

export function regionForArea(code: string | null | undefined): RegionMeta {
  const slug = AREA_REGION[(code ?? '').trim().toUpperCase()];
  return (slug && BY_SLUG.get(slug)) || OTHER_REGION;
}

export function regionForSlug(slug: string | null | undefined): RegionMeta | null {
  return BY_SLUG.get((slug ?? '').trim().toLowerCase()) ?? null;
}

export function isRegionSlug(v: unknown): v is string {
  return typeof v === 'string' && BY_SLUG.has(v);
}
