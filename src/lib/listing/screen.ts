/**
 * Income screening for the deal finder: does a property earn enough as a short
 * let to be worth recommending, measured against what the same property would
 * earn on a long-term let?
 *
 * TWO TESTS, ONE PER DEAL KIND. Rent-to-rent carries the rent as a real cost,
 * so it needs a higher bar than a purchase:
 *
 *   purchase      the member would BUY. Compare short-let net against the
 *                 LONG-LET NET the property would produce (rent minus a
 *                 letting agent's 10%). Qualifies on a 40% uplift.
 *   rent-to-rent  the member would RENT and sub-let. The advertised rent IS
 *                 the market rent and the operator pays ALL of it, so no agent
 *                 fee is deducted. Qualifies on £8,000 a year of profit.
 *
 * WHY THE BAR IS HIGH. The threshold is a market-quality signal, not a
 * profitability calculation. A wide gap between short-let net and long-let net
 * means low competition — short letting genuinely stands out in that area. A
 * narrow gap means the market has self-regulated: supply has arrived, margins
 * have compressed, and properties drop off because they no longer pay. So a low
 * pass rate is the intended behaviour, NOT a threshold to tune away.
 *
 * COST MODEL. `STR_NET_MULTIPLE` (0.44) covers everything that scales with
 * revenue — platform, management including VAT, cleaning, void. The fixed-cost
 * table covers only the standing costs that do not — utilities, council tax,
 * broadband, insurance. The two do not overlap, which is why they compose by
 * subtraction. Do not add cleaning or management to the table; it is already in
 * the 0.44.
 *
 * This is deliberately NOT the cost model in `../analysis.ts` (0.52 net, no
 * fixed costs) or `./deal.ts` (0.52 net plus £250pcm bills). Those drive the
 * analyser, the PDF report and the Market Explorer verdict and are unchanged.
 * This model exists only for the deal finder's screening.
 *
 * Pure: no network, no database, no `server-only`, so it runs under `node --test`.
 */
import type { SourcingKind } from './sourcing.ts';

// ── The constants ──

/** Short-let net as a share of gross: platform, management (inc. VAT), cleaning and void. */
export const STR_NET_MULTIPLE = 0.44;

/**
 * A letting agent's cut of long-let rent. Applied to the PURCHASE comparison
 * only: a landlord weighing a short let against a long let loses this to an
 * agent, but a rent-to-rent operator pays the landlord's full asking rent and
 * never sees it. The asymmetry is deliberate — see the module note above.
 * Matches LONG_LET_AGENT_FEE_RATE in ../analysis.ts.
 */
export const LTL_AGENT_FEE_RATE = 0.10;

/** Purchase: uplift over long-let net, as a percentage. */
export const BUY_QUALIFIED_UPLIFT_PCT = 40;
export const BUY_MEDIUM_UPLIFT_PCT = 10;

/** Rent-to-rent: annual profit after rent and fixed costs, in £. */
export const R2R_QUALIFIED_PROFIT = 8_000;
export const R2R_MEDIUM_PROFIT = 4_000;

/**
 * An alternative route to `qualified` on BOTH kinds: a cash surplus this large
 * is worth recommending even when the percentage uplift looks unremarkable,
 * which is the case for high-value property where the long-let side is already
 * substantial. Promotes only — it never demotes, and it never overrides
 * `insufficient-data`.
 *
 * On a purchase it can only bind when long-let net exceeds
 * £20,000 / 0.40 = £50,000 a year, i.e. a market rent above about £4,630 pcm.
 * Nothing in the areas the finder currently sources comes close (mean surplus
 * £7,912, p90 £18,578 across 615 screened sale listings), so today it promotes
 * nothing and is a dormant safety net for prime stock.
 *
 * On rent-to-rent it can NEVER bind, because £20,000 already clears the £8,000
 * bar. It is applied there anyway so both kinds run the same rule. That branch
 * is intentionally redundant — do not delete it as dead code.
 */
export const ABSOLUTE_QUALIFIED_SURPLUS = 20_000;

/** Annual standing costs by bedroom count. 5 is the 5-or-more figure. */
export const FIXED_COSTS_BY_BEDROOMS: Record<number, number> = {
  1: 4_104,
  2: 4_704,
  3: 5_304,
  4: 5_904,
  5: 6_504,
};

/** Bedroom count assumed when a listing does not state one. */
export const ASSUMED_BEDROOMS = 4;

/**
 * Fixed costs for a bedroom count, clamped to the table. A studio arrives as 0
 * from the OnTheMarket search cards and a 7-bed is beyond the table, so both
 * would otherwise read `undefined` and poison every later figure with NaN.
 */
export function fixedCostsFor(bedrooms: number): number {
  const clamped = Math.min(Math.max(Math.round(bedrooms), 1), 5);
  return FIXED_COSTS_BY_BEDROOMS[clamped];
}

// ── Bands and figures ──

export type Band = 'qualified' | 'medium' | 'unqualified' | 'insufficient-data';

/**
 * What a member is shown. The band keys above are the stored value and what the
 * admin screening report prints; these are the words that reach a person, so a
 * property is never described to its prospective buyer as "UNQUALIFIED".
 */
