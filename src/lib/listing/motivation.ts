/**
 * How willing the other side looks to do a deal.
 *
 * The pick engine ranks on profitability alone: two listings with the same
 * yield score the same whether the seller went on the market yesterday or has
 * been stuck for eight months and cut the price twice. For a short-let
 * operator that difference is most of the negotiating margin, so this module
 * reads the evidence a listing already carries and turns it into a score plus
 * the reasons behind it.
 *
 * Two vocabularies, because a sale and a let are not the same problem. On a
 * sale we are looking for a motivated SELLER — time on market, reductions,
 * chain-free, probate, auction. On a let we are looking for a motivated
 * LANDLORD — a void that is already running, a short minimum term, flexible
 * wording, an incentive. Rental markets clear several times faster than sale
 * markets, so the same number of days means something quite different and the
 * member's threshold is set separately for each.
 *
 * Every signal carries a confidence. `firm` means a date or a recorded price
 * change; `soft` means wording, which is marketing copy and lies more often.
 * `firmScore` is reported separately so a hard filter can insist on evidence
 * rather than adjectives — and an age derived from our own first sighting is
 * only ever soft, because we may have started watching months late.
 *
 * Pure: no network, no database, no `server-only`. Same shape as
 * suitability.ts — a `judge`-style core with two entry points, one for the
 * search card and one for the fetched page.
 */
import { ageFromDates, listingAge, type SourcedListing, type SourcingKind, type ListingAge } from './sourcing.ts';
import type { ListingSnapshot } from './types.ts';
import { stripHtml } from './suitability.ts';

export type Confidence = 'firm' | 'soft';

interface SignalSpec {
  label: string;
  /** Points towards the 0–100 score when it fires. */
  weight: number;
  kinds: readonly SourcingKind[];
  /** What it is worth when nothing downgrades it. */
  confidence: Confidence;
}

const BOTH = ['sale', 'rent'] as const;
const SALE = ['sale'] as const;
const RENT = ['rent'] as const;

export const MOTIVATION_SIGNALS = {
  // ── Both ──
  long_on_market: { label: 'On the market a long time', weight: 30, kinds: BOTH, confidence: 'firm' },
  slower_than_area: { label: 'Slower than others in the area', weight: 15, kinds: BOTH, confidence: 'firm' },
  price_reduced: { label: 'Price reduced', weight: 25, kinds: BOTH, confidence: 'firm' },
  reduced_repeatedly: { label: 'Reduced more than once', weight: 15, kinds: BOTH, confidence: 'firm' },
  back_on_market: { label: 'Back on the market', weight: 20, kinds: BOTH, confidence: 'firm' },
  relisted_new_agent: { label: 'Relisted with a different agent', weight: 15, kinds: BOTH, confidence: 'firm' },

  // ── Sale: a motivated seller ──
  chain_free: { label: 'Chain free', weight: 10, kinds: SALE, confidence: 'soft' },
  vacant: { label: 'Empty and available now', weight: 15, kinds: SALE, confidence: 'soft' },
  urgent_sale: { label: 'Seller wants a quick sale', weight: 30, kinds: SALE, confidence: 'soft' },
  probate: { label: 'Probate or estate sale', weight: 25, kinds: SALE, confidence: 'soft' },
  auction: { label: 'For sale by auction', weight: 20, kinds: SALE, confidence: 'soft' },
  offers_invited: { label: 'Offers invited', weight: 10, kinds: SALE, confidence: 'soft' },
  portfolio_exit: { label: 'Landlord selling up', weight: 15, kinds: SALE, confidence: 'soft' },
  tenanted: { label: 'Sold with tenants in situ', weight: 10, kinds: SALE, confidence: 'soft' },
  short_lease: { label: 'Short lease', weight: 20, kinds: SALE, confidence: 'firm' },

  // ── Rent: a motivated landlord ──
  void_now: { label: 'Standing empty already', weight: 30, kinds: RENT, confidence: 'firm' },
  short_min_term: { label: 'Will take a short term', weight: 20, kinds: RENT, confidence: 'firm' },
  company_let: { label: 'Company let considered', weight: 30, kinds: RENT, confidence: 'soft' },
  flexible_terms: { label: 'Flexible on terms', weight: 25, kinds: RENT, confidence: 'soft' },
  incentive: { label: 'Offering an incentive', weight: 20, kinds: RENT, confidence: 'soft' },
  private_landlord: { label: 'Advertised by the landlord', weight: 15, kinds: RENT, confidence: 'soft' },
} as const satisfies Record<string, SignalSpec>;

