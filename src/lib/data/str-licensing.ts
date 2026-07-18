/**
 * UK short-term-let (STR) licensing & regulatory status, keyed by postcode area.
 * ────────────────────────────────────────────────────────────────────────────
 * Used by Market Explorer to show an honest, UK-specific regulatory flag on each
 * area — a deliberate differentiator vs AirDNA, which has no real depth here.
 *
 * MAINTENANCE: this file needs ongoing manual upkeep. UK STR regulation is
 * changing fast (see the `changeIncoming` notes). When you update an entry,
 * bump its `lastVerified` date and update `sources`. Where current status can't
 * be confirmed against an authoritative source, use `'unconfirmed'` rather than
 * guessing — this flag appears on public pages and a wrong "unrestricted" is
 * worse than an honest "unconfirmed".
 *
 * Verdict vocabulary:
 *   'confirmed-licensed'      — an STR-specific licence / registration / planning
 *                               permission demonstrably applies today.
 *   'confirmed-unrestricted'  — no STR-specific licensing requirement applies
 *                               today (normal letting rules only). May still carry
 *                               a `changeIncoming` note for legislated-but-not-live
 *                               schemes.
 *   'unconfirmed'             — current status could not be confirmed from an
 *                               authoritative source, OR the postcode area
 *                               straddles a jurisdiction boundary so no single
 *                               blanket statement is safe.
 *
 * Last full review: 2026-07-18. Landscape summary at review time:
 *   • Scotland — nationwide STR licensing in force (gov.scot). CONFIRMED-LICENSED.
 *   • Greater London — 90-night planning cap on whole-home lets (Deregulation Act
 *     2015 s.44). CONFIRMED-LICENSED (a genuine restriction).
 *   • Northern Ireland — Tourism NI certification required (1992 Order).
 *     CONFIRMED-LICENSED.
 *   • England outside London — NO STR-specific licence live. The England-wide
 *     *registration* scheme (Levelling-Up & Regeneration Act 2023) is legislated
 *     but NOT yet operational (an April-2026 target slipped; no live portal as of
 *     July 2026). The C5 short-let use class SI has not been laid. So today:
 *     CONFIRMED-UNRESTRICTED, with a "national register incoming" note.
 *   • Wales — statutory visitor-accommodation registration (Welsh Revenue
 *     Authority) opens autumn 2026; licensing ~2029. Not live yet →
 *     CONFIRMED-UNRESTRICTED today, with an imminent-change note. (The 182-day
 *     let test is a council-tax classification, NOT a licensing requirement.)
 *   • London-fringe postcode areas cross the Greater London boundary, and SY/CH
 *     cross the England–Wales border → UNCONFIRMED (straddle).
 */

export type LicensingStatus =
  | 'confirmed-licensed'
  | 'confirmed-unrestricted'
  | 'unconfirmed';

export interface LicensingEntry {
  /** UK postcode area prefix, uppercase, e.g. "EH", "NG". */
  postcodeArea: string;
  nation: 'Scotland' | 'England' | 'Wales' | 'Northern Ireland' | 'Mixed';
  /** Human label for the area's jurisdiction, e.g. "Greater London". */
  regionLabel: string;
  status: LicensingStatus;
  /** One-line, user-facing summary shown on the card badge. */
  headline: string;
  /** 1–2 sentence explanation shown on the area page. */
  detail: string;
  /** Optional note about a legislated-but-not-yet-live change. */
  changeIncoming?: string;
  /** True when the postcode area crosses a jurisdiction boundary. */
  straddle?: boolean;
  /** Cited authoritative source URLs. Required for every confirmed entry. */
  sources: string[];
  /** ISO date this entry was last verified. */
  lastVerified: string;
}

const VERIFIED = '2026-07-18';

