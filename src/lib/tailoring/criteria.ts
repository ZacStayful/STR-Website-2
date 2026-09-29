/**
 * Part A: a member's answers as checks on a deal. Each check is a must-have
 * (a deal that fails it is not shown) or a nice-to-have (a deal that misses
 * it only moves down). The member sets which, per profile; these are the
 * defaults.
 *
 *   Criterion        Answer                                Deal figure                          Default  Kind
 *   location         where: near / areas (and pre-quiz)    its postcode area                    must     both
 *   budget           the budget band                       the asking price                     must     buy
 *   cash             cash available (top of the band)      deposit + stamp duty + setup at      must     buy
 *                                                          the member's deposit
 *   rent             max rent (or a client's rent)         the rent a month                     must     rent
 *   profit           minimum profit (a real answer only)   the LOW end of Batch 10's profit     must     both
 *                                                          range at the member's finance
 *   bedrooms         bedrooms (4 = 4 or more)              bedrooms                             nice     both
 *   type             flat or house                         the listing's type                   nice     buy
 *   leasehold        "Leasehold OK?" = no                  tenure                               nice     buy
 *   restricted       restricted areas = avoid              the area's short-let licensing       nice     buy
 *   setup            setup budget (top of the band)        setup cost                           nice     rent
 *   breakeven        break-even occupancy                  break-even occupancy                 nice     rent
 *   payback          payback months                        payback months                       nice     rent
 *   motivation       motivated sellers: only / prefer      the member's own "motivated" test    the answer
 *
 * Unknown never removes a deal: a deal whose figure is missing is shown with
 * the check marked unknown ("Tenure unknown: check"), and counts as not met.
 * Each kind is judged by its own answers only: a budget never judges a
 * rental, and a rent ceiling never judges a sale.
 *
 * Only answers to questions the profile is asked count (profile.ts asked), so
 * an answer left behind on another path judges nothing. Condition, furnished
 * and deal structure are stored but judge nothing: no deal carries them.
 *
 * Pure: no network, no database, no server-only.
 */
import { purchaseDeal, type Deal } from '../listing/deal.ts';
import { NEEDS_WORK } from '../listing/picks.ts';
import { budgetBounds, rentPcm, type SourcedListing } from '../listing/sourcing.ts';
import { propertyKind } from '../listing/suitability.ts';
import type { Screening } from '../listing/screen.ts';
import type { Motivation } from '../listing/motivation.ts';
import { getLicensing, type LicensingStatus } from '../data/str-licensing.ts';
import { goalAreas } from '../onboarding/deal-filters.ts';
import { placedForPreview } from '../profile/matching.ts';
import type { QuestionId } from '../profile/questions.ts';
import { profitRange, type ProfitRange } from '../marketplace/profit-range.ts';
import { memberFinance } from '../marketplace/most-you-can-pay.ts';
import type { DealCard } from '../marketplace/grid.ts';
import { TAILORING } from './config.ts';
import { asked, realAnswer, usesTailoring, type CriterionKey, type Mode, type TailoringProfile } from './profile.ts';

export type Verdict = 'pass' | 'fail' | 'unknown';

export interface CriterionSpec {
  /** For the profile page's switch and the widen suggestions. */
  label: string;
  /** The deal kinds it judges. */
  kinds: readonly ('sale' | 'rent')[];
  defaultMode: Mode;
  /** The quiz questions that set it: the profile page shows the switch beside these. */
  questions: readonly QuestionId[];
}

