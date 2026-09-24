/**
 * Daily picks: the pure half of "one sourced property a day". The cron
 * (src/app/api/internal/sourcing/route.ts) decides who gets what; this module
 * builds the house queries for members without a filter, turns feedback into
 * query and candidate rules, renders the pick email, and summarises picks for
 * the admin report. Nothing here touches the network or the database, so it
 * runs under `node --test`.
 */
import { randomBytes } from 'node:crypto';
import type { MarketGoals } from '../market/goals.ts';
import { DEFAULT_GOALS } from '../market/goals.ts';
import { budgetBounds, describeDeal, queryKey, type SourcedListing, type SourcedPick, type SourcingKind, type SourcingQuery } from './sourcing.ts';
import { formatListingPrice } from './format.ts';
import { escapeHtml as esc } from '../email/escape.ts';
import { priceFor } from '../credit/pricing.ts';
import type { UnitCostTable } from '../credit/costs.ts';
import type { Deal } from './deal.ts';
import { propertyKind } from './suitability.ts';
import { BAND_LABELS, screeningScore, screeningWorking, type Screening } from './screen.ts';
import { motivationLabel, type Motivation } from './motivation.ts';

export type PickBasis = 'goals' | 'house';
export type PickStatus = 'pending' | 'sent' | 'failed';
export type PickReaction = 'yes' | 'no';
export type ReactionSource = 'link' | 'form';

// ── Tokens and time ──

/** Same shape as a deal-sheet share token (24 random bytes, base64url). */
export const PICK_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

export function isPickToken(v: unknown): v is string {
  return typeof v === 'string' && PICK_TOKEN.test(v);
}

export function newPickToken(): string {
  return randomBytes(24).toString('base64url');
}

export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ── Price of a pick ──

export const PICK_UNIT = { provider: 'pmi', unit: 'daily_pick' } as const;

/** What one pick costs the member, in base pence (raw unit cost × markup). */
export function pickPrice(table: UnitCostTable) {
  return priceFor(table, PICK_UNIT.provider, PICK_UNIT.unit, 1);
}

// ── House queries (members without a usable filter) ──

/** The few card fields the house pick needs; structurally matches AreaCardData. */
export interface HouseAreaCard {
  code: string;
  name: string;
  slug: string;
  score: { score: number } | null;
  confidence: { tier: 'confirmed' | 'building' | 'early' };
}

export const HOUSE_AREAS = 8;

/**
 * The best-scored areas Stayful has real data for, as searches. With goals
 * (a member whose filter names no areas) the member's own kind, budget and
 * bedrooms apply; without, both kinds and no bounds, so the reply to the
 * email ("want to buy / want to rent") can tell us which they meant.
 */
export function houseQueries(cards: HouseAreaCard[], goals: MarketGoals | null, limit = HOUSE_AREAS): SourcingQuery[] {
  const g = goals ?? DEFAULT_GOALS;
  const kinds: SourcingKind[] = goals ? (g.sourcingKind === 'both' ? ['sale', 'rent'] : [g.sourcingKind]) : ['sale', 'rent'];
  const bounds = goals ? budgetBounds(g.budget) : { min: null, max: null };
  const minBedrooms = goals ? g.bedrooms ?? null : null;
  const areas = cards
    .filter((c) => c.score !== null && c.confidence.tier !== 'early')
    .sort((a, b) => b.score!.score - a.score!.score)
    .slice(0, limit);
  const out: SourcingQuery[] = [];
  for (const a of areas) {
    for (const kind of kinds) {
      const minPrice = kind === 'sale' ? bounds.min : null;
      const maxPrice = kind === 'sale' ? bounds.max : goals ? g.maxRentPcm ?? null : null;
      out.push({ key: queryKey(kind, a.code, minPrice, maxPrice, minBedrooms), kind, area: a.code, areaName: a.name, areaSlug: a.slug, minPrice, maxPrice, minBedrooms });
    }
  }
  return out;
}

// ── Feedback ──

/**
 * Why a member said no. Every reason is data for the admin report; most
 * also change what that member is sent next (`effect`), which the response
 * page tells them so the question feels worth answering.
 */
