/**
 * The deal card's motivation line: at most two short, plain-English reasons
 * the other side looks ready to deal ("Reduced twice · Chain free").
 *
 * Built from what the deal row already stores — the motivation verdict
 * (signal keys only, see parseMotivation), our own recorded price history and
 * the portal's listing date — never from anything a member pays to see.
 *
 * Firm evidence first, and soft wording only when there is no firm evidence
 * at all: a line that leads with "Chain free" while the price has been cut
 * twice would bury the fact under the adjective.
 *
 * Two honesty rules, because the stored verdict has lost how confident each
 * signal was when it fired:
 *   - an age-based signal counts as firm only when the row carries the
 *     portal's own listing date. Without it the age may have come from our
 *     first sighting, which motivation.ts deliberately treats as soft.
 *   - "Reduced twice" is only said when our history shows two cuts. The
 *     history also records rises, so it is the cuts that are counted.
 *
 * Pure, so the wording is tested rather than trusted.
 */
import { MOTIVATION_SIGNALS, parseMotivation, type MotivationSignal } from '../listing/motivation.ts';
import { parseHistory } from '../listing/recheck.ts';
import type { SourcingKind } from '../listing/sourcing.ts';

export const MAX_MOTIVATION_ITEMS = 2;

/** The card's own wording for each signal: shorter than the email's labels, same meaning. */
const CARD_WORDS: Record<Exclude<MotivationSignal, 'long_on_market' | 'slower_than_area' | 'price_reduced' | 'reduced_repeatedly'>, string> = {
  back_on_market: 'Back on the market',
  relisted_new_agent: 'Relisted with a new agent',
  chain_free: 'Chain free',
  vacant: 'Empty now',
  urgent_sale: 'Wants a quick sale',
  probate: 'Probate sale',
  auction: 'Auction',
  offers_invited: 'Offers invited',
  portfolio_exit: 'Landlord selling up',
  tenanted: 'Tenants in situ',
  repossessed: 'Repossession',
  needs_quick_sale: 'Seller needs a quick sale',
  short_lease: 'Short lease',
  void_now: 'Standing empty',
  short_min_term: 'Short term considered',
  company_let: 'Company let considered',
  flexible_terms: 'Flexible on terms',
  incentive: 'Move-in incentive',
  private_landlord: 'Landlord direct',
};

export interface MotivationLineInput {
  kind: SourcingKind;
  /** marketplace_deals.motivation, as stored. */
  motivation?: unknown;
  /** marketplace_deals.price_history, as stored. */
  price_history?: unknown;
  /** The portal's own listing date, when the page gave one. */
  listed_date?: string | null;
}

interface Item {
  text: string;
  firm: boolean;
  weight: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const COUNT_WORDS = ['', 'once', 'twice'];

/** "Listed 9 weeks" / "Listed 7 months", or null when the date is missing, unreadable or in the future. */
export function listedFor(listedDate: string | null | undefined, now: Date): string | null {
  if (!listedDate) return null;
  const t = Date.parse(listedDate);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now.getTime() - t) / DAY_MS);
  if (days < 7) return null;
  if (days < 56) {
    const weeks = Math.floor(days / 7);
    return `Listed ${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  const months = Math.floor(days / 30.44);
  return `Listed ${months} month${months === 1 ? '' : 's'}`;
}

/** How many price cuts our own history recorded (rises and status changes are not cuts). */
export function recordedCuts(priceHistory: unknown): number {
  return parseHistory(priceHistory).filter((e) => e.amount !== null && e.previousAmount !== null && e.amount < e.previousAmount).length;
}

/**
 * Up to two items, strongest first: firm ones when there are any, otherwise
 * soft ones. An empty array means the card shows no line at all.
 */
export function motivationLine(input: MotivationLineInput, now: Date = new Date()): string[] {
  const fired = parseMotivation(input.motivation)?.fired ?? [];
  const has = (k: MotivationSignal) => fired.includes(k);
  const weight = (k: MotivationSignal) => MOTIVATION_SIGNALS[k].weight;
  const items: Item[] = [];

  // ── Time on the market ──
  const listed = listedFor(input.listed_date, now);
  if (has('long_on_market')) items.push({ text: listed ?? 'On the market a long time', firm: listed !== null, weight: weight('long_on_market') });
  if (has('slower_than_area')) items.push({ text: input.kind === 'rent' ? 'Slower to let than the area' : 'Slower to sell than the area', firm: listed !== null, weight: weight('slower_than_area') });

  // ── Price cuts: one item however many signals say so ──
  const cuts = recordedCuts(input.price_history);
  if (cuts >= 2) items.push({ text: `Reduced ${COUNT_WORDS[cuts] ?? `${cuts} times`}`, firm: true, weight: weight('price_reduced') });
  else if (has('reduced_repeatedly')) items.push({ text: 'Reduced more than once', firm: true, weight: weight('price_reduced') });
  else if (cuts === 1 || has('price_reduced')) items.push({ text: 'Price reduced', firm: true, weight: weight('price_reduced') });

  // ── Everything else, in the verdict's own words ──
  for (const k of fired) {
    if (!(k in CARD_WORDS)) continue;
    const spec = MOTIVATION_SIGNALS[k];
    if (!(spec.kinds as readonly string[]).includes(input.kind)) continue;
    items.push({ text: CARD_WORDS[k as keyof typeof CARD_WORDS], firm: spec.confidence === 'firm', weight: spec.weight });
  }

  const firm = items.filter((i) => i.firm);
  const pool = firm.length > 0 ? firm : items;
  return pool
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.weight - a.item.weight || a.i - b.i)
    .slice(0, MAX_MOTIVATION_ITEMS)
    .map(({ item }) => item.text);
}