export const CRITERIA: Record<CriterionKey, CriterionSpec> = {
  location: { label: 'Location', kinds: ['sale', 'rent'], defaultMode: 'must', questions: ['where'] },
  budget: { label: 'Budget', kinds: ['sale'], defaultMode: 'must', questions: ['budget'] },
  cash: { label: 'Cash available', kinds: ['sale'], defaultMode: 'must', questions: ['cash_available'] },
  rent: { label: 'Rent', kinds: ['rent'], defaultMode: 'must', questions: ['max_rent'] },
  profit: { label: 'Minimum profit', kinds: ['sale', 'rent'], defaultMode: 'must', questions: ['min_profit', 'r2r_min_profit'] },
  bedrooms: { label: 'Bedrooms', kinds: ['sale', 'rent'], defaultMode: 'nice', questions: ['bedrooms'] },
  type: { label: 'Flat or house', kinds: ['sale'], defaultMode: 'nice', questions: ['property_type'] },
  leasehold: { label: 'No leasehold', kinds: ['sale'], defaultMode: 'nice', questions: ['leasehold'] },
  restricted: { label: 'No short-let restrictions', kinds: ['sale'], defaultMode: 'nice', questions: ['restricted_areas'] },
  setup: { label: 'Setup budget', kinds: ['rent'], defaultMode: 'nice', questions: ['setup_budget'] },
  breakeven: { label: 'Break-even occupancy', kinds: ['rent'], defaultMode: 'nice', questions: ['break_even'] },
  payback: { label: 'Payback', kinds: ['rent'], defaultMode: 'nice', questions: ['payback'] },
  motivation: { label: 'Motivated sellers', kinds: ['sale', 'rent'], defaultMode: 'nice', questions: ['motivated_sellers'] },
};

/** The criterion a quiz question sets, for the profile page. */
export function criterionForQuestion(id: QuestionId): CriterionKey | null {
  for (const [key, spec] of Object.entries(CRITERIA) as [CriterionKey, CriterionSpec][]) if (spec.questions.includes(id)) return key;
  return null;
}

/** What the member asked for, read once per profile. Null or false: they did not ask, and the check is not made. */
export interface Wants {
  /** Postcode areas that count as where they look; null: anywhere. */
  areas: ReadonlySet<string> | null;
  /** "Near me + the best elsewhere": the areas that count as near. Not a check: it decides the local and national slots. */
  localAreas: ReadonlySet<string> | null;
  /** Their home, placed (its own point, else its postcode area's centre): "about N miles away". */
  home: { lat: number; lng: number } | null;
  budget: { min: number | null; max: number | null } | null;
  cashTop: number | null;
  rentMax: number | null;
  /** The buyer's minimum profit a month: judges Buy-and-let and BRRR deals. */
  minProfit: number | null;
  /** Batch 17: the rent-to-rent minimum, its own answer now (it used to overwrite the buyer's): judges rentals. */
  minProfitR2r: number | null;
  bedrooms: 1 | 2 | 3 | 4 | null;
  propertyType: 'flat' | 'house' | null;
  noLeasehold: boolean;
  /** "Avoid them" is a check; "show them with a warning" only adds the warning. */
  restricted: 'avoid' | 'warn' | null;
  setupTop: number | null;
  breakEvenMax: number | null;
  paybackMax: number | null;
  motivation: 'only' | 'prefer' | null;
}

export const NO_WANTS: Wants = {
  areas: null,
  localAreas: null,
  home: null,
  budget: null,
  cashTop: null,
  rentMax: null,
  minProfit: null,
  minProfitR2r: null,
  bedrooms: null,
  propertyType: null,
  noLeasehold: false,
  restricted: null,
  setupTop: null,
  breakEvenMax: null,
  paybackMax: null,
  motivation: null,
};

const set = (codes: string[]): ReadonlySet<string> | null => (codes.length > 0 ? new Set(codes) : null);