export const REASON_GROUPS = [
  { key: 'location', label: 'Where it is' },
  { key: 'price', label: 'The price' },
  { key: 'size', label: 'The size' },
  { key: 'type', label: 'The property' },
  { key: 'returns', label: 'The numbers' },
  { key: 'other', label: 'Something else' },
] as const;
export type ReasonGroup = (typeof REASON_GROUPS)[number]['key'];

export const PICK_REASONS = [
  { key: 'wrong_area', label: 'Wrong area', group: 'location', effect: 'we stop searching this area for you' },
  { key: 'poor_location', label: 'Bad spot within the area', group: 'location', effect: 'we skip this postcode district' },
  { key: 'too_expensive', label: 'Too expensive', group: 'price', effect: 'we cap your picks 10% below this price' },
  { key: 'too_cheap', label: 'Too cheap or too low-end', group: 'price', effect: 'we look 10% above this price' },
  { key: 'too_small', label: 'Too small', group: 'size', effect: 'more bedrooms from now on' },
  { key: 'too_big', label: 'Too big', group: 'size', effect: 'fewer bedrooms from now on' },
  { key: 'no_flats', label: 'No flats or apartments', group: 'type', effect: 'houses only from now on' },
  { key: 'no_houses', label: 'No houses', group: 'type', effect: 'flats only from now on' },
  { key: 'needs_work', label: 'Needs too much work', group: 'type', effect: 'we skip renovation projects and auctions' },
  { key: 'not_str_suitable', label: 'Could not be run as a short let', group: 'type', effect: 'we tighten the short-let checks' },
  { key: 'poor_return', label: 'Return too low', group: 'returns', effect: 'we only send properties that beat this one against a long-term let' },
  { key: 'want_r2r', label: 'I want rent-to-rent, not to buy', group: 'other', effect: 'we switch you to rentals' },
  { key: 'want_buy', label: 'I want to buy, not rent-to-rent', group: 'other', effect: 'we switch you to sales' },
  { key: 'seen_it', label: 'Already seen it', group: 'other', effect: null },
] as const;

/** Reasons from the first version of the form, still stored on older rows and still honoured. */
export const LEGACY_REASONS = [
  { key: 'wrong_size', label: 'Wrong size', effect: 'we skip this number of bedrooms' },
  { key: 'wrong_type', label: 'Wrong type of property', effect: 'we skip this type' },
] as const;

export type PickReason = (typeof PICK_REASONS)[number]['key'] | (typeof LEGACY_REASONS)[number]['key'];

export function isPickReason(v: unknown): v is PickReason {
  return PICK_REASONS.some((r) => r.key === v) || LEGACY_REASONS.some((r) => r.key === v);
}

export function reasonLabel(key: string): string {
  return PICK_REASONS.find((r) => r.key === key)?.label ?? LEGACY_REASONS.find((r) => r.key === key)?.label ?? key;
}

export function reasonEffect(key: string): string | null {
  return PICK_REASONS.find((r) => r.key === key)?.effect ?? LEGACY_REASONS.find((r) => r.key === key)?.effect ?? null;
}

/** The reasons of one group, for the grouped chips on the response forms. */
export function reasonsInGroup(group: ReasonGroup) {
  return PICK_REASONS.filter((r) => r.group === group);
}

export function cleanReasons(raw: unknown): PickReason[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(list.map((r) => String(r).trim()).filter(isPickReason))];
}

/** What a past pick tells us, as stored on sourcing_sent. */
export interface PickFeedback {
  reaction: PickReaction | null;
  reactionSource: ReactionSource | null;
  reasons: PickReason[];
  kind: SourcingKind | null;
  postcodeArea: string | null;
  bedrooms: number | null;
  /** Sale price or rent pcm, whichever the pick was. */
  amount: number | null;
  rawType: string | null;
  /** Postcode district of the pick (a "bad spot" is skipped by district). */
  outcode?: string | null;
  /**
   * The income screening's headline figure for the pick: uplift % for a
   * purchase, annual profit £ for rent-to-rent. What "return too low" now
   * compares against.
   *
   * Absent on picks sent before the screening existed, and that is deliberate:
   * those rows carry a gross yield or a monthly margin, which are different
   * quantities in different units. Letting them set a floor here would compare
   * a 12.5% yield against a 12.5% uplift and silently mis-filter. They simply
   * contribute nothing and age out of the 60-day feedback window.
   */
  screeningScore?: number | null;
}

