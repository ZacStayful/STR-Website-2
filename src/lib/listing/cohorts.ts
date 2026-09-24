/**
 * Motivated-seller cohorts from PropertyData's /sourced-properties feed.
 *
 * Everything else in the motivation read is inferred: we work out how long a
 * listing has been up, or we read the agent's wording and try to tell a real
 * signal from a sales pitch. This feed is different — it is a data provider
 * stating that a property has been continuously marketed for fourteen months,
 * or has been cut by more than fifteen percent, or has been repossessed. Those
 * are facts, not adjectives, so they count as firm evidence.
 *
 * This module is the pure half: normalising the feed's rows, matching them to
 * listings we already hold, and saying what being in a cohort implies. The
 * network client lives in ../apis/propertydata-sourced.ts.
 *
 * The response shape is NOT documented — PropertyData's docs describe the
 * request and the extra field each cohort adds, then say the example response
 * is abridged. So every field here is read tolerantly, through several
 * plausible spellings, and anything missing is null rather than a guess. Run
 * `node scripts/probe-sourced-properties.mjs` against a real key to see the
 * actual shape, then tighten these.
 */

/** The cohorts worth acting on. Each says something specific about the seller. */
export type CohortKey =
  | 'slow_to_sell'
  | 'price_reduced'
  | 'repossessed'
  | 'quick_sale'
  | 'back_on_market'
  | 'chain_free'
  | 'auction'
  | 'tenanted'
  | 'short_lease'
  | 'unmodernised'
  | 'cash_buyers_only';

/**
 * The `list` slug each cohort is requested by. The docs give these
 * inconsistently — `reduced-properties` on one page, `price-reduced` on
 * another — so each cohort carries the candidates it is known by and the
 * client tries them in order, remembering which one the API actually accepts.
 * Overridable per cohort with PROPERTYDATA_LIST_<COHORT> when they change.
 */
export const COHORT_SLUGS: Record<CohortKey, readonly string[]> = {
  slow_to_sell: ['slow-to-sell', 'slow-to-sell-properties'],
  price_reduced: ['price-reduced', 'reduced-properties'],
  repossessed: ['repossessed-properties', 'repossessed'],
  quick_sale: ['quick-sale', 'quick-sale-properties'],
  back_on_market: ['back-on-market', 'back-on-market-properties'],
  chain_free: ['chain-free', 'chain-free-properties'],
  auction: ['auction', 'auction-properties'],
  tenanted: ['tenanted', 'tenanted-properties'],
  short_lease: ['short-lease', 'short-lease-properties'],
  unmodernised: ['unmodernised-properties', 'unmodernised'],
  cash_buyers_only: ['cash-buyers-only-properties', 'cash-buyers-only'],
};

/** Which cohorts are worth the credits by default. The rest are opt-in. */
export const DEFAULT_COHORTS: readonly CohortKey[] = ['slow_to_sell', 'price_reduced', 'repossessed', 'quick_sale', 'back_on_market'];

export function isCohortKey(v: unknown): v is CohortKey {
  return typeof v === 'string' && v in COHORT_SLUGS;
}

/** One property as the feed describes it, after normalising. */
export interface CohortMember {
  /** Identity for matching against our own listings. */
  uprn: string | null;
  postcode: string | null;
  address: string | null;
  /** A portal link, when the feed carries one. Often it does not. */
  url: string | null;
  price: number | null;
  bedrooms: number | null;
  propertyType: string | null;
  /** Every cohort this property turned up in. */
  cohorts: CohortKey[];
  /** Hard numbers the feed attaches to particular cohorts. */
  monthsOnMarket: number | null;
  reducedByPct: number | null;
  yearsRemaining: number | null;
}

// ── Tolerant reading ──