export type MotivationSignal = keyof typeof MOTIVATION_SIGNALS;

export function isMotivationSignal(v: unknown): v is MotivationSignal {
  return typeof v === 'string' && v in MOTIVATION_SIGNALS;
}

export function motivationLabel(key: MotivationSignal): string {
  return MOTIVATION_SIGNALS[key].label;
}

// ── Wording ──
// Tight on purpose. A false positive here becomes a claim in a member's email
// that the listing does not support, which is worse than saying nothing. The
// auction pattern demands context for the same reason picks.ts does: plenty of
// ordinary homes sit on Auction Close or in The Auction House.

const CHAIN_FREE = /\bchain[- ]free\b|\bno (?:onward |forward )?chain\b|\bchain free\b/i;
const VACANT = /\bvacant (?:property|possession)\b|\bstanding empty\b|\bcurrently (?:empty|vacant)\b|\bempty property\b/i;
const URGENT_SALE = /\bquick sale\b|\bmust be sold\b|\bmust sell\b|\bneeds? a (?:quick|fast) sale\b|\bmotivated (?:seller|vendor)\b|\bkeen (?:seller|vendor)\b|\bseller is relocating\b|\bforced sale\b|\bpriced (?:to|for a quick) sell?\b/i;
// Same trap as the auction pattern: "Probate Lane" and "Executors Court" are
// addresses. A street type immediately after the word means it is part of one.
const STREET_AFTER = String.raw`(?!\s+(?:lane|road|street|close|avenue|drive|way|court|place|gardens?|crescent|walk|rise|grove|mews|terrace|park|hill|view))`;
const PROBATE = new RegExp(
  String.raw`\bprobate\b${STREET_AFTER}|\bdeceased (?:estate|owner)\b|\bexecutors?\b${STREET_AFTER}|\bestate of the late\b|\bletters of administration\b`,
  'i',
);
const AUCTION = /\b(?:by|via|at|for sale by) auction\b|\bmodern method of auction\b|\bauction (?:guide|lot)\b|\bunder the hammer\b/i;
const OFFERS_INVITED = /\boffers? (?:invited|considered|welcome|over|in excess of|in the region of)\b|\ball offers? considered\b|\bopen to offers\b|\bno reasonable offer refused\b/i;
const PORTFOLIO = /\bportfolio of \d+\b|\b\d+ (?:flats|houses|properties) (?:for sale|as a portfolio)\b|\binvestment portfolio\b|\blandlord (?:selling|retiring|exiting)\b/i;
const TENANTED = /\btenants? in situ\b|\bcurrently (?:tenanted|let)\b|\bsold with (?:a )?tenants?\b|\bwith sitting tenants?\b/i;

const COMPANY_LET = /\bcompany let\b|\bcorporate let\b|\bcompany (?:lets?|tenancy|tenancies) (?:considered|welcome|accepted)\b/i;
const FLEXIBLE_TERMS = /\bflexible (?:on |about )?(?:term|terms|length|tenancy)\b|\blong (?:let|term) preferred\b|\ball enquir(?:y|ies) considered\b|\bterms? negotiable\b|\bopen to (?:offers|terms)\b/i;
const INCENTIVE = /\brent[- ]free (?:period|month)\b|\bno deposit\b|\bzero deposit\b|\bfirst month (?:free|half price|reduced)\b|\bmove[- ]in incentive\b|\breduced rent for\b/i;
const PRIVATE_LANDLORD = /\bprivate landlord\b|\blandlord direct\b|\bdirect from (?:the )?landlord\b|\bno agent(?:s| fees)?\b/i;

/** Below this a lease is a mortgage problem, so the pool of buyers collapses. */
export const SHORT_LEASE_YEARS = 80;
/** A listing this much past its area's median is slow for the area, not the market. */
export const SLOWER_THAN_AREA_RATIO = 1.5;
/** A minimum term at or under this says the landlord will already discuss a short let. */
export const SHORT_TERM_MONTHS = 3;