/** Yield for a purchase, monthly margin for rent-to-rent. Kept for the admin report's own column. */
export function dealScoreOf(deal: Deal | null | undefined): number | null {
  if (!deal) return null;
  return deal.kind === 'purchase' ? deal.grossYieldPct : deal.monthlyMargin;
}

// "auction" needs context: plenty of ordinary listings sit on Auction Close
// or in The Auction House, and dropping those loses good picks.
const NEEDS_WORK = /needs? (?:modernis|renovat|refurb|updating|complet|some work|work throughout)|in need of|renovation project|refurbishment project|doer[- ]upper|fixer[- ]upper|unmodernised|cash buyers? only|(?:by|via|at) auction|modern method of auction|auction (?:guide|lot)\b/i;

/**
 * Only feedback the member confirmed counts: a "no" from the reasons form, or
 * any response that carries reasons. A bare link click can come from a mail
 * security scanner, so it never changes anyone's picks.
 */
export function confirmedNegatives(feedback: PickFeedback[]): PickFeedback[] {
  return feedback.filter((f) => f.reaction === 'no' && (f.reactionSource === 'form' || f.reasons.length > 0));
}

/**
 * The rules a member's confirmed answers add up to, AFTER contradictions
 * cancel. Computed once so the filter and the "here is what changes" screen
 * can never disagree: a promise the member is shown is a rule that actually
 * applies. A contradiction that emptied the pool would silently cost them
 * the daily pick they paid for, so every pair that cannot both hold is
 * dropped and named in `cancelled`.
 */
export interface AppliedRules {
  /** Max price per kind (sale = total, rent = pcm). */
  cap: Partial<Record<SourcingKind, number>>;
  /** Min price per kind. */
  floor: Partial<Record<SourcingKind, number>>;
  minBeds: number | null;
  maxBeds: number | null;
  badSizes: Set<number>;
  badTypes: Set<string>;
  badOutcodes: Set<string>;
  badAreas: Set<string>;
  noFlats: boolean;
  noHouses: boolean;
  noWork: boolean;
  /** Only send listings that already pass the short-let check without needing the page. */
  strictSuitability: boolean;
  wantKind: SourcingKind | null;
  /** Min deal score per kind: gross yield % for a purchase, monthly margin £ for rent-to-rent. */
  minReturn: Partial<Record<SourcingKind, number>>;
  /** Reasons the member gave that cancelled each other out, so nothing changed for them. */
  cancelled: PickReason[];
  /** Reasons that produced no rule at all (no data to key on, or nothing to change). */
  inert: PickReason[];
}

const EFFECTIVE: PickReason[] = ['wrong_area', 'poor_location', 'too_expensive', 'too_cheap', 'too_small', 'too_big', 'no_flats', 'no_houses', 'needs_work', 'not_str_suitable', 'poor_return', 'want_r2r', 'want_buy', 'wrong_size', 'wrong_type'];