// ─── Shared authoritative sources (cited per nation) ────────────────
const SRC_SCOTLAND = [
  'https://www.gov.scot/publications/short-term-lets/',
  'https://www.gov.scot/publications/short-term-lets-licensing-scheme-part-1-guidance-hosts-operators/',
];
const SRC_LONDON = [
  'https://www.legislation.gov.uk/ukpga/2015/20/section/44', // Deregulation Act 2015 s.44 (90-night cap)
  'https://www.cityoflondon.gov.uk/services/planning/planning-enforcement/short-term-letting',
];
const SRC_ENGLAND_NATIONAL = [
  'https://www.gov.uk/guidance/delivering-a-registration-scheme-for-short-term-lets', // registration scheme — pending, not live
  'https://www.gov.uk/government/consultations/introduction-of-a-use-class-for-short-term-lets-and-associated-permitted-development-rights/introduction-of-a-use-class-for-short-term-lets-and-associated-permitted-development-rights', // C5 use class — not yet in force
];
const SRC_WALES = [
  'https://www.gov.wales/registering-visitor-accommodation-overview',
  'https://www.gov.wales/plans-unveiled-statutory-registration-and-licensing-scheme-visitor-accommodation-wales',
];
const SRC_NI = [
  'https://www.gov.uk/find-licences/tourist-accommodation-certification-northern-ireland',
  'https://www.nibusinessinfo.co.uk/content/get-your-tourist-accommodation-certified',
];

// Standing note for England (ex-London): a national scheme is coming but not live.
const ENGLAND_CHANGE =
  'A national registration scheme (Levelling-Up & Regeneration Act 2023) is legislated but not yet live as of July 2026; a proposed C5 short-let use class has not yet come into force.';
const WALES_CHANGE =
  'Wales’ statutory visitor-accommodation registration (Welsh Revenue Authority) is due to open in autumn 2026; a licensing scheme is expected around 2029.';

// ─── Helpers to build the repetitive-but-flat national entries ──────
// These keep every postcode entry explicit and greppable while avoiding
// copy-paste drift in the shared source URLs and notes.
function scotland(postcodeArea: string, regionLabel: string, extraDetail = ''): LicensingEntry {
  return {
    postcodeArea,
    nation: 'Scotland',
    regionLabel,
    status: 'confirmed-licensed',
    headline: 'STR licence required',
    detail:
      `Scotland operates a nationwide short-term-let licensing scheme — every STR must hold a licence from its council before accepting bookings.${extraDetail ? ' ' + extraDetail : ''}`,
    sources: SRC_SCOTLAND,
    lastVerified: VERIFIED,
  };
}

function englandCity(postcodeArea: string, regionLabel: string): LicensingEntry {
  return {
    postcodeArea,
    nation: 'England',
    regionLabel,
    status: 'confirmed-unrestricted',
    headline: 'No STR licence required (yet)',
    detail:
      'No short-term-let-specific licence or registration currently applies in this area — normal letting rules only.',
    changeIncoming: ENGLAND_CHANGE,
    sources: SRC_ENGLAND_NATIONAL,
    lastVerified: VERIFIED,
  };
}

function londonCore(postcodeArea: string, regionLabel: string): LicensingEntry {
  return {
    postcodeArea,
    nation: 'England',
    regionLabel,
    status: 'confirmed-licensed',
    headline: '90-night limit (Greater London)',
    detail:
      'In Greater London, letting a whole home for more than 90 nights per calendar year requires planning permission (Deregulation Act 2015). Below 90 nights no permission is needed.',
    sources: SRC_LONDON,
    lastVerified: VERIFIED,
  };
}

function walesCity(postcodeArea: string, regionLabel: string): LicensingEntry {
  return {
    postcodeArea,
    nation: 'Wales',
    regionLabel,
    status: 'confirmed-unrestricted',
    headline: 'No STR licence required (yet)',
    detail:
      'No short-term-let-specific licence currently applies in Wales — normal letting rules only. (The 182-day letting test is a council-tax classification, not a licence.)',
    changeIncoming: WALES_CHANGE,
    sources: SRC_WALES,
    lastVerified: VERIFIED,
  };
}

function straddle(
  postcodeArea: string,
  regionLabel: string,
  detail: string,
  sources: string[],
): LicensingEntry {
  return {
    postcodeArea,
    nation: 'Mixed',
    regionLabel,
    status: 'unconfirmed',
    headline: 'Rules vary within this area',
    detail,
    straddle: true,
    sources,
    lastVerified: VERIFIED,
  };
}