export function wantsFor(p: TailoringProfile): Wants {
  const g = p.goals;
  if (!g) return NO_WANTS;
  const placed = placedForPreview(g);
  const home = placed.home && placed.home.lat !== null && placed.home.lng !== null ? { lat: placed.home.lat, lng: placed.home.lng } : null;
  let areas: ReadonlySet<string> | null = null;
  let localAreas: ReadonlySet<string> | null = null;
  if (g.where === 'near' || g.where === 'areas') areas = set(goalAreas(placed, p.savedAreas));
  else if (g.where === 'near_plus_best') localAreas = set(goalAreas(placed, p.savedAreas));
  else if (g.where === null) {
    // Answered before the quiz: the saved areas, and around the home only
    // with a radius. A home with "anywhere is fine" is not a place to stay
    // inside (the untailored path keeps only the home's own area for it).
    areas = set(goalAreas(g.maxDistanceMiles ? placed : { ...placed, home: null }, p.savedAreas));
  }
  const buyProfit = asked(p, 'min_profit') && realAnswer(p, 'min_profit');
  const r2rProfit = asked(p, 'r2r_min_profit') && realAnswer(p, 'r2r_min_profit');
  const b = g.buyer;
  const r = g.r2r;
  return {
    areas,
    localAreas,
    home,
    budget: g.budget ? budgetBounds(g.budget) : null,
    cashTop: asked(p, 'cash_available') && b.cashAvailable ? TAILORING.cashAvailableTop[b.cashAvailable] : null,
    rentMax: g.maxRentPcm,
    minProfit: buyProfit ? g.finance.targetMarginPcm : null,
    // Answered before the split, the one figure stood for both.
    minProfitR2r: r2rProfit ? (g.r2r.minMarginPcm ?? g.finance.targetMarginPcm) : null,
    bedrooms: g.bedrooms,
    propertyType: asked(p, 'property_type') && (b.propertyType === 'flat' || b.propertyType === 'house') ? b.propertyType : null,
    noLeasehold: asked(p, 'leasehold') && b.leaseholdOk === 'no',
    restricted: asked(p, 'restricted_areas') ? b.restrictedAreas : null,
    setupTop: asked(p, 'setup_budget') && r.setupBudget ? TAILORING.setupBudgetTop[r.setupBudget] : null,
    breakEvenMax: asked(p, 'break_even') ? r.breakEvenOccupancyPct : null,
    paybackMax: asked(p, 'payback') ? r.paybackMonths : null,
    motivation: g.motivation.mode === 'off' ? null : g.motivation.mode,
  };
}

/** The checks this profile's answers make at all: the ones its profile page offers a switch for. */
export function activeCriteria(w: Wants): Set<CriterionKey> {
  const on: [CriterionKey, boolean][] = [
    ['location', w.areas !== null],
    ['budget', w.budget !== null],
    ['cash', w.cashTop !== null],
    ['rent', w.rentMax !== null],
    ['profit', w.minProfit !== null || w.minProfitR2r !== null],
    ['bedrooms', w.bedrooms !== null],
    ['type', w.propertyType !== null],
    ['leasehold', w.noLeasehold],
    ['restricted', w.restricted === 'avoid'],
    ['setup', w.setupTop !== null],
    ['breakeven', w.breakEvenMax !== null],
    ['payback', w.paybackMax !== null],
    ['motivation', w.motivation !== null],
  ];
  return new Set(on.filter(([, active]) => active).map(([k]) => k));
}

/** Answers the quiz keeps that no deal carries yet: stored, shown, and judged on nothing. */
export const NOT_APPLIED: readonly QuestionId[] = ['brrr_work', 'furnished', 'deal_structure'];