export function feedbackRules(feedback: PickFeedback[]): AppliedRules {
  const neg = confirmedNegatives(feedback);
  const r: AppliedRules = {
    cap: {}, floor: {}, minBeds: null, maxBeds: null,
    badSizes: new Set(), badTypes: new Set(), badOutcodes: new Set(), badAreas: new Set(),
    noFlats: false, noHouses: false, noWork: false, strictSuitability: false,
    wantKind: null, minReturn: {}, cancelled: [], inert: [],
  };
  if (neg.length === 0) return r;
  const given = new Set<PickReason>();
  let wantRent = false;
  let wantBuy = false;
  for (const f of neg) {
    const has = (k: PickReason) => f.reasons.includes(k);
    for (const k of f.reasons) given.add(k);
    if (has('wrong_area') && f.postcodeArea) r.badAreas.add(f.postcodeArea.toUpperCase());
    if (has('poor_location') && f.outcode) r.badOutcodes.add(f.outcode.toUpperCase());
    if (has('too_expensive') && f.kind && f.amount) r.cap[f.kind] = Math.min(r.cap[f.kind] ?? Infinity, Math.round(f.amount * 0.9));
    if (has('too_cheap') && f.kind && f.amount) r.floor[f.kind] = Math.max(r.floor[f.kind] ?? 0, Math.round(f.amount * 1.1));
    if (has('too_small') && f.bedrooms !== null) r.minBeds = Math.max(r.minBeds ?? 0, f.bedrooms + 1);
    if (has('too_big') && f.bedrooms !== null && f.bedrooms > 1) r.maxBeds = Math.min(r.maxBeds ?? Infinity, f.bedrooms - 1);
    if (has('wrong_size') && f.bedrooms !== null) r.badSizes.add(f.bedrooms);
    if (has('wrong_type') && f.rawType) r.badTypes.add(f.rawType.toLowerCase());
    if (has('poor_return') && f.kind && typeof f.screeningScore === 'number') r.minReturn[f.kind] = Math.max(r.minReturn[f.kind] ?? -Infinity, f.screeningScore);
    if (has('no_flats')) r.noFlats = true;
    if (has('no_houses')) r.noHouses = true;
    if (has('needs_work')) r.noWork = true;
    if (has('not_str_suitable')) r.strictSuitability = true;
    if (has('want_r2r')) wantRent = true;
    if (has('want_buy')) wantBuy = true;
  }

  // ── Contradictions cancel. Each pair would otherwise leave nothing to send. ──
  const cancel = (...keys: PickReason[]) => {
    for (const k of keys) if (given.has(k) && !r.cancelled.includes(k)) r.cancelled.push(k);
  };
  if (r.noFlats && r.noHouses) {
    r.noFlats = r.noHouses = false;
    cancel('no_flats', 'no_houses');
  }
  if (wantRent && wantBuy) cancel('want_r2r', 'want_buy');
  else r.wantKind = wantRent ? 'rent' : wantBuy ? 'sale' : null;
  // A price ceiling below the floor rejects every priced listing of that kind.
  for (const kind of ['sale', 'rent'] as SourcingKind[]) {
    const cap = r.cap[kind];
    const floor = r.floor[kind];
    if (cap !== undefined && floor !== undefined && floor > cap) {
      delete r.cap[kind];
      delete r.floor[kind];
      cancel('too_expensive', 'too_cheap');
    }
  }
  if (r.minBeds !== null && r.maxBeds !== null && r.minBeds > r.maxBeds) {
    r.minBeds = r.maxBeds = null;
    cancel('too_small', 'too_big');
  }
  // A surviving bedroom band whose every value is also excluded by size leaves nothing.
  if (r.minBeds !== null || r.maxBeds !== null) {
    const lo = r.minBeds ?? 1;
    const hi = r.maxBeds ?? Math.max(lo, ...(r.badSizes.size > 0 ? [...r.badSizes] : [lo]));
    let open = false;
    for (let b = lo; b <= hi; b += 1) if (!r.badSizes.has(b)) open = true;
    if (!open) {
      r.minBeds = r.maxBeds = null;
      cancel('too_small', 'too_big', 'wrong_size');
    }
  }

  // ── Reasons that changed nothing: no data to key on, or nothing to change. ──
  for (const k of given) {
    if (r.cancelled.includes(k)) continue;
    if (!EFFECTIVE.includes(k)) {
      r.inert.push(k);
      continue;
    }
    const armed =
      (k === 'wrong_area' && r.badAreas.size > 0) ||
      (k === 'poor_location' && r.badOutcodes.size > 0) ||
      (k === 'too_expensive' && Object.keys(r.cap).length > 0) ||
      (k === 'too_cheap' && Object.keys(r.floor).length > 0) ||
      (k === 'too_small' && r.minBeds !== null) ||
      (k === 'too_big' && r.maxBeds !== null) ||
      (k === 'wrong_size' && r.badSizes.size > 0) ||
      (k === 'wrong_type' && r.badTypes.size > 0) ||
      (k === 'poor_return' && Object.keys(r.minReturn).length > 0) ||
      (k === 'no_flats' && r.noFlats) ||
      (k === 'no_houses' && r.noHouses) ||
      (k === 'needs_work' && r.noWork) ||
      (k === 'not_str_suitable' && r.strictSuitability) ||
      ((k === 'want_r2r' || k === 'want_buy') && r.wantKind !== null);
    if (!armed) r.inert.push(k);
  }
  return r;
}

