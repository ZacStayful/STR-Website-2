/**
 * Canonical Market Explorer area metadata — the single place mapping a UK
 * postcode area ↔ a clean URL slug ↔ a human display name. Used for indexable
 * per-area pages (e.g. /markets/manchester → area "M").
 *
 * Every one of the 124 postcode areas is listed, named after its Royal Mail
 * post town (or, for the London areas, its compass quarter), so a market is
 * always titled as a place ("Bradford", never "BD postcode area"). The code
 * lives in the subtitle; see `labels.ts`. The fallback below only fires for a
 * code that is not a real postcode area.
 */
export interface AreaMeta {
  code: string; // postcode area, uppercase (matches market-stats)
  slug: string; // URL slug
  name: string; // display name
}

export const AREA_META: AreaMeta[] = [
  // ── Scotland ──
  { code: 'AB', slug: 'aberdeen', name: 'Aberdeen' },
  { code: 'DD', slug: 'dundee', name: 'Dundee' },
  { code: 'DG', slug: 'dumfries', name: 'Dumfries' },
  { code: 'EH', slug: 'edinburgh', name: 'Edinburgh' },
  { code: 'FK', slug: 'falkirk', name: 'Falkirk' },
  { code: 'G', slug: 'glasgow', name: 'Glasgow' },
  { code: 'HS', slug: 'outer-hebrides', name: 'Outer Hebrides' },
  { code: 'IV', slug: 'inverness', name: 'Inverness' },
  { code: 'KA', slug: 'kilmarnock', name: 'Kilmarnock' },
  { code: 'KW', slug: 'kirkwall', name: 'Kirkwall' },
  { code: 'KY', slug: 'kirkcaldy', name: 'Kirkcaldy' },
  { code: 'ML', slug: 'motherwell', name: 'Motherwell' },
  { code: 'PA', slug: 'paisley', name: 'Paisley' },
  { code: 'PH', slug: 'perth', name: 'Perth' },
  { code: 'TD', slug: 'galashiels', name: 'Galashiels' },
  { code: 'ZE', slug: 'shetland', name: 'Shetland' },
  // ── Northern Ireland ──
  { code: 'BT', slug: 'belfast', name: 'Belfast' },
  // ── Wales ──
  { code: 'CF', slug: 'cardiff', name: 'Cardiff' },
  { code: 'LD', slug: 'llandrindod-wells', name: 'Llandrindod Wells' },
  { code: 'LL', slug: 'llandudno', name: 'Llandudno' },
  { code: 'NP', slug: 'newport', name: 'Newport' },
  { code: 'SA', slug: 'swansea', name: 'Swansea' },
  // ── North East ──
  { code: 'DH', slug: 'durham', name: 'Durham' },
  { code: 'DL', slug: 'darlington', name: 'Darlington' },
  { code: 'NE', slug: 'newcastle', name: 'Newcastle upon Tyne' },
  { code: 'SR', slug: 'sunderland', name: 'Sunderland' },
  { code: 'TS', slug: 'middlesbrough', name: 'Middlesbrough' },
  // ── North West ──
  { code: 'BB', slug: 'blackburn', name: 'Blackburn' },
  { code: 'BL', slug: 'bolton', name: 'Bolton' },
  { code: 'CA', slug: 'carlisle', name: 'Carlisle' },
  { code: 'CH', slug: 'chester', name: 'Chester' },
  { code: 'CW', slug: 'crewe', name: 'Crewe' },
  { code: 'FY', slug: 'blackpool', name: 'Blackpool' },
  { code: 'L', slug: 'liverpool', name: 'Liverpool' },
  { code: 'LA', slug: 'lancaster', name: 'Lancaster' },
  { code: 'M', slug: 'manchester', name: 'Manchester' },
  { code: 'OL', slug: 'oldham', name: 'Oldham' },
  { code: 'PR', slug: 'preston', name: 'Preston' },
  { code: 'SK', slug: 'stockport', name: 'Stockport' },
  { code: 'WA', slug: 'warrington', name: 'Warrington' },
  { code: 'WN', slug: 'wigan', name: 'Wigan' },
  // ── Yorkshire & the Humber ──
  { code: 'BD', slug: 'bradford', name: 'Bradford' },
  { code: 'DN', slug: 'doncaster', name: 'Doncaster' },
  { code: 'HD', slug: 'huddersfield', name: 'Huddersfield' },
  { code: 'HG', slug: 'harrogate', name: 'Harrogate' },
  { code: 'HU', slug: 'hull', name: 'Hull' },
  { code: 'HX', slug: 'halifax', name: 'Halifax' },
  { code: 'LS', slug: 'leeds', name: 'Leeds' },
  { code: 'S', slug: 'sheffield', name: 'Sheffield' },
  { code: 'WF', slug: 'wakefield', name: 'Wakefield' },
  { code: 'YO', slug: 'york', name: 'York' },
  // ── East Midlands ──
  { code: 'DE', slug: 'derby', name: 'Derby' },
  { code: 'LE', slug: 'leicester', name: 'Leicester' },
  { code: 'LN', slug: 'lincoln', name: 'Lincoln' },
  { code: 'NG', slug: 'nottingham', name: 'Nottingham' },
  { code: 'NN', slug: 'northampton', name: 'Northampton' },
  // ── West Midlands ──
  { code: 'B', slug: 'birmingham', name: 'Birmingham' },
  { code: 'CV', slug: 'coventry', name: 'Coventry' },
  { code: 'DY', slug: 'dudley', name: 'Dudley' },
  { code: 'HR', slug: 'hereford', name: 'Hereford' },
  { code: 'ST', slug: 'stoke-on-trent', name: 'Stoke-on-Trent' },
  { code: 'SY', slug: 'shrewsbury', name: 'Shrewsbury' },
  { code: 'TF', slug: 'telford', name: 'Telford' },
  { code: 'WR', slug: 'worcester', name: 'Worcester' },
  { code: 'WS', slug: 'walsall', name: 'Walsall' },
  { code: 'WV', slug: 'wolverhampton', name: 'Wolverhampton' },
  // ── East of England ──
  { code: 'AL', slug: 'st-albans', name: 'St Albans' },
  { code: 'CB', slug: 'cambridge', name: 'Cambridge' },
  { code: 'CM', slug: 'chelmsford', name: 'Chelmsford' },
  { code: 'CO', slug: 'colchester', name: 'Colchester' },
  { code: 'IP', slug: 'ipswich', name: 'Ipswich' },
  { code: 'LU', slug: 'luton', name: 'Luton' },
  { code: 'NR', slug: 'norwich', name: 'Norwich' },
  { code: 'PE', slug: 'peterborough', name: 'Peterborough' },
  { code: 'SG', slug: 'stevenage', name: 'Stevenage' },
  { code: 'SS', slug: 'southend-on-sea', name: 'Southend-on-Sea' },
  { code: 'WD', slug: 'watford', name: 'Watford' },
  // ── Greater London ──
  { code: 'E', slug: 'east-london', name: 'East London' },
  { code: 'EC', slug: 'city-of-london', name: 'City of London' },
  { code: 'N', slug: 'north-london', name: 'North London' },
  { code: 'NW', slug: 'north-west-london', name: 'North West London' },
  { code: 'SE', slug: 'south-east-london', name: 'South East London' },
  { code: 'SW', slug: 'south-west-london', name: 'South West London' },
  { code: 'W', slug: 'west-london', name: 'West London' },
  { code: 'WC', slug: 'central-london', name: 'Central London' },
  { code: 'BR', slug: 'bromley', name: 'Bromley' },
  { code: 'CR', slug: 'croydon', name: 'Croydon' },
  { code: 'EN', slug: 'enfield', name: 'Enfield' },
  { code: 'HA', slug: 'harrow', name: 'Harrow' },
  { code: 'IG', slug: 'ilford', name: 'Ilford' },
  { code: 'KT', slug: 'kingston-upon-thames', name: 'Kingston upon Thames' },
  { code: 'RM', slug: 'romford', name: 'Romford' },
  { code: 'SM', slug: 'sutton', name: 'Sutton' },
  { code: 'TW', slug: 'twickenham', name: 'Twickenham' },
  { code: 'UB', slug: 'uxbridge', name: 'Uxbridge' },
  // ── South East ──
  { code: 'BN', slug: 'brighton', name: 'Brighton & Hove' },
  { code: 'CT', slug: 'canterbury', name: 'Canterbury' },
  { code: 'DA', slug: 'dartford', name: 'Dartford' },
  { code: 'GU', slug: 'guildford', name: 'Guildford' },
  { code: 'HP', slug: 'hemel-hempstead', name: 'Hemel Hempstead' },
  { code: 'ME', slug: 'medway', name: 'Medway' },
  { code: 'MK', slug: 'milton-keynes', name: 'Milton Keynes' },
  { code: 'OX', slug: 'oxford', name: 'Oxford' },
  { code: 'PO', slug: 'portsmouth', name: 'Portsmouth' },
  { code: 'RG', slug: 'reading', name: 'Reading' },
  { code: 'RH', slug: 'redhill', name: 'Redhill' },
  { code: 'SL', slug: 'slough', name: 'Slough' },
  { code: 'SO', slug: 'southampton', name: 'Southampton' },
  { code: 'TN', slug: 'tonbridge', name: 'Tonbridge' },
  // ── South West ──
  { code: 'BA', slug: 'bath', name: 'Bath' },
  { code: 'BH', slug: 'bournemouth', name: 'Bournemouth' },
  { code: 'BS', slug: 'bristol', name: 'Bristol' },
  { code: 'DT', slug: 'dorchester', name: 'Dorchester' },
  { code: 'EX', slug: 'exeter', name: 'Exeter' },
  { code: 'GL', slug: 'gloucester', name: 'Gloucester' },
  { code: 'PL', slug: 'plymouth', name: 'Plymouth' },
  { code: 'SN', slug: 'swindon', name: 'Swindon' },
  { code: 'SP', slug: 'salisbury', name: 'Salisbury' },
  { code: 'TA', slug: 'taunton', name: 'Taunton' },
  { code: 'TQ', slug: 'torquay', name: 'Torquay' },
  { code: 'TR', slug: 'truro', name: 'Truro' },
  // ── Crown dependencies (Royal Mail areas outside the UK regions) ──
  { code: 'GY', slug: 'guernsey', name: 'Guernsey' },
  { code: 'IM', slug: 'isle-of-man', name: 'Isle of Man' },
  { code: 'JE', slug: 'jersey', name: 'Jersey' },
];

const BY_CODE = new Map(AREA_META.map((a) => [a.code, a]));
const BY_SLUG = new Map(AREA_META.map((a) => [a.slug, a]));

/** Meta for a postcode area, generating a fallback for a code that is not a real area. */
export function areaMetaForCode(code: string): AreaMeta {
  const key = code.trim().toUpperCase();
  return BY_CODE.get(key) ?? { code: key, slug: key.toLowerCase(), name: `${key} postcode area` };
}

/** Resolve a URL slug to a postcode area meta, or null if it maps to nothing. */
export function areaMetaForSlug(slug: string): AreaMeta | null {
  const key = slug.trim().toLowerCase();
  if (BY_SLUG.has(key)) return BY_SLUG.get(key)!;
  // Allow /markets/ng as an alias for the postcode area code itself.
  if (/^[a-z]{1,2}$/.test(key)) {
    const byCode = BY_CODE.get(key.toUpperCase());
    return byCode ?? { code: key.toUpperCase(), slug: key, name: `${key.toUpperCase()} postcode area` };
  }
  return null;
}