/** A deal as the checks read it: public columns and stored figures only, nothing a member pays to see. */
export interface DealFacts {
  kind: 'sale' | 'rent';
  area: string | null;
  bedrooms: number | null;
  /** Sale: the asking price. Rent: £ a month. */
  amount: number | null;
  propertyKind: 'flat' | 'house' | 'unknown';
  tenure: 'freehold' | 'leasehold' | 'unknown';
  licensing: LicensingStatus;
  /** The screening's short-let revenue for the area and size (or the deal's own check, Batch 16), £/yr, and its confidence. */
  grossRevenue: number | null;
  confidence: string | null;
  /** Batch 16: the comparables the deal's own check kept, when it has one; absent or null on the area's average. */
  compCount?: number | null;
  /** The stored deal figures (house finance): a rental's setup cost, break-even and payback. */
  deal: Deal | null;
  /** The member's own motivated-seller test (candidates.ts buildCandidate); undefined when they did not ask. */
  motivationQualifies: boolean | undefined;
  /** 0–100, every motivation signal that fired. */
  motivationScore: number;
  /** Renovation or auction wording in what the deal says about itself (its type, title, features, or an auction signal). */
  needsWork: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** "Freehold", "Leasehold", "Share of freehold", "Ask agent": only the first two are known answers. */
export function tenureOf(raw: string | null | undefined): DealFacts['tenure'] {
  const t = (raw ?? '').trim().toLowerCase();
  if (t.startsWith('freehold')) return 'freehold';
  if (t.startsWith('leasehold')) return 'leasehold';
  return 'unknown';
}

type RowForFacts = Pick<DealCard, 'kind' | 'postcode_area' | 'bedrooms' | 'price_amount' | 'price_period' | 'raw_type' | 'tenure' | 'screening_gross' | 'screening_confidence' | 'check_comps'>;

/** A marketplace row (Today's pool, the grid) as facts. */
export function factsFromRow(row: RowForFacts, deal: Deal | null, motivation: { qualifies: boolean | undefined; score: number; fired?: readonly string[] }): DealFacts {
  const price = num(row.price_amount);
  const period = row.price_period === 'pw' || row.price_period === 'pcm' || row.price_period === 'total' ? row.price_period : row.kind === 'rent' ? 'pcm' : 'total';
  const amount = price === null || price <= 0 ? null : row.kind === 'rent' ? rentPcm({ amount: price, period }) : period === 'total' ? price : null;
  const area = row.postcode_area ? row.postcode_area.toUpperCase() : null;
  return {
    kind: row.kind,
    area,
    bedrooms: row.bedrooms,
    amount,
    propertyKind: propertyKind(row.raw_type, null),
    tenure: tenureOf(row.tenure),
    licensing: getLicensing(area).status,
    grossRevenue: num(row.screening_gross),
    confidence: row.screening_confidence ?? null,
    compCount: num(row.check_comps),
    deal,
    motivationQualifies: motivation.qualifies,
    motivationScore: motivation.score,
    needsWork: NEEDS_WORK.test(row.raw_type ?? '') || (motivation.fired ?? []).includes('auction'),
  };
}

/**
 * A rental's stored figures as the card carries them (CARD_COLUMNS' JSON
 * paths): enough of the deal for its setup, break-even and payback checks.
 * Null for a sale, or a rental whose row has none.
 */
export function rentalFromCard(card: Pick<DealCard, 'kind' | 'deal_setup' | 'deal_breakeven' | 'deal_payback' | 'deal_margin'>): Deal | null {
  if (card.kind !== 'rent') return null;
  const setup = num(card.deal_setup);
  const margin = num(card.deal_margin);
  if (setup === null && margin === null) return null;
  return { kind: 'rent-to-rent', setupCost: setup ?? 0, breakevenOccupancyPct: num(card.deal_breakeven), paybackMonths: num(card.deal_payback), monthlyMargin: margin ?? 0 } as Deal;
}

/** A listing the daily picks run found (a search result or a pool deal) as facts. */
export function factsFromListing(l: SourcedListing, deal: Deal | null, screening: Screening | null | undefined, motivation: { qualifies: boolean | undefined; score: number; fired?: readonly string[] }): DealFacts {
  const amount = l.price ? (l.kind === 'rent' ? rentPcm(l.price) : l.price.period === 'total' ? l.price.amount : null) : null;
  const area = l.postcodeArea ? l.postcodeArea.toUpperCase() : null;
  return {
    kind: l.kind,
    area,
    bedrooms: l.bedrooms,
    amount: amount !== null && amount > 0 ? amount : null,
    propertyKind: propertyKind(l.rawType, l.title),
    tenure: tenureOf(l.tenure),
    licensing: getLicensing(area).status,
    grossRevenue: num(screening?.grossRevenue?.value),
    confidence: screening?.confidence ?? null,
    deal,
    motivationQualifies: motivation.qualifies,
    motivationScore: motivation.score,
    needsWork: NEEDS_WORK.test([l.title, l.rawType ?? '', l.priceQualifier ?? '', ...(l.features ?? [])].join(' | ')) || (motivation.fired ?? []).includes('auction'),
  };
}

/** The member's own figures for a deal: the same model the card and the sheet show. */
export interface MemberFigures {
  /** Batch 10's area-estimate profit range at the member's finance. */
  range: ProfitRange | null;
  /** A purchase at the member's deposit: deposit + stamp duty + setup. */
  cashRequired: number | null;
  cashOnCashPct: number | null;
  /** A rental's setup cost, break-even occupancy (%) and months to pay the setup back. */
  setupCost: number | null;
  breakEvenPct: number | null;
  paybackMonths: number | null;
}

export function memberFigures(f: DealFacts, p: Pick<TailoringProfile, 'goals' | 'widths'>): MemberFigures {
  // A cash buyer's figures carry no mortgage, as "Most you can pay" carries none.
  const finance = memberFinance(p.goals);
  const range =
    f.amount === null
      ? null
      : profitRange({ kind: f.kind, priceAmount: f.amount, pricePeriod: f.kind === 'rent' ? 'pcm' : 'total', bedrooms: f.bedrooms, grossRevenue: f.grossRevenue, confidence: f.confidence, finance, widths: p.widths });
  if (f.kind === 'sale') {
    if (f.amount === null) return { range, cashRequired: null, cashOnCashPct: null, setupCost: null, breakEvenPct: null, paybackMonths: null };
    // Cash needed does not depend on the income: it is worked out even when the screening has none.
    const model = purchaseDeal(f.amount, { grossRevenue: f.grossRevenue ?? 0, adr: 0, bedrooms: f.bedrooms ?? 2, finance: finance ?? undefined });
    return { range, cashRequired: model.cashRequired, cashOnCashPct: f.grossRevenue !== null && f.grossRevenue > 0 ? model.cashOnCashPct : null, setupCost: model.setupCost, breakEvenPct: null, paybackMonths: null };
  }
  const d = f.deal?.kind === 'rent-to-rent' ? f.deal : null;
  return { range, cashRequired: null, cashOnCashPct: null, setupCost: d ? d.setupCost : null, breakEvenPct: d ? d.breakevenOccupancyPct : null, paybackMonths: d ? d.paybackMonths : null };
}

export interface Check {
  key: CriterionKey;
  mode: Mode;
  verdict: Verdict;
}

/** The mode a criterion has for this profile: the member's override, else the default; motivated sellers from the answer itself. */
export function modeOf(key: CriterionKey, p: Pick<TailoringProfile, 'modes' | 'goals'>): Mode {
  if (key === 'motivation') return p.goals?.motivation.mode === 'only' ? 'must' : 'nice';
  return p.modes[key] ?? CRITERIA[key].defaultMode;
}

const within = (n: number, b: { min: number | null; max: number | null }) => (b.min === null || n >= b.min) && (b.max === null || n <= b.max);
const atMost = (n: number | null, top: number): Verdict => (n === null ? 'unknown' : n <= top ? 'pass' : 'fail');

/** The minimum profit that judges this deal: a rental's own, else the buyer's. */
export function minProfitFor(f: Pick<DealFacts, 'kind'>, w: Pick<Wants, 'minProfit' | 'minProfitR2r'>): number | null {
  return f.kind === 'rent' ? w.minProfitR2r : w.minProfit;
}

/** Every check the member's answers make on this deal, in CRITERIA order. */
export function checksFor(f: DealFacts, fig: MemberFigures, w: Wants, mode: (key: CriterionKey) => Mode): Check[] {
  const out: Check[] = [];
  const push = (key: CriterionKey, verdict: Verdict) => out.push({ key, mode: mode(key), verdict });
  if (w.areas) push('location', f.area === null ? 'unknown' : w.areas.has(f.area) ? 'pass' : 'fail');
  if (f.kind === 'sale') {
    if (w.budget) push('budget', f.amount === null ? 'unknown' : within(f.amount, w.budget) ? 'pass' : 'fail');
    if (w.cashTop !== null) push('cash', atMost(fig.cashRequired, w.cashTop));
  } else if (w.rentMax !== null) push('rent', atMost(f.amount, w.rentMax));
  const minProfit = minProfitFor(f, w);
  if (minProfit !== null) push('profit', fig.range === null ? 'unknown' : fig.range.lowPcm >= minProfit ? 'pass' : 'fail');
  if (w.bedrooms !== null) push('bedrooms', f.bedrooms === null ? 'unknown' : (w.bedrooms === 4 ? f.bedrooms >= 4 : f.bedrooms === w.bedrooms) ? 'pass' : 'fail');
  if (f.kind === 'sale') {
    if (w.propertyType) push('type', f.propertyKind === 'unknown' ? 'unknown' : f.propertyKind === w.propertyType ? 'pass' : 'fail');
    if (w.noLeasehold) push('leasehold', f.tenure === 'unknown' ? 'unknown' : f.tenure === 'leasehold' ? 'fail' : 'pass');
    if (w.restricted === 'avoid') push('restricted', f.licensing === 'confirmed-licensed' ? 'fail' : f.licensing === 'confirmed-unrestricted' ? 'pass' : 'unknown');
  } else {
    if (w.setupTop !== null) push('setup', atMost(fig.setupCost, w.setupTop));
    if (w.breakEvenMax !== null) push('breakeven', atMost(fig.breakEvenPct, w.breakEvenMax));
    if (w.paybackMax !== null) {
      // No payback at all (the margin is not positive) is a miss, not an unknown.
      const never = fig.paybackMonths === null && f.deal?.kind === 'rent-to-rent' && f.deal.monthlyMargin <= 0;
      push('payback', never ? 'fail' : atMost(fig.paybackMonths, w.paybackMax));
    }
  }
  // "Motivated" needs evidence: no signal is a miss, as it always was.
  if (w.motivation) push('motivation', f.motivationQualifies === true ? 'pass' : 'fail');
  return out;
}

/** What the checks add up to, for the list (must-haves), the order (missed, met) and the card (match %). */
export interface Judgement {
  checks: Check[];
  /** Must-haves the deal fails: it is not shown. */
  mustFails: CriterionKey[];
  /** Must-haves the deal cannot be judged on: shown, and flagged. */
  mustUnknown: CriterionKey[];
  /** Nice-to-haves it misses (unknown is not a miss, and not a meet). */
  niceMissed: number;
  /** Every check it passes, must-haves and nice-to-haves alike. */
  met: number;
  unknown: number;
  checked: number;
}

export function judge(checks: Check[]): Judgement {
  return {
    checks,
    mustFails: checks.filter((c) => c.mode === 'must' && c.verdict === 'fail').map((c) => c.key),
    mustUnknown: checks.filter((c) => c.mode === 'must' && c.verdict === 'unknown').map((c) => c.key),
    niceMissed: checks.filter((c) => c.mode === 'nice' && c.verdict === 'fail').length,
    met: checks.filter((c) => c.verdict === 'pass').length,
    unknown: checks.filter((c) => c.verdict === 'unknown').length,
    checked: checks.length,
  };
}

/** One deal judged for one profile, from its facts. */
export function judgeDeal(f: DealFacts, p: TailoringProfile, w: Wants = wantsFor(p)): { judgement: Judgement; figures: MemberFigures } {
  const figures = memberFigures(f, p);
  return { judgement: judge(checksFor(f, figures, w, (key) => modeOf(key, p))), figures };
}

/** A listing the daily picks run is weighing, as far as the must-haves read it. */
export interface PickCandidateLike {
  listing: SourcedListing;
  deal: Deal | null;
  screening?: Screening | null;
  motivation?: Motivation | null;
  motivationQualifies?: boolean;
}

/**
 * For the daily picks run: whether a candidate meets every must-have of a
 * tailored profile, so a member is never charged for a deal their Today
 * would not show. Null when the profile is not tailored: nothing to test,
 * the run is exactly as before.
 */
export function mustHaveTest(p: TailoringProfile | null | undefined): ((c: PickCandidateLike) => boolean) | null {
  if (!usesTailoring(p)) return null;
  const w = wantsFor(p);
  return (c) => judgeDeal(factsFromListing(c.listing, c.deal, c.screening, { qualifies: c.motivationQualifies, score: c.motivation?.score ?? 0, fired: c.motivation?.fired }), p, w).judgement.mustFails.length === 0;
}