export interface MotivationFacts {
  kind: SourcingKind;
  /** Title, type, qualifier, features and (after a page read) the description. */
  text: string;
  /** How long it has been up, and whether that is the portal's answer or ours. */
  age: ListingAge | null;
  /** The member's "too long" line, in days. */
  thresholdDays: number;
  /** Median age of the same kind in the same area, or null below a real sample. */
  areaMedianDays: number | null;
  /** OnTheMarket's card bucket, verbatim ("Added > 14 days", "Reduced < 14 days"). */
  addedOrReduced: string | null;
  /** Rightmove's listing history. */
  listingUpdate: { reason: 'added' | 'reduced' | 'increased'; on: string | null } | null;
  /** How many reductions we have recorded ourselves. */
  reductions: number;
  /** Whether the listing has come back after being under offer or delisted. */
  backOnMarket: boolean;
  /** True when the agent digest differs from the one we saw last time. */
  agentChanged: boolean;
  /** Sale: years left on the lease, when stated. */
  yearsRemainingOnLease: number | null;
  /** Rent: when the property is free (ISO), and the shortest term offered. */
  letAvailableDate: string | null;
  minimumTermInMonths: number | null;
  /** Rent: false when the listing names no agent. Null when we cannot tell. */
  hasAgent: boolean | null;
  now: Date;
}

export interface Motivation {
  /** 0–100, every signal that fired. */
  score: number;
  /** 0–100 counting only dates and recorded price changes. */
  firmScore: number;
  fired: MotivationSignal[];
}

export const NO_MOTIVATION: Motivation = { score: 0, firmScore: 0, fired: [] };

function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 86_400_000);
}

/** The verdict from whatever facts are in hand. */
export function judgeMotivation(f: MotivationFacts): Motivation {
  const text = stripHtml(f.text);
  const fired: { key: MotivationSignal; confidence: Confidence }[] = [];
  const fire = (key: MotivationSignal, confidence?: Confidence) => {
    const spec = MOTIVATION_SIGNALS[key];
    if (!(spec.kinds as readonly string[]).includes(f.kind)) return;
    if (fired.some((x) => x.key === key)) return;
    fired.push({ key, confidence: confidence ?? spec.confidence });
  };

  // ── Time ──
  // An age we derived from our own first sighting is a floor, never the age, so
  // it can raise the score but must never count as firm evidence.
  if (f.age) {
    const ageConfidence: Confidence = f.age.source === 'portal' ? 'firm' : 'soft';
    if (f.age.days >= f.thresholdDays) fire('long_on_market', ageConfidence);
    if (f.areaMedianDays !== null && f.age.days >= f.areaMedianDays * SLOWER_THAN_AREA_RATIO) {
      fire('slower_than_area', ageConfidence);
    }
  }

  // ── Price movement ──
  if (f.listingUpdate?.reason === 'reduced') fire('price_reduced');
  if (/^reduced/i.test(f.addedOrReduced ?? '')) fire('price_reduced');
  if (f.reductions >= 1) fire('price_reduced');
  if (f.reductions >= 2) fire('reduced_repeatedly');
  if (f.backOnMarket) fire('back_on_market');
  if (f.agentChanged) fire('relisted_new_agent');

  // ── Sale wording ──
  if (CHAIN_FREE.test(text)) fire('chain_free');
  if (VACANT.test(text)) fire('vacant');
  if (URGENT_SALE.test(text)) fire('urgent_sale');
  if (PROBATE.test(text)) fire('probate');
  if (AUCTION.test(text)) fire('auction');
  if (OFFERS_INVITED.test(text)) fire('offers_invited');
  if (PORTFOLIO.test(text)) fire('portfolio_exit');
  if (TENANTED.test(text)) fire('tenanted');
  if (f.yearsRemainingOnLease !== null && f.yearsRemainingOnLease > 0 && f.yearsRemainingOnLease < SHORT_LEASE_YEARS) {
    fire('short_lease');
  }

  // ── Let wording ──
  // A date already past is a property standing empty right now, which is the
  // landlord's problem and the operator's opening.
  const untilFree = daysUntil(f.letAvailableDate, f.now);
  if (untilFree !== null && untilFree <= 0) fire('void_now');
  if (f.minimumTermInMonths !== null && f.minimumTermInMonths > 0 && f.minimumTermInMonths <= SHORT_TERM_MONTHS) {
    fire('short_min_term');
  }
  if (COMPANY_LET.test(text)) fire('company_let');
  if (FLEXIBLE_TERMS.test(text)) fire('flexible_terms');
  if (INCENTIVE.test(text)) fire('incentive');
  if (PRIVATE_LANDLORD.test(text) || f.hasAgent === false) fire('private_landlord');

  const total = (only?: Confidence) =>
    Math.min(
      100,
      fired.reduce((sum, x) => (only && x.confidence !== only ? sum : sum + MOTIVATION_SIGNALS[x.key].weight), 0),
    );

  // Strongest first, so the email leads with the best reason rather than the
  // first one the checks happened to reach.
  const order = [...fired].sort((a, b) => MOTIVATION_SIGNALS[b.key].weight - MOTIVATION_SIGNALS[a.key].weight);
  return { score: total(), firmScore: total('firm'), fired: order.map((x) => x.key) };
}

