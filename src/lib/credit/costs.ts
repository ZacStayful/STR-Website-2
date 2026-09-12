/**
 * Seed unit costs: what each provider call costs US, in pence, before markup.
 * These are estimates from provider rate cards and the notes in each client;
 * they are upserted into `unit_costs` (never overwriting admin edits) and
 * reconciled against real invoices during shadow mode on /admin/billing.
 *
 * Pure module: no server imports, so it can be unit-tested.
 */

export interface UnitCostSeed {
  provider: string;
  unit: string;
  label: string;
  /** Our raw cost per unit, pence (fractional allowed). */
  unitCostPence: number;
  /** Charge multiplier; defaults to the base markup (5). */
  markup?: number;
  notes?: string;
}

/** £1 = $1.27 at seed time; provider USD prices are converted at 0.79 £/$. */
const USD = 79; // pence per dollar

export const DEFAULT_MARKUP = 5;

export const UNIT_COST_SEED: UnitCostSeed[] = [
  // ── Airbtics ──
  { provider: 'airbtics', unit: 'report_all', label: 'Airbtics report/all (full comps report)', unitCostPence: 0.5 * USD, notes: '$0.50 per POST; GET reads are free' },
  { provider: 'airbtics', unit: 'report_read', label: 'Airbtics report read (cached report id)', unitCostPence: 0, notes: 'Free' },
  { provider: 'airbtics', unit: 'bounds', label: 'Airbtics listings/search/bounds', unitCostPence: 5, notes: '$0.05' },
  { provider: 'airbtics', unit: 'market_search', label: 'Airbtics markets/search', unitCostPence: 1, notes: '$0.01, only for unknown cities' },
  { provider: 'airbtics', unit: 'market_summary', label: 'Airbtics markets/summary', unitCostPence: 0.25 * USD, notes: '$0.25, fallback flow only' },
  { provider: 'airbtics', unit: 'metric_revenue', label: 'Airbtics markets/metrics/revenue', unitCostPence: 0.2 * USD, notes: 'fallback flow only' },
  { provider: 'airbtics', unit: 'metric_occupancy', label: 'Airbtics markets/metrics/occupancy', unitCostPence: 0.2 * USD, notes: 'fallback flow only' },
  // ── Property Market Intel (credits; ~1.5p per credit on the Starter tier) ──
  { provider: 'pmi', unit: 'str_estimate', label: 'PMI STR second opinion (50 credits)', unitCostPence: 75 },
  { provider: 'pmi', unit: 'str_market', label: 'PMI area STR snapshot (3 credits)', unitCostPence: 5 },
  { provider: 'pmi', unit: 'listings', label: 'PMI listings search (1 credit)', unitCostPence: 2 },
  // ── PropertyData (credit-based; estimate) ──
  { provider: 'propertydata', unit: 'floor_areas', label: 'PropertyData /floor-areas', unitCostPence: 2.5, notes: 'estimate — reconcile against the PropertyData invoice' },
  { provider: 'propertydata', unit: 'valuation_rent', label: 'PropertyData /valuation-rent (per attempt)', unitCostPence: 2.5, notes: 'up to 3 attempts per report' },
  { provider: 'propertydata', unit: 'valuation_sale', label: 'PropertyData /valuation-sale (per attempt)', unitCostPence: 2.5, notes: 'up to 2 attempts per report' },
  // ── Google Maps Platform ──
  { provider: 'google', unit: 'geocode', label: 'Google Geocoding', unitCostPence: 0.005 * USD, notes: '$5 per 1,000' },
  { provider: 'google', unit: 'reverse_geocode', label: 'Google reverse geocoding', unitCostPence: 0.005 * USD, notes: '$5 per 1,000' },
  { provider: 'google', unit: 'places_nearby', label: 'Google Places nearby search (Enterprise SKU)', unitCostPence: 0.035 * USD, notes: '$35 per 1,000 — rating field puts it on the Enterprise SKU; 6 per report' },
  { provider: 'google', unit: 'autocomplete_session', label: 'Google Places autocomplete (per session)', unitCostPence: 0.017 * USD, notes: '$17 per 1,000 sessions; one charge per completed address' },
  // ── Ticketmaster (free tier today; priced nominally so it scales) ──
  { provider: 'ticketmaster', unit: 'event_search', label: 'Ticketmaster Discovery event search', unitCostPence: 0.5, notes: 'free tier today; nominal' },
  // ── PriceLabs (off unless PRICELABS_AS_PRIMARY=true) ──
  { provider: 'pricelabs', unit: 'revenue_estimate', label: 'PriceLabs revenue estimator', unitCostPence: 10, notes: 'estimate — trial quota today' },
  // ── OnTheMarket page fetches (our bandwidth; nominal) ──
  { provider: 'onthemarket', unit: 'search_page', label: 'OnTheMarket results page fetch', unitCostPence: 0.2, notes: 'nominal' },
  { provider: 'onthemarket', unit: 'listing_page', label: 'Listing page fetch (Rightmove / OnTheMarket)', unitCostPence: 0.2, notes: 'nominal' },
  // ── Our own data ──
  { provider: 'internal', unit: 'postcode_lookup', label: 'Stayful postcode figures (own data)', unitCostPence: 0 },
  { provider: 'internal', unit: 'stored_comp', label: 'Stayful stored comparable (own data)', unitCostPence: 0 },
  // ── Anthropic claude-opus-4-8: $5 / $25 per million tokens ──
  { provider: 'anthropic', unit: 'input_token', label: 'Anthropic input token (Opus 4.8)', unitCostPence: (5 * USD) / 1_000_000, notes: '$5 per MTok' },
  { provider: 'anthropic', unit: 'output_token', label: 'Anthropic output token (Opus 4.8)', unitCostPence: (25 * USD) / 1_000_000, notes: '$25 per MTok' },
  { provider: 'anthropic', unit: 'cache_read_token', label: 'Anthropic cache read token', unitCostPence: (0.5 * USD) / 1_000_000, notes: '10% of input' },
  { provider: 'anthropic', unit: 'cache_write_token', label: 'Anthropic cache write token', unitCostPence: (6.25 * USD) / 1_000_000, notes: '125% of input' },
  // ── ElevenLabs turbo: Creator plan ≈ $22 per 100k characters ──
  { provider: 'elevenlabs', unit: 'character', label: 'ElevenLabs speech (per character)', unitCostPence: (22 * USD) / 100_000, notes: 'Creator plan; turbo models bill 0.5 credit/char on some tiers — reconcile' },
];

export interface UnitCost {
  provider: string;
  unit: string;
  label: string;
  unitCostPence: number;
  markup: number;
  notes: string | null;
}

export type UnitCostTable = Map<string, UnitCost>;

export function unitKey(provider: string, unit: string): string {
  return `${provider}:${unit}`;
}

/** The seed as a lookup table (used when the DB is unreachable and in tests). */
export function seedTable(markup = DEFAULT_MARKUP): UnitCostTable {
  const t: UnitCostTable = new Map();
  for (const s of UNIT_COST_SEED) t.set(unitKey(s.provider, s.unit), { provider: s.provider, unit: s.unit, label: s.label, unitCostPence: s.unitCostPence, markup: s.markup ?? markup, notes: s.notes ?? null });
  return t;
}