/** True when this reason is actually changing what the member is sent. */
export function ruleApplied(rules: AppliedRules, reason: PickReason): boolean {
  return !rules.cancelled.includes(reason) && !rules.inert.includes(reason);
}

/** Kind and area preferences change what we search for, not just what we keep. */
export function applyQueryFeedback(queries: SourcingQuery[], feedback: PickFeedback[], rules = feedbackRules(feedback)): SourcingQuery[] {
  const out = new Map<string, SourcingQuery>();
  for (const q of queries) {
    if (rules.badAreas.has(q.area.toUpperCase())) continue;
    let kind = q.kind;
    if (rules.wantKind) kind = rules.wantKind;
    // A flipped kind loses the other kind's price bounds (a purchase budget is not a rent ceiling).
    const flipped = kind !== q.kind;
    const minPrice = flipped ? null : q.minPrice;
    const maxPrice = flipped ? null : q.maxPrice;
    const key = queryKey(kind, q.area, minPrice, maxPrice, q.minBedrooms);
    if (!out.has(key)) out.set(key, { ...q, key, kind, minPrice, maxPrice });
  }
  return [...out.values()];
}

/**
 * Price, size, type, spot and return rules keep what we found but drop what
 * the member already said no to. Each rule is per kind where the rejected
 * pick's kind is known (a purchase budget is not a rent ceiling).
 */
export function applyCandidateFeedback<C extends { listing: SourcedListing; deal?: Deal | null; screening?: Screening | null }>(candidates: C[], feedback: PickFeedback[], rules = feedbackRules(feedback)): C[] {
  return candidates.filter((c) => {
    const l = c.listing;
    const amount = l.price ? (l.kind === 'rent' ? (l.price.period === 'pw' ? (l.price.amount * 52) / 12 : l.price.amount) : l.price.amount) : null;
    if (amount !== null) {
      const limit = rules.cap[l.kind];
      if (limit && amount > limit) return false;
      const low = rules.floor[l.kind];
      if (low && amount < low) return false;
    }
    if (l.bedrooms !== null) {
      if (rules.badSizes.has(l.bedrooms)) return false;
      if (rules.minBeds !== null && l.bedrooms < rules.minBeds) return false;
      if (rules.maxBeds !== null && l.bedrooms > rules.maxBeds) return false;
    }
    if (l.rawType && rules.badTypes.has(l.rawType.toLowerCase())) return false;
    if (l.outcode && rules.badOutcodes.has(l.outcode.toUpperCase())) return false;
    // An untyped listing is neither: excluding it under "no houses" would send
    // a flats-only member nothing, and under "no flats" would send them a flat.
    const kind = propertyKind(l.rawType, l.title);
    if (rules.noFlats && kind !== 'house') return false;
    if (rules.noHouses && kind !== 'flat') return false;
    if (rules.noWork && NEEDS_WORK.test([l.title, l.rawType ?? '', l.priceQualifier ?? '', ...(l.features ?? [])].join(' | '))) return false;
    const need = rules.minReturn[l.kind];
    if (need !== undefined) {
      // Same metric on both sides: the floor came from a screening, so it is
      // compared against one. A candidate we could not screen is not dropped —
      // there is nothing to compare, and silence costs the member their pick.
      const score = screeningScore(c.screening);
      if (score !== null && score <= need) return false;
    }
    return true;
  });
}

// ── The email ──

/**
 * How many members may receive the same listing in one run. House-pick
 * members share one candidate pool, so without a cap everyone gets the
 * single top-ranked listing; with it the next-best listings are used.
 */
export const PER_LISTING_CAP = 3;

/**
 * Picks the best-ranked candidate that has not yet reached the per-run cap,
 * recording the assignment. Falls back to the top candidate when every
 * candidate is capped, so a thin pool still yields a pick. `ranked` is the
 * output of `rankPicks` (best first).
 */
export function spreadPick<P extends { listing: { canonicalUrl: string } }>(ranked: P[], assigned: Map<string, number>, cap = PER_LISTING_CAP): P | null {
  if (ranked.length === 0) return null;
  const chosen = ranked.find((c) => (assigned.get(c.listing.canonicalUrl) ?? 0) < cap) ?? ranked[0];
  assigned.set(chosen.listing.canonicalUrl, (assigned.get(chosen.listing.canonicalUrl) ?? 0) + 1);
  return chosen;
}