function firstString(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function firstNumber(o: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[£,%\s]/g, '')) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** Normalises a postcode to the spaced uppercase form, or null. */
export function tidyPostcode(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.toUpperCase().match(UK_POSTCODE);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** One row of the feed. Unknown shape, so every field is optional and tolerantly read. */
export function parseCohortRow(raw: unknown, cohort: CohortKey): CohortMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const address = firstString(o, ['address', 'display_address', 'full_address', 'property_address']);
  const postcode = tidyPostcode(firstString(o, ['postcode', 'post_code', 'outcode_incode']) ?? address);
  const uprn = firstString(o, ['uprn', 'UPRN', 'property_id', 'id']);
  // A row with nothing to identify it by is unusable: it can neither be sent
  // nor matched to anything we hold.
  if (!uprn && !postcode && !address) return null;
  return {
    uprn,
    postcode,
    address,
    url: firstString(o, ['url', 'listing_url', 'portal_url', 'link', 'source_url']),
    price: firstNumber(o, ['price', 'asking_price', 'current_price']),
    bedrooms: firstNumber(o, ['bedrooms', 'beds', 'num_bedrooms']),
    propertyType: firstString(o, ['type_standardised', 'standardised_type', 'type', 'property_type']),
    cohorts: [cohort],
    monthsOnMarket: firstNumber(o, ['months_on_market', 'monthsOnMarket', 'time_on_market_months']),
    reducedByPct: firstNumber(o, ['reduced_by', 'reducedBy', 'reduction_pct', 'reduced_by_percent']),
    yearsRemaining: firstNumber(o, ['years_remaining', 'yearsRemaining', 'lease_years_remaining']),
  };
}

/**
 * The key a property is matched on. UPRN when both sides have one, else the
 * postcode with the building number — which is the most identity two different
 * feeds can usually agree on without a full address parse.
 */
export function matchKeys(m: { uprn?: string | null; postcode?: string | null; address?: string | null }): string[] {
  const keys: string[] = [];
  if (m.uprn) keys.push(`uprn:${m.uprn}`);
  const pc = tidyPostcode(m.postcode ?? null) ?? tidyPostcode(m.address ?? null);
  const number = m.address?.trim().match(/^(?:flat\s+)?(\d+[a-z]?)\b/i)?.[1];
  if (pc && number) keys.push(`pc:${pc.replace(/\s+/g, '')}:${number.toLowerCase()}`);
  return keys;
}

/**
 * Folds rows from several cohort queries into one property each, so a listing
 * that is both slow to sell and reduced is one member carrying both.
 */
export function mergeCohortMembers(rows: CohortMember[]): CohortMember[] {
  const byKey = new Map<string, CohortMember>();
  const out: CohortMember[] = [];
  for (const row of rows) {
    const keys = matchKeys(row);
    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!existing) {
      out.push(row);
      for (const k of keys) byKey.set(k, row);
      continue;
    }
    for (const c of row.cohorts) if (!existing.cohorts.includes(c)) existing.cohorts.push(c);
    // Keep the first non-null of each number: the cohort that carries a field
    // is the one that measured it.
    existing.monthsOnMarket ??= row.monthsOnMarket;
    existing.reducedByPct ??= row.reducedByPct;
    existing.yearsRemaining ??= row.yearsRemaining;
    existing.url ??= row.url;
    existing.price ??= row.price;
    existing.bedrooms ??= row.bedrooms;
    existing.address ??= row.address;
    existing.postcode ??= row.postcode;
    for (const k of keys) if (!byKey.has(k)) byKey.set(k, existing);
  }
  return out;
}

/** An index for looking a listing up against the feed. */
export function indexCohorts(members: CohortMember[]): Map<string, CohortMember> {
  const index = new Map<string, CohortMember>();
  for (const m of members) for (const k of matchKeys(m)) if (!index.has(k)) index.set(k, m);
  return index;
}

export function lookupCohorts(index: Map<string, CohortMember>, listing: { uprn?: string | null; postcode?: string | null; address?: string | null }): CohortMember | null {
  for (const k of matchKeys(listing)) {
    const hit = index.get(k);
    if (hit) return hit;
  }
  return null;
}
