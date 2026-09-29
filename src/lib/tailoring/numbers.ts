/**
 * Part C: the three numbers a card leads with, chosen by what the member
 * does and what they are after. One function feeds the card and the deal
 * sheet, so the two can never disagree.
 *
 *   Profile                         Numbers, in order                              When one is missing
 *   Buyer after cash flow (or both) cash flow a month · cash needed · return on cash
 *   Buyer after growth              gross yield · price against the area's typical  cash needed
 *                                   for the size · the area's 5-year price trend
 *   Rent-to-rent                    profit a month · setup cost · break-even
 *   Deal sourcer                    room below the area's typical for the size ·    price cut
 *                                   motivated-seller signal · asking price
 *   Management company              projected revenue · distance to their units ·   area occupancy
 *                                   local competition
 *   Any Project (BRRR) deal         works · value added · profit after works         cash in, asking price
 *   No new answers                  none: the card is exactly as before
 *
 * Batch 17 (Q23): the numbers follow the deal's own type. A Project deal
 * shows the project's numbers to everyone (its price means little without
 * the works). A rental shows the rent-to-rent numbers, any other sale the
 * buyer's; except that a deal sourcer or a management company keeps their
 * own numbers on those, unless they also ticked investor or rent-to-rent
 * (about.ts jobRole). A profile answered before the roles question goes by
 * its old path. The "Funding" blocker puts cash needed first. Beginners (no deals
 * done yet) get one plain line under each number. Figures resting on the
 * area's short-let income are shown as ranges, as the profit is (Batch 10).
 * Only formatted words and figures come out: no address, postcode or link.
 *
 * Pure: no network, no database, no `server-only`.
 */
import { moneyRange, spread, widthFor } from '../marketplace/profit-range.ts';
import { priceLine, type DealCard } from '../marketplace/grid.ts';
import { motivationLine } from '../marketplace/motivation-line.ts';
import { parseHistory } from '../listing/recheck.ts';
import { parseMotivation } from '../listing/motivation.ts';
import { motivationFor } from '../today/candidates.ts';
import { factsFromRow, memberFigures, rentalFromCard, typeOfFacts, type DealFacts, type MemberFigures } from './criteria.ts';
import { areaLookup, leaningsFor, operationsMiles, type AreaFacts, type AreaLookup } from './order.ts';
import type { AreaCardData } from '../market/explorer.ts';
import { explainCard, type Explanation } from './why.ts';
import { leadFor, type Lead } from './about-prompts.ts';
import { asked, usesTailoring, type TailoringProfile } from './profile.ts';
import { jobRole } from '../profile/about.ts';
import type { DealType } from '../profile/deal-types.ts';
import { valueAddedLabel } from '../project/headline.ts';
import { shortMoney } from '../deal-quality/streams.ts';

export type Role = 'buy_cashflow' | 'buy_growth' | 'r2r' | 'source' | 'manage' | 'brrr';

export type NumberKey = 'profit' | 'cash' | 'coc' | 'yield' | 'vsTypical' | 'trend' | 'setup' | 'breakeven' | 'room' | 'motivation' | 'price' | 'priceCut' | 'revenue' | 'distance' | 'competition' | 'occupancy' | 'works' | 'valueAdded' | 'afterWorks';

export interface CardNumber {
  key: NumberKey;
  label: string;
  value: string;
  /** One plain line for a beginner; null for everyone else. */
  help: string | null;
}

const PLAN: Record<Role, { keys: NumberKey[]; fallback: NumberKey[] }> = {
  buy_cashflow: { keys: ['profit', 'cash', 'coc'], fallback: ['yield', 'price'] },
  buy_growth: { keys: ['yield', 'vsTypical', 'trend'], fallback: ['cash', 'profit', 'price'] },
  r2r: { keys: ['profit', 'setup', 'breakeven'], fallback: ['revenue', 'price'] },
  source: { keys: ['room', 'motivation', 'price'], fallback: ['priceCut', 'profit'] },
  manage: { keys: ['revenue', 'distance', 'competition'], fallback: ['occupancy', 'profit', 'price'] },
  brrr: { keys: ['works', 'valueAdded', 'afterWorks'], fallback: ['cash', 'price'] },
};

