/**
 * Canonical Market Explorer area metadata — the single place mapping a UK
 * postcode area ↔ a clean URL slug ↔ a human display name. Used for indexable
 * per-area pages (e.g. /markets/manchester → area "M").
 *
 * Areas returned by market-stats that aren't listed here still get a page via a
 * generated fallback (slug = lowercased code, name = "<CODE> postcode area").
 * Add entries here to give an area a proper city slug + name.
 */
export interface AreaMeta {
  code: string; // postcode area, uppercase (matches market-stats)
  slug: string; // URL slug
  name: string; // display name
}

export const AREA_META: AreaMeta[] = [
  // ── Areas with live data ──
  { code: 'BS', slug: 'bristol', name: 'Bristol' },
  { code: 'CT', slug: 'canterbury', name: 'Canterbury' },
  { code: 'DT', slug: 'dorchester', name: 'Dorchester' },
  { code: 'GL', slug: 'gloucester', name: 'Gloucester' },
  { code: 'HG', slug: 'harrogate', name: 'Harrogate' },
  { code: 'HU', slug: 'hull', name: 'Hull' },
  { code: 'LE', slug: 'leicester', name: 'Leicester' },
  { code: 'M', slug: 'manchester', name: 'Manchester' },
  { code: 'NE', slug: 'newcastle', name: 'Newcastle upon Tyne' },
  { code: 'NG', slug: 'nottingham', name: 'Nottingham' },
  { code: 'OX', slug: 'oxford', name: 'Oxford' },
  { code: 'SA', slug: 'swansea', name: 'Swansea' },
  { code: 'YO', slug: 'york', name: 'York' },
  // ── Other major cities (indexable if/when they cross min_samples) ──
  { code: 'B', slug: 'birmingham', name: 'Birmingham' },
  { code: 'L', slug: 'liverpool', name: 'Liverpool' },
  { code: 'LS', slug: 'leeds', name: 'Leeds' },
  { code: 'S', slug: 'sheffield', name: 'Sheffield' },
  { code: 'CF', slug: 'cardiff', name: 'Cardiff' },
  { code: 'EH', slug: 'edinburgh', name: 'Edinburgh' },
  { code: 'G', slug: 'glasgow', name: 'Glasgow' },
  { code: 'BN', slug: 'brighton', name: 'Brighton & Hove' },
  { code: 'BH', slug: 'bournemouth', name: 'Bournemouth' },
];

const BY_CODE = new Map(AREA_META.map((a) => [a.code, a]));
const BY_SLUG = new Map(AREA_META.map((a) => [a.slug, a]));

/** Meta for a postcode area, generating a fallback for unmapped codes. */
export function areaMetaForCode(code: string): AreaMeta {
  const key = code.trim().toUpperCase();
  return BY_CODE.get(key) ?? { code: key, slug: key.toLowerCase(), name: `${key} postcode area` };
}

/** Resolve a URL slug to a postcode area meta, or null if it maps to nothing. */
export function areaMetaForSlug(slug: string): AreaMeta | null {
  const key = slug.trim().toLowerCase();
  if (BY_SLUG.has(key)) return BY_SLUG.get(key)!;
  // Allow /markets/ng as an alias for a bare postcode area with no city entry.
  const asCode = key.toUpperCase();
  if (/^[a-z]{1,2}$/.test(key)) return { code: asCode, slug: key, name: `${asCode} postcode area` };
  return null;
}