export interface PickEmailInput {
  pick: SourcedPick;
  siteUrl: string;
  /** sourcing_sent.id and .token for the buttons. */
  id: string;
  token: string;
  basis: PickBasis;
  /** describeGoals() chips when the member has a filter. */
  goalsChips: string[];
  /** The member's first ever pick: explain why they are getting it. */
  firstEver: boolean;
  /** What the pick cost them, in base pence (0 for admins). */
  chargedBasePence: number;
  /** Nothing matched the filter exactly and this is the nearest thing we found. */
  nearMiss?: boolean;
  /** The one setting to change, from analyseRelaxation. Shown only on a near miss. */
  relaxation?: string | null;
  /** The income screening this pick was sent on, shown as the working. */
  screening?: Screening | null;
}

export function pickLinks(siteUrl: string, id: string, token: string, listingUrl: string) {
  const base = siteUrl.replace(/\/$/, '');
  return {
    yes: `${base}/p/${token}?a=yes`,
    no: `${base}/p/${token}?a=no`,
    save: `${base}/picks?save=${encodeURIComponent(id)}`,
    report: `${base}/estimate?listing=${encodeURIComponent(listingUrl)}`,
    filter: `${base}/markets?goals=1`,
    picks: `${base}/picks`,
    unsubscribe: `${base}/p/${token}?a=unsubscribe`,
    unsubscribePost: `${base}/api/picks/unsubscribe/${token}`,
    listing: listingUrl,
  };
}