export const BAND_LABELS: Record<Band, string> = {
  qualified: 'Short let recommended',
  medium: 'Marginal',
  unqualified: 'Not recommended',
  'insufficient-data': 'Not enough data',
};

const BAND_ORDER: Band[] = ['qualified', 'medium', 'unqualified', 'insufficient-data'];

/** Sort key: best band first. */
export function bandRank(band: Band): number {
  return BAND_ORDER.indexOf(band);
}

export function isBand(v: unknown): v is Band {
  return typeof v === 'string' && (BAND_ORDER as string[]).includes(v);
}

export type FigureSource = 'confirmed' | 'estimated';
export type Confidence = 'high' | 'medium' | 'low';

/** One input figure, and how much it should be trusted. Never present an estimate as confirmed. */
export interface Figure {
  value: number;
  source: FigureSource;
  confidence: Confidence;
}

const CONFIDENCE_ORDER: Confidence[] = ['low', 'medium', 'high'];

/** The weaker of two confidences — a result is only as good as its worst input. */
export function lowerConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

// ── The result ──

interface ScreeningBase {
  band: Band;
  /** As stated by the listing; null when unknown. */
  bedrooms: number | null;
  /** True when `bedrooms` was unknown and ASSUMED_BEDROOMS was used for the costs. */
  bedroomsAssumed: boolean;
  fixedCosts: number;
  grossRevenue: Figure | null;
  marketRent: Figure | null;
  /** gross × STR_NET_MULTIPLE. */
  strNet: number | null;
  /** The cash the short let wins, AFTER fixed costs. What ABSOLUTE_QUALIFIED_SURPLUS tests. */
  surplus: number | null;
  /** Gross revenue the property would need to reach `qualified` on the percentage/profit route. */
  requiredGross: number | null;
  /** gross − requiredGross. Negative is a near-miss, and is reported rather than hidden. */
  gap: number | null;
  confidence: Confidence | null;
  /** True when ABSOLUTE_QUALIFIED_SURPLUS is what earned `qualified`. */
  byAbsolute: boolean;
  reason: string;
}

export interface PurchaseScreening extends ScreeningBase {
  kind: 'purchase';
  /** rent × 12 less the letting agent's cut. */
  ltlNet: number | null;
  /** surplus ÷ ltlNet, as a percentage. */
  upliftPct: number | null;
}

export interface RentToRentScreening extends ScreeningBase {
  kind: 'rent-to-rent';
  /** rent × 12, in full — the operator pays the lot. */
  annualRent: number | null;
  /** Same quantity as `surplus`; named for the spec this implements. */
  annualProfit: number | null;
  /** gross ÷ annualRent. A thin multiple is the signal that a market has saturated. */
  revenueMultiple: number | null;
}

export type Screening = PurchaseScreening | RentToRentScreening;