// ─── The lookup ─────────────────────────────────────────────────────
export const STR_LICENSING: Record<string, LicensingEntry> = {
  // ── Scotland — confirmed-licensed (nationwide scheme) ──
  EH: scotland(
    'EH',
    'Edinburgh & Lothians',
    'Edinburgh is also a designated short-term-let control area (since Sep 2022): using a whole dwelling that is not your principal home as an STR is a change of use requiring planning permission, on top of the licence.',
  ),
  G: scotland('G', 'Glasgow'),
  AB: scotland('AB', 'Aberdeen'),
  DD: scotland('DD', 'Dundee'),
  IV: scotland(
    'IV',
    'Inverness & Highland',
    'Highland Council has designated the Badenoch & Strathspey ward (Aviemore/Cairngorms) a control area (Mar 2024) requiring planning permission in addition to the licence.',
  ),
  FK: scotland('FK', 'Falkirk & Stirling'),
  KY: scotland('KY', 'Fife'),
  KA: scotland('KA', 'Kilmarnock & Ayrshire'),
  PA: scotland('PA', 'Paisley & Argyll'),
  PH: scotland('PH', 'Perth & Highland Perthshire'),
  ML: scotland('ML', 'Motherwell & Lanarkshire'),

  // ── Greater London — confirmed-licensed (90-night cap) ──
  E: londonCore('E', 'East London'),
  EC: londonCore('EC', 'City of London'),
  N: londonCore('N', 'North London'),
  NW: londonCore('NW', 'North West London'),
  SE: londonCore('SE', 'South East London'),
  SW: londonCore('SW', 'South West London'),
  W: londonCore('W', 'West London'),
  WC: londonCore('WC', 'Central London'),

  // ── London-fringe postcode areas — straddle Greater London boundary ──
  EN: straddle('EN', 'Enfield & Hertfordshire border', 'This postcode area crosses the Greater London boundary into Hertfordshire; the 90-night rule applies only to the parts inside Greater London, so a single blanket statement is unsafe.', SRC_LONDON),
  IG: straddle('IG', 'Ilford & Essex border', 'Crosses the Greater London boundary into Essex; the 90-night rule applies only within Greater London.', SRC_LONDON),
  RM: straddle('RM', 'Romford & Essex border', 'Crosses the Greater London boundary into Essex; the 90-night rule applies only within Greater London.', SRC_LONDON),
  CR: straddle('CR', 'Croydon & Surrey border', 'Crosses the Greater London boundary into Surrey; the 90-night rule applies only within Greater London.', SRC_LONDON),
  BR: straddle('BR', 'Bromley & Kent border', 'Crosses the Greater London boundary into Kent; the 90-night rule applies only within Greater London.', SRC_LONDON),
  KT: straddle('KT', 'Kingston & Surrey border', 'Crosses the Greater London boundary into Surrey; the 90-night rule applies only within Greater London.', SRC_LONDON),
  TW: straddle('TW', 'Twickenham & Surrey border', 'Crosses the Greater London boundary into Surrey; the 90-night rule applies only within Greater London.', SRC_LONDON),
  UB: straddle('UB', 'Uxbridge & Hillingdon border', 'Crosses the Greater London boundary; the 90-night rule applies only within Greater London.', SRC_LONDON),
  HA: straddle('HA', 'Harrow & Hertfordshire border', 'Crosses the Greater London boundary into Hertfordshire; the 90-night rule applies only within Greater London.', SRC_LONDON),
  SM: straddle('SM', 'Sutton & Surrey border', 'Crosses the Greater London boundary into Surrey; the 90-night rule applies only within Greater London.', SRC_LONDON),
  DA: straddle('DA', 'Dartford & Kent border', 'Crosses the Greater London boundary into Kent; the 90-night rule applies only within Greater London.', SRC_LONDON),

  // ── England outside London — confirmed-unrestricted today ──
  M: englandCity('M', 'Manchester'),
  L: englandCity('L', 'Liverpool'),
  B: englandCity('B', 'Birmingham'),
  LS: englandCity('LS', 'Leeds'),
  S: englandCity('S', 'Sheffield'),
  NG: englandCity('NG', 'Nottingham'),
  BS: englandCity('BS', 'Bristol'),
  NE: englandCity('NE', 'Newcastle upon Tyne'),
  LE: englandCity('LE', 'Leicester'),
  CV: englandCity('CV', 'Coventry'),
  DE: englandCity('DE', 'Derby'),
  ST: englandCity('ST', 'Stoke-on-Trent'),
  WV: englandCity('WV', 'Wolverhampton'),
  BD: englandCity('BD', 'Bradford'),
  HD: englandCity('HD', 'Huddersfield'),
  WF: englandCity('WF', 'Wakefield'),
  HU: englandCity('HU', 'Hull'),
  YO: englandCity('YO', 'York'),
  PE: englandCity('PE', 'Peterborough'),
  NR: englandCity('NR', 'Norwich'),
  CB: englandCity('CB', 'Cambridge'),
  OX: englandCity('OX', 'Oxford'),
  RG: englandCity('RG', 'Reading'),
  MK: englandCity('MK', 'Milton Keynes'),
  PO: englandCity('PO', 'Portsmouth'),
  SO: englandCity('SO', 'Southampton'),
  BN: englandCity('BN', 'Brighton & Hove'),
  BH: englandCity('BH', 'Bournemouth'),
  PL: englandCity('PL', 'Plymouth'),
  EX: englandCity('EX', 'Exeter'),
  TQ: englandCity('TQ', 'Torquay & Torbay'),
  TR: englandCity('TR', 'Truro & Cornwall'),
  BA: englandCity('BA', 'Bath'),
  GL: englandCity('GL', 'Gloucester & Cheltenham'),
  PR: englandCity('PR', 'Preston'),
  BB: englandCity('BB', 'Blackburn'),
  FY: englandCity('FY', 'Blackpool'),
  LA: englandCity('LA', 'Lancaster & the Lakes'),
  CA: englandCity('CA', 'Carlisle & Cumbria'),
  DH: englandCity('DH', 'Durham'),
  SR: englandCity('SR', 'Sunderland'),
  TS: englandCity('TS', 'Middlesbrough & Teesside'),
  HG: englandCity('HG', 'Harrogate'),
  BL: englandCity('BL', 'Bolton'),
  OL: englandCity('OL', 'Oldham'),
  SK: englandCity('SK', 'Stockport'),
  WA: englandCity('WA', 'Warrington'),
  CT: englandCity('CT', 'Canterbury & East Kent'),
  DT: englandCity('DT', 'Dorchester & Dorset'),

  // ── Wales — confirmed-unrestricted today, registration incoming ──
  CF: walesCity('CF', 'Cardiff'),
  SA: walesCity('SA', 'Swansea'),
  LL: walesCity('LL', 'North West Wales (Gwynedd, Anglesey, Conwy)'),
  LD: walesCity('LD', 'Mid Wales (Powys)'),
  NP: walesCity('NP', 'Newport & Gwent'),

  // ── England–Wales border straddles ──
  SY: straddle('SY', 'Shrewsbury & Mid-Wales border', 'This postcode area covers both Shropshire (England) and Powys (Wales). The applicable regime differs by side of the border, so no single statement is safe.', [...SRC_ENGLAND_NATIONAL, ...SRC_WALES]),
  CH: straddle('CH', 'Chester & Flintshire border', 'This postcode area covers both Cheshire (England) and Flintshire (Wales). The applicable regime differs by side of the border.', [...SRC_ENGLAND_NATIONAL, ...SRC_WALES]),

  // ── Northern Ireland — confirmed-licensed (Tourism NI certification) ──
  BT: {
    postcodeArea: 'BT',
    nation: 'Northern Ireland',
    regionLabel: 'Northern Ireland',
    status: 'confirmed-licensed',
    headline: 'Tourism NI certificate required',
    detail:
      'All tourist/visitor accommodation in Northern Ireland must hold a current Tourism NI certificate (Tourism (NI) Order 1992) before operating. A reform consultation closed in January 2026 but certification remains required.',
    sources: SRC_NI,
    lastVerified: VERIFIED,
  },
};

/**
 * Look up the licensing status for a postcode area. Returns an honest
 * `'unconfirmed'` fallback entry for any area not in the table, so an
 * unknown/unlisted area is never silently presented as "unrestricted".
 */
export function getLicensing(postcodeArea: string | null | undefined): LicensingEntry {
  const key = (postcodeArea ?? '').trim().toUpperCase();
  const entry = STR_LICENSING[key];
  if (entry) return entry;

  return {
    postcodeArea: key || 'UNKNOWN',
    nation: 'Mixed',
    regionLabel: key || 'Unknown area',
    status: 'unconfirmed',
    headline: 'Licensing status unconfirmed',
    detail:
      'We have not yet confirmed the current short-term-let licensing status for this area against an authoritative source. Check with the local authority before proceeding.',
    sources: [],
    lastVerified: VERIFIED,
  };
}