const HELP: Record<NumberKey, string> = {
  profit: 'What’s left each month after the costs, at your own figures.',
  cash: 'What you’d need up front: deposit, stamp duty and furnishing.',
  coc: 'A year’s profit as a share of the cash you put in.',
  yield: 'A year’s short-let income as a share of the price.',
  vsTypical: 'How the price compares with similar homes in the area.',
  trend: 'How prices in the area have moved over five years.',
  setup: 'Furnishing and kit to make it guest-ready.',
  breakeven: 'How full it must be to cover the rent and bills.',
  room: 'How far the price sits below similar homes: room for your fee.',
  motivation: 'Signs the seller wants to do a deal.',
  price: 'What the seller is asking.',
  priceCut: 'How far the price has come down since we first saw it.',
  revenue: 'What a short let here might earn in a year.',
  distance: 'How far it is from the units you already run.',
  competition: 'How crowded the short-let market is here.',
  occupancy: 'How often short lets here are booked.',
  works: 'A guide to the works from the photos, including VAT. Get your own quotes.',
  valueAdded: 'The value after the works, less the price and the works.',
  afterWorks: 'What’s left each month once the works are done, at your own figures.',
};

/** A sourcer's or a manager's own numbers apply (Q23): by the roles ticked, or the old path before them. */
function jobOf(p: TailoringProfile): 'source' | 'manage' | null {
  if (p.about.roles.length === 0) {
    const path = p.goals?.path ?? null;
    return path === 'manage' ? 'manage' : path === 'source' ? 'source' : null;
  }
  const job = jobRole(p.about);
  return job === 'manager' ? 'manage' : job === 'sourcer' ? 'source' : null;
}

/**
 * The role a card is read for, by the deal's own type (a kind stands for its
 * type: a sale is Short-let); null when the profile has no new answers
 * (the card is unchanged).
 */
export function roleFor(p: TailoringProfile | null | undefined, deal: DealType | 'sale' | 'rent'): Role | null {
  if (!usesTailoring(p)) return null;
  const type: DealType = deal === 'sale' ? 'buy_str' : deal === 'rent' ? 'r2r' : deal;
  if (type === 'brrr') return 'brrr';
  const job = jobOf(p);
  if (job) return job;
  if (type === 'r2r') return 'r2r';
  const goal = p.goals && asked(p, 'main_goal') ? p.goals.buyer.mainGoal : null;
  return goal === 'growth' ? 'buy_growth' : 'buy_cashflow';
}

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
/** "£14k–£26k", one figure when both ends round the same. */
const moneyRangeK = (low: number, high: number) => {
  const [a, b] = [shortMoney(Math.max(0, low)), shortMoney(Math.max(0, high))];
  return a === b ? b : `${a}–${b}`;
};
const gbpK = (n: number) => `£${Math.round(Math.abs(n) / 1_000).toLocaleString('en-GB')}k`;

/** How far the asking figure has come down from the first one we recorded, %; null without a cut. */
export function priceCutPct(priceHistory: unknown, current: number | null): number | null {
  if (current === null) return null;
  const first = parseHistory(priceHistory).find((e) => e.previousAmount !== null)?.previousAmount ?? null;
  if (first === null || first <= 0 || current >= first) return null;
  return ((first - current) / first) * 100;
}

export interface NumbersInput {
  facts: DealFacts;
  figures: MemberFigures;
  area: AreaFacts;
  /** The card's price as shown: "£245,000", "£1,100 pcm". */
  price: string | null;
  /** The strongest motivation item the card shows ("Reduced twice"), or null. */
  motivation: string | null;
  priceCut: number | null;
  /** The profit range's half-width, % (the confidence of the area estimate). */
  widthPct: number;
}