/** What the caller knows that the listing itself does not carry. */
export interface MotivationContext {
  thresholdDays: number;
  areaMedianDays?: number | null;
  firstSeenAt?: string | null;
  age?: ListingAge | null;
  reductions?: number;
  backOnMarket?: boolean;
  /** The agent digest we last saw for this property, if any. */
  previousAgentHash?: string | null;
  now?: Date;
}

function baseFacts(ctx: MotivationContext, kind: SourcingKind, agentHash: string | null | undefined): Omit<MotivationFacts, 'text' | 'age' | 'addedOrReduced' | 'listingUpdate' | 'yearsRemainingOnLease' | 'letAvailableDate' | 'minimumTermInMonths' | 'hasAgent'> {
  return {
    kind,
    thresholdDays: ctx.thresholdDays,
    areaMedianDays: ctx.areaMedianDays ?? null,
    reductions: ctx.reductions ?? 0,
    backOnMarket: ctx.backOnMarket ?? false,
    // Only a change between two known agents counts. A digest appearing where
    // there was none before is us learning the agent, not the seller changing it.
    agentChanged: Boolean(ctx.previousAgentHash && agentHash && ctx.previousAgentHash !== agentHash),
    now: ctx.now ?? new Date(),
  };
}

/** Judge a search-result listing: cheap, and blind to anything only the page says. */
export function motivationFromListing(l: SourcedListing, ctx: MotivationContext): Motivation {
  const now = ctx.now ?? new Date();
  return judgeMotivation({
    ...baseFacts(ctx, l.kind, l.agentHash),
    text: [l.title, l.rawType, l.priceQualifier ?? null, l.tenure ?? null, ...(l.features ?? [])].filter(Boolean).join(' | '),
    age: ctx.age ?? listingAge(l, ctx.firstSeenAt ?? null, now),
    addedOrReduced: l.addedOrReduced ?? null,
    listingUpdate: null,
    yearsRemainingOnLease: null,
    letAvailableDate: null,
    minimumTermInMonths: null,
    hasAgent: null,
    now,
  });
}

/** Judge the fetched page: the description, the listing history and the let terms. */
export function motivationFromSnapshot(s: ListingSnapshot, kind: SourcingKind, ctx: MotivationContext): Motivation {
  const now = ctx.now ?? new Date();
  const age = ctx.age ?? ageFromDates(s.listedDate, ctx.firstSeenAt ?? null, now);
  return judgeMotivation({
    ...baseFacts(ctx, kind, s.agentHash),
    text: [s.title, s.rawType ?? null, s.price?.qualifier ?? null, s.tenure ?? null, ...s.features].filter(Boolean).join(' | '),
    age,
    addedOrReduced: null,
    listingUpdate: s.listingUpdate ?? null,
    yearsRemainingOnLease: s.yearsRemainingOnLease ?? null,
    letAvailableDate: s.letAvailableDate ?? null,
    minimumTermInMonths: s.minimumTermInMonths ?? null,
    hasAgent: s.agentHash === undefined ? null : s.agentHash !== null,
    now,
  });
}