export interface ScreenInput {
  bedrooms: number | null;
  /** Annual gross short-let revenue before any deduction. */
  grossRevenue: Figure | null;
  /** Monthly market rent: what a landlord would charge on a long-term let. */
  marketRent: Figure | null;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which input is missing, or null when everything needed is present and usable. */
function missingInput(input: ScreenInput): string | null {
  if (input.bedrooms === null) return 'bedroom count not stated, so the running costs cannot be established';
  if (!input.grossRevenue || input.grossRevenue.value <= 0) return 'no short-let revenue figure for this area and size';
  if (!input.marketRent || input.marketRent.value <= 0) return 'no long-term rent figure for this area and size';
  return null;
}

function insufficient(input: ScreenInput, reason: string) {
  const assumed = input.bedrooms === null;
  return {
    band: 'insufficient-data' as const,
    bedrooms: input.bedrooms,
    bedroomsAssumed: assumed,
    fixedCosts: fixedCostsFor(assumed ? ASSUMED_BEDROOMS : input.bedrooms!),
    grossRevenue: input.grossRevenue,
    marketRent: input.marketRent,
    strNet: null,
    surplus: null,
    requiredGross: null,
    gap: null,
    confidence: null,
    byAbsolute: false,
    reason: `Not banded: ${reason}.`,
  };
}

/**
 * Money is rounded to the pound BEFORE the band is decided, so the figure shown
 * and the band shown can never disagree at a boundary (a profit printed as
 * £8,000 always reads as qualified).
 */
export function screenPurchase(input: ScreenInput): PurchaseScreening {
  const gap = missingInput(input);
  if (gap) return { ...insufficient(input, gap), kind: 'purchase', ltlNet: null, upliftPct: null };

  const bedrooms = input.bedrooms!;
  const gross = input.grossRevenue!;
  const rent = input.marketRent!;
  const fixedCosts = fixedCostsFor(bedrooms);
  const strNet = round(gross.value * STR_NET_MULTIPLE);
  const ltlNet = round(rent.value * 12 * (1 - LTL_AGENT_FEE_RATE));
  const surplus = strNet - fixedCosts - ltlNet;
  const upliftPct = round1((surplus / ltlNet) * 100);
  const requiredGross = round(((1 + BUY_QUALIFIED_UPLIFT_PCT / 100) * ltlNet + fixedCosts) / STR_NET_MULTIPLE);
  const shortfall = round(gross.value) - requiredGross;
  const confidence = lowerConfidence(gross.confidence, rent.confidence);

  const byPct = upliftPct >= BUY_QUALIFIED_UPLIFT_PCT;
  const byAbsolute = !byPct && surplus >= ABSOLUTE_QUALIFIED_SURPLUS;
  const band: Band = byPct || byAbsolute ? 'qualified' : upliftPct >= BUY_MEDIUM_UPLIFT_PCT ? 'medium' : 'unqualified';

  const reason = byAbsolute
    ? `Short let nets ${gbp(surplus)} more a year than a long let — over the ${gbp(ABSOLUTE_QUALIFIED_SURPLUS)} cash bar despite a ${upliftPct}% uplift.`
    : band === 'qualified'
      ? `Short let nets ${upliftPct}% more than a long let, ${gbp(shortfall)} above the ${gbp(requiredGross)} needed.`
      : band === 'medium'
        ? `Only ${upliftPct}% ahead of a long let; ${gbp(Math.abs(shortfall))} short of the ${gbp(requiredGross)} needed to qualify.`
        : `Short let is ${upliftPct}% against a long let — ${gbp(Math.abs(shortfall))} short of the ${gbp(requiredGross)} needed.`;

  return {
    kind: 'purchase',
    band,
    bedrooms,
    bedroomsAssumed: false,
    fixedCosts,
    grossRevenue: gross,
    marketRent: rent,
    strNet,
    ltlNet,
    surplus,
    upliftPct,
    requiredGross,
    gap: shortfall,
    confidence,
    byAbsolute,
    reason,
  };
}

export function screenRentToRent(input: ScreenInput): RentToRentScreening {
  const gap = missingInput(input);
  if (gap) return { ...insufficient(input, gap), kind: 'rent-to-rent', annualRent: null, annualProfit: null, revenueMultiple: null };

  const bedrooms = input.bedrooms!;
  const gross = input.grossRevenue!;
  const rent = input.marketRent!;
  const fixedCosts = fixedCostsFor(bedrooms);
  const strNet = round(gross.value * STR_NET_MULTIPLE);
  // No agent fee: the operator pays the landlord's full asking rent.
  const annualRent = round(rent.value * 12);
  const annualProfit = strNet - annualRent - fixedCosts;
  const requiredGross = round((annualRent + fixedCosts + R2R_QUALIFIED_PROFIT) / STR_NET_MULTIPLE);
  const shortfall = round(gross.value) - requiredGross;
  const revenueMultiple = round2(gross.value / annualRent);
  const confidence = lowerConfidence(gross.confidence, rent.confidence);

  const byProfit = annualProfit >= R2R_QUALIFIED_PROFIT;
  // Intentionally redundant: £20,000 already clears £8,000. Kept so both kinds
  // run the same rule — see ABSOLUTE_QUALIFIED_SURPLUS.
  const byAbsolute = !byProfit && annualProfit >= ABSOLUTE_QUALIFIED_SURPLUS;
  const band: Band = byProfit || byAbsolute ? 'qualified' : annualProfit >= R2R_MEDIUM_PROFIT ? 'medium' : 'unqualified';

  const reason =
    band === 'qualified'
      ? `Clears ${gbp(annualProfit)} a year after rent and running costs, ${gbp(shortfall)} above the ${gbp(requiredGross)} needed, at ${revenueMultiple}× the rent.`
      : band === 'medium'
        ? `Makes ${gbp(annualProfit)} a year — under the ${gbp(R2R_QUALIFIED_PROFIT)} bar and ${gbp(Math.abs(shortfall))} short of the ${gbp(requiredGross)} needed.`
        : `Only ${gbp(annualProfit)} a year at ${revenueMultiple}× the rent — ${gbp(Math.abs(shortfall))} short of the ${gbp(requiredGross)} needed.`;

  return {
    kind: 'rent-to-rent',
    band,
    bedrooms,
    bedroomsAssumed: false,
    fixedCosts,
    grossRevenue: gross,
    marketRent: rent,
    strNet,
    annualRent,
    annualProfit,
    surplus: annualProfit,
    requiredGross,
    gap: shortfall,
    revenueMultiple,
    confidence,
    byAbsolute,
    reason,
  };
}

/** Screens a listing by its kind: a sale is a purchase, a rental is rent-to-rent. */
export function screen(kind: SourcingKind, input: ScreenInput): Screening {
  return kind === 'rent' ? screenRentToRent(input) : screenPurchase(input);
}

/** The headline figure for this kind, for a subject line or a sort. */
export function screeningScore(s: Screening): number | null {
  return s.kind === 'purchase' ? s.upliftPct : s.annualProfit;
}

/** One line for an email or a report row. */
export function describeScreening(s: Screening): string {
  if (s.band === 'insufficient-data') return BAND_LABELS[s.band];
  const headline = s.kind === 'purchase' ? `${s.upliftPct}% above a long let` : `${gbp(s.annualProfit!)}/yr profit`;
  return `${BAND_LABELS[s.band]} · ${headline}`;
}