function value(key: NumberKey, i: NumbersInput, p: TailoringProfile): { label: string; value: string } | null {
  const f = i.facts;
  const fig = i.figures;
  const range = (v: number, step: number) => moneyRange(spread(v, i.widthPct, step));
  const pctRange = (v: number) => {
    const [lo, hi] = spread(v, i.widthPct, 0.1);
    return `${lo.toFixed(1)}–${hi.toFixed(1)}%`;
  };
  const beds = f.bedrooms !== null ? `${Math.min(f.bedrooms, 4)}${f.bedrooms >= 4 ? '+' : ''}-bed` : 'home';
  const project = f.kind === 'sale' ? f.project ?? null : null;
  switch (key) {
    case 'profit':
      if (project) return fig.range ? { label: 'After works / month', value: fig.range.label.replace(/\/mo$/, '') } : null;
      return fig.range ? { label: fig.range.kind === 'purchase' ? 'Cash flow / month' : 'Profit / month', value: fig.range.label.replace(/\/mo$/, '') } : null;
    case 'cash':
      // A Project deal's cash is its own range: works, buying costs and holding (Q26).
      if (project) return project.cashHigh > 0 ? { label: 'Cash in', value: moneyRangeK(project.cashLow, project.cashHigh) } : null;
      return fig.cashRequired !== null ? { label: 'Cash needed', value: gbp(fig.cashRequired) } : null;
    case 'works':
      return project ? { label: 'Works', value: `~${moneyRangeK(project.worksLow, project.worksHigh)}` } : null;
    case 'valueAdded':
      return project ? { label: 'Value added', value: valueAddedLabel(project.valueAdded).replace(/ value added$/, '') } : null;
    case 'afterWorks':
      return project && fig.range ? { label: 'After works / month', value: fig.range.label.replace(/\/mo$/, '') } : null;
    case 'coc':
      return fig.cashOnCashPct !== null ? { label: 'Return on cash', value: pctRange(fig.cashOnCashPct) } : null;
    case 'yield':
      return f.grossRevenue !== null && f.amount !== null && f.kind === 'sale' && f.amount > 0 ? { label: 'Gross yield', value: pctRange((f.grossRevenue / f.amount) * 100) } : null;
    case 'vsTypical':
    case 'room': {
      if (i.area.typicalValue === null || f.amount === null || f.kind !== 'sale') return null;
      const gap = i.area.typicalValue - f.amount;
      if (key === 'room' && gap <= 0) return null;
      return { label: key === 'room' ? 'Room below typical' : `Against a typical ${beds}`, value: gap >= 0 ? `${gbpK(gap)} under` : `${gbpK(gap)} over` };
    }
    case 'trend':
      return i.area.growth5y !== null ? { label: 'Area prices, 5 years', value: `${i.area.growth5y >= 0 ? '+' : '−'}${Math.abs(Math.round(i.area.growth5y))}%` } : null;
    case 'setup':
      return fig.setupCost !== null ? { label: 'Setup cost', value: gbp(fig.setupCost) } : null;
    case 'breakeven':
      return fig.breakEvenPct !== null ? { label: 'Break-even', value: `${Math.round(fig.breakEvenPct)}% booked` } : null;
    case 'motivation':
      return { label: 'Motivated seller', value: i.motivation ?? 'No signs yet' };
    case 'price':
      return i.price ? { label: f.kind === 'rent' ? 'Rent' : 'Asking', value: i.price } : null;
    case 'priceCut':
      return i.priceCut !== null ? { label: 'Price cut', value: `${Math.round(i.priceCut)}% off` } : null;
    case 'revenue':
      return f.grossRevenue !== null ? { label: 'Short-let revenue', value: `${range(f.grossRevenue, 100)}/yr` } : null;
    case 'distance': {
      const miles = operationsMiles(f.area, leaningsFor(p).operations);
      return miles === null ? null : { label: 'From your units', value: miles < 1 ? 'Same area' : `${Math.round(miles)} miles` };
    }
    case 'competition':
      return i.area.competition ? { label: 'Competition', value: i.area.competition } : null;
    case 'occupancy':
      return i.area.occupancy !== null && i.area.occupancy !== undefined ? { label: 'Area occupancy', value: `${Math.round(i.area.occupancy)}%` } : null;
  }
}