/** RFC 8058 one-click headers so mail clients show their own unsubscribe control. */
export function unsubscribeHeaders(links: { unsubscribe: string; unsubscribePost: string }): Record<string, string> {
  return { 'List-Unsubscribe': `<${links.unsubscribePost}>, <${links.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

function penceLabel(p: number): string {
  return p >= 100 ? `£${(p / 100).toFixed(2)}` : `${Math.round(p)}p`;
}

export function pickLabel(l: SourcedListing): string {
  const bits = [l.bedrooms ? `${l.bedrooms}-bed` : null, l.rawType, formatListingPrice(l.price)].filter(Boolean);
  return `${l.address ?? l.title} — ${bits.join(' · ')}`;
}

/**
 * The reasons the seller or landlord looks ready to deal, in plain words.
 *
 * Built only from signals that actually fired, so the line can never claim more
 * than the listing supports — and capped at three, because a wall of reasons
 * reads as a sales pitch rather than evidence.
 */
export function describeMotivation(m: Motivation | null | undefined, limit = 3): string | null {
  if (!m || m.fired.length === 0) return null;
  const reasons = m.fired.slice(0, limit).map(motivationLabel);
  return `Why this one: ${reasons.join(' · ')}.`;
}

export function pickEmail(input: PickEmailInput): { subject: string; text: string; html: string; headers: Record<string, string> } {
  const { pick, basis, goalsChips, firstEver } = input;
  const l = pick.listing;
  const links = pickLinks(input.siteUrl, input.id, input.token, l.canonicalUrl);
  const kindWord = l.kind === 'rent' ? 'rent-to-rent' : 'to buy';
  const sc = input.screening && input.screening.band !== 'insufficient-data' ? input.screening : null;
  // The subject leads on the screening where there is one: "42% above a long let"
  // is the thing the member is deciding on, and it keeps the subject line and the
  // body telling one story rather than two.
  const scHeadline = sc ? (sc.kind === 'purchase' ? `${sc.upliftPct}% above a long let` : `£${Math.round(sc.annualProfit!).toLocaleString('en-GB')}/yr profit`) : null;
  const subject = `Today's pick ${kindWord}: ${l.bedrooms ? `${l.bedrooms}-bed ` : ''}in ${pick.areaName}${scHeadline ? ` · ${scHeadline}` : pick.deal ? ` · ${pick.deal.kind === 'purchase' ? `${pick.deal.grossYieldPct.toFixed(1)}% yield` : `£${Math.round(pick.deal.monthlyMargin).toLocaleString('en-GB')}/mo margin`}` : ''}`;
  const work = sc ? screeningWorking(sc) : [];
  const scVerdict = sc ? `${BAND_LABELS[sc.band]} — ${sc.reason}` : null;
  const why = basis === 'goals' ? `Picked for your filter: ${goalsChips.join(' · ')}.` : `A Stayful house pick from one of the best-scoring areas we track. Set a filter to get picks in your area, budget and size.`;
  const dealLine = pick.deal ? describeDeal(pick.deal) : 'Run a full report for the figures.';
  const motivationLine = describeMotivation(pick.motivation ?? null);
  // Said first and said plainly. A near miss presented as a match is a small
  // lie that costs more trust than the empty day it was avoiding.
  const nearMissLine = input.nearMiss
    ? `Nothing matched your filter exactly today — this is the closest we found.`
    : null;
  const relaxLine = input.nearMiss ? input.relaxation ?? null : null;
  const intro = firstEver
    ? `Stayful Intelligence now finds you one property a day: the listing that best fits your filter, or a house pick from our best-scoring areas when you have not set one. Each pick uses ${penceLabel(input.chargedBasePence || 10)} of your credit. Turn it off any time with the link at the bottom.`
    : null;
  const costNote = input.chargedBasePence > 0 ? `This pick used ${penceLabel(input.chargedBasePence)} of your credit.` : null;

  const text = [
    `Today's pick from Stayful Intelligence (${kindWord}).`,
    '',
    intro,
    intro ? '' : null,
    nearMissLine,
    nearMissLine ? '' : null,
    pickLabel(l),
    dealLine,
    scVerdict,
    ...(work.length > 0 ? work.map((w) => `  ${w.label}: ${w.value}`) : []),
    motivationLine,
    relaxLine,
    `Fit ${pick.fit}/100 · ${pick.areaName}`,
    why,
    '',
    `Is this the kind of property you are looking for?`,
    `Yes, more like this: ${links.yes}`,
    `Not for me: ${links.no}`,
    `Not for you? Tell us why in a couple of clicks and tomorrow's pick changes.`,
    '',
    `Save to my pipeline: ${links.save}`,
    `Full report: ${links.report}`,
    `View listing: ${links.listing}`,
    `Set my filter: ${links.filter}`,
    '',
    'Figures are area averages for the size of property; run a full report before acting on one.',
    costNote,
    `All your picks: ${links.picks}`,
    `Stop daily picks: ${links.unsubscribe}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const btn = (href: string, label: string, primary = false) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px;${primary ? 'background:#5d8156;color:#fff' : 'background:#eef2ea;color:#2e3d2b'}">${esc(label)}</a>`;
  const photo = l.photo ? `<img src="${esc(l.photo)}" alt="" width="560" style="display:block;width:100%;max-width:560px;border-radius:12px;margin:0 0 14px">` : '';
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful daily pick · ${esc(kindWord)}</p>
      ${intro ? `<p style="color:#5b6657;font-size:14px;border-left:3px solid #5d8156;padding-left:10px">${esc(intro)}</p>` : ''}
      ${photo}
      <h1 style="font-size:22px;margin:0 0 6px">${esc(l.address ?? l.title)}</h1>
      <p style="margin:0 0 4px;font-weight:600">${esc(pickLabel(l).replace(/^.*? — /, ''))}</p>
      ${nearMissLine ? `<p style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#f5f2e8;color:#2e3d2b;font-size:14px">${esc(nearMissLine)}</p>` : ''}
      <p style="margin:0 0 4px;color:#5d8156">${esc(dealLine)}</p>
      ${scVerdict ? `<p style="margin:0 0 6px;font-weight:600;color:#2e3d2b">${esc(scVerdict)}</p>` : ''}
      ${work.length > 0 ? `<table role="presentation" style="margin:0 0 12px;border-collapse:collapse;font-size:13px;color:#5b6657">${work.map((w) => `<tr><td style="padding:1px 12px 1px 0">${esc(w.label)}</td><td style="padding:1px 0;font-weight:600;color:#2e3d2b">${esc(w.value)}</td></tr>`).join('')}</table>` : ''}
      ${motivationLine ? `<p style="margin:0 0 4px;color:#2e3d2b;font-size:14px"><strong>Why this one:</strong> ${esc(motivationLine.replace(/^Why this one: /, ''))}</p>` : ''}
      <p style="margin:0 0 14px;color:#7a8274;font-size:13px">Fit ${pick.fit}/100 · ${esc(pick.areaName)} · ${esc(why)}</p>
      <p style="margin:0 0 6px;font-weight:600">Is this the kind of property you are looking for?</p>
      <p style="margin:0 0 4px">${btn(links.yes, 'Yes, more like this', true)}${btn(links.no, 'Not for me')}</p>
      ${relaxLine ? `<p style="margin:0 0 14px;color:#2e3d2b;font-size:13px">${esc(relaxLine)} <a href="${esc(links.filter)}" style="color:#2e3d2b;font-weight:600">Change it</a></p>` : ''}
      <p style="margin:0 0 14px;color:#7a8274;font-size:13px">Not for you? Tell us why in a couple of clicks and tomorrow&#8217;s pick changes.</p>
      <p style="margin:0 0 18px">${btn(links.save, 'Save to my pipeline', true)}${btn(links.report, 'Full report')}${btn(links.listing, 'View listing')}${btn(links.filter, basis === 'goals' ? 'Edit my filter' : 'Set my filter')}</p>
      <p style="color:#7a8274;font-size:12px">Figures are area averages for the size of property; run a full report before acting on one.${costNote ? ` ${esc(costNote)}` : ''} See every pick at <a href="${esc(links.picks)}" style="color:#7a8274">${esc(links.picks)}</a>. <a href="${esc(links.unsubscribe)}" style="color:#7a8274">Stop daily picks</a>.</p>
    </div>`.trim();

  return { subject, text, html, headers: unsubscribeHeaders(links) };
}

// ── Admin summary ──

export interface PickRow {
  status: PickStatus;
  kind: SourcingKind | null;
  basis: PickBasis | null;
  postcodeArea: string | null;
  reaction: PickReaction | null;
  reactionSource: ReactionSource | null;
  reasons: PickReason[];
  savedAt: string | null;
  sentAt: string;
}

export interface PickSummary {
  sent: number;
  failed: number;
  responded: number;
  yes: number;
  no: number;
  saved: number;
  byKind: Record<'sale' | 'rent', { sent: number; yes: number; no: number; saved: number }>;
  byBasis: Record<PickBasis, { sent: number; yes: number; no: number; saved: number }>;
  reasons: { key: PickReason; count: number }[];
  areas: { area: string; sent: number; yes: number; no: number }[];
}

export function summarisePicks(rows: PickRow[]): PickSummary {
  const bucket = () => ({ sent: 0, yes: 0, no: 0, saved: 0 });
  const s: PickSummary = { sent: 0, failed: 0, responded: 0, yes: 0, no: 0, saved: 0, byKind: { sale: bucket(), rent: bucket() }, byBasis: { goals: bucket(), house: bucket() }, reasons: [], areas: [] };
  const reasons = new Map<PickReason, number>();
  const areas = new Map<string, { area: string; sent: number; yes: number; no: number }>();
  for (const r of rows) {
    if (r.status === 'failed') {
      s.failed += 1;
      continue;
    }
    if (r.status !== 'sent') continue;
    s.sent += 1;
    const k = r.kind === 'rent' ? s.byKind.rent : s.byKind.sale;
    const b = r.basis === 'house' ? s.byBasis.house : s.byBasis.goals;
    k.sent += 1;
    b.sent += 1;
    const area = r.postcodeArea ? areas.get(r.postcodeArea) ?? { area: r.postcodeArea, sent: 0, yes: 0, no: 0 } : null;
    if (area) {
      area.sent += 1;
      areas.set(area.area, area);
    }
    if (r.reaction) s.responded += 1;
    if (r.reaction === 'yes') {
      s.yes += 1;
      k.yes += 1;
      b.yes += 1;
      if (area) area.yes += 1;
    }
    if (r.reaction === 'no') {
      s.no += 1;
      k.no += 1;
      b.no += 1;
      if (area) area.no += 1;
    }
    if (r.savedAt) {
      s.saved += 1;
      k.saved += 1;
      b.saved += 1;
    }
    for (const reason of r.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  s.reasons = [...reasons.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  s.areas = [...areas.values()].sort((a, b) => b.yes - a.yes || b.sent - a.sent).slice(0, 10);
  return s;
}