/** The three numbers for this profile, or null when the card stays as it was (no new answers). */
export function numbersFor(i: NumbersInput, p: TailoringProfile | null | undefined): CardNumber[] | null {
  const role = roleFor(p, typeOfFacts(i.facts));
  if (!role || !p) return null;
  const plan = PLAN[role];
  let keys = [...plan.keys];
  // The "Funding" blocker: cash needed first, on a sale.
  if (p.about.blocker === 'funding' && i.facts.kind === 'sale') keys = ['cash', ...keys.filter((k) => k !== 'cash')];
  const beginner = p.about.dealsDone === '0';
  const out: CardNumber[] = [];
  const used = new Set<NumberKey>();
  const add = (key: NumberKey): boolean => {
    if (used.has(key)) return false;
    const v = value(key, i, p);
    if (!v) return false;
    used.add(key);
    out.push({ key, label: v.label, value: v.value, help: beginner ? HELP[key] : null });
    return true;
  };
  for (const key of keys) {
    if (out.length >= 3) break;
    if (add(key)) continue;
    for (const fb of plan.fallback) if (add(fb)) break;
  }
  return out.length > 0 ? out.slice(0, 3) : null;
}

/** A card (CARD_COLUMNS) as the numbers read it, for this profile. */
export function numbersForCard(card: DealCard, p: TailoringProfile | null | undefined, area: AreaLookup, now: Date): CardNumber[] | null {
  if (!usesTailoring(p)) return null;
  const { qualifies } = motivationFor({ kind: card.kind, motivation: card.motivation, listed_date: card.listed_date, first_seen_at: card.first_seen_at }, p.goals, now);
  const m = parseMotivation(card.motivation);
  // The card carries a rental's stored setup cost and break-even; a sale's cash needed is worked out.
  const facts = factsFromRow(card, rentalFromCard(card), { qualifies, score: m?.score ?? 0, fired: m?.fired });
  const figures = memberFigures(facts, p);
  return numbersFor(
    {
      facts,
      figures,
      area: area(facts.area, facts.bedrooms),
      price: priceLine(card),
      motivation: motivationLine(card, now)[0] ?? null,
      priceCut: priceCutPct(card.price_history, facts.amount),
      widthPct: widthFor(card.screening_confidence ?? null, p.widths),
    },
    p,
  );
}

/**
 * Cards' views with what the member's profile adds: the three numbers and
 * the why-line with the match. `why` (Today's list): a profile with no new
 * answers gets the generic why-line too, and a "near me + the best
 * elsewhere" profile's national cards say "Best elsewhere"; elsewhere
 * (Browse) that badge would only mark every card outside their area.
 */
export function withTailoring<V extends { numbers?: CardNumber[] | null; explanation?: Explanation | null; lead?: Lead }>(views: ReadonlyMap<string, V>, cards: readonly DealCard[], p: TailoringProfile | null | undefined, snapshot: readonly AreaCardData[] | null, now: Date, opts: { why?: boolean } = {}): Map<string, V> {
  const area = areaLookup(snapshot);
  const out = new Map(views);
  for (const c of cards) {
    const v = out.get(c.id);
    if (!v) continue;
    const tailored = usesTailoring(p);
    const explained = tailored || opts.why ? explainCard(c, p, area, now) : null;
    out.set(c.id, {
      ...v,
      numbers: tailored ? numbersForCard(c, p, area, now) : v.numbers ?? null,
      explanation: explained ? { ...explained, elsewhere: Boolean(opts.why) && explained.elsewhere } : v.explanation ?? null,
      // Part E: "Knowing the numbers" puts the Full analysis first on the card.
      lead: tailored ? leadFor(p) : v.lead ?? null,
    });
  }
  return out;
}
