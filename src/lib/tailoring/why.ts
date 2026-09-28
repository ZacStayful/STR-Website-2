/**
 * Part D: why this deal is on the member's list, and how well it matches.
 *
 * The why-line is up to four set phrases for the checks it meets, the
 * must-haves first, then the one "fit for you" reason that lifted it most:
 * "2-bed · under £1,500 pcm · about 18 miles away · clears your £400
 * minimum". Every phrase comes from a structured column and a fixed form of
 * words: nothing from a listing's own text, so nothing can name a street.
 *
 * The match is met ÷ checked, where checked is every check the member's
 * answers make on this deal, must-haves and nice-to-haves alike, and an
 * unknown counts as not met (and says so): "83% match · 5 of 6". Shown from
 * two checks; with fewer it says nothing useful. It is the display: the
 * order uses missed and met (order.ts).
 *
 * A member with no new answers gets the deal's strongest fact instead.
 *
 * Pure: no network, no database, no `server-only`.
 */
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { areaMetaForCode } from '../market/areas.ts';
import type { DealCard } from '../marketplace/grid.ts';
import { motivationLine } from '../marketplace/motivation-line.ts';
import { parseMotivation } from '../listing/motivation.ts';
import { motivationFor } from '../today/candidates.ts';
import { TAILORING } from './config.ts';
import { factsFromRow, judgeDeal, rentalFromCard, wantsFor, type Check, type DealFacts, type Judgement, type MemberFigures, type Wants } from './criteria.ts';
import { adjustmentsFor, leaningsFor, type AreaLookup } from './order.ts';
import { usesTailoring, type CriterionKey, type TailoringProfile } from './profile.ts';

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const gbpK = (n: number) => (n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m` : `£${Math.round(n / 1_000)}k`);

/** The fixed words for a check the deal meets. */
function phrase(key: CriterionKey, f: DealFacts, fig: MemberFigures, w: Wants): string | null {
  switch (key) {
    case 'location': {
      if (w.home && f.area) {
        const at = areaCentroid(f.area);
        if (at) {
          const miles = Math.round(haversineMiles(w.home, at));
          return miles <= 2 ? 'close to home' : `about ${miles} miles away`;
        }
      }
      return f.area ? `in ${areaMetaForCode(f.area).name}` : null;
    }
    case 'budget':
      if (!w.budget) return null;
      if (w.budget.max !== null && w.budget.min !== null) return `${gbpK(w.budget.min)}–${gbpK(w.budget.max)}`;
      return w.budget.max !== null ? `under ${gbpK(w.budget.max)}` : w.budget.min !== null ? `over ${gbpK(w.budget.min)}` : null;
    case 'cash':
      return fig.cashRequired !== null ? `${gbpK(fig.cashRequired)} in` : null;
    case 'rent':
      return w.rentMax !== null ? `under ${gbp(w.rentMax)} pcm` : null;
    case 'profit':
      return w.minProfit !== null ? `clears your ${gbp(w.minProfit)} minimum` : null;
    case 'bedrooms':
      return f.bedrooms !== null ? `${f.bedrooms}-bed` : null;
    case 'type':
      return f.propertyKind === 'house' ? 'a house' : f.propertyKind === 'flat' ? 'a flat' : null;
    case 'leasehold':
      return f.tenure === 'freehold' ? 'freehold' : null;
    case 'restricted':
      return 'no short-let licence needed';
    case 'setup':
      return fig.setupCost !== null ? `setup ${gbpK(fig.setupCost)}` : null;
    case 'breakeven':
      return fig.breakEvenPct !== null ? `breaks even at ${Math.round(fig.breakEvenPct)}%` : null;
    case 'payback':
      return fig.paybackMonths !== null ? `pays back in ${fig.paybackMonths} months` : null;
    case 'motivation':
      return 'motivated seller';
  }
}

/** What an unknown must-have tells the member to check. */
const CHECK: Record<CriterionKey, string> = {
  location: 'Location unknown: check',
  budget: 'Price unknown: check',
  cash: 'Cash needed unknown: check',
  rent: 'Rent unknown: check',
  profit: 'Profit unknown: check',
  bedrooms: 'Bedrooms unknown: check',
  type: 'Type unknown: check',
  leasehold: 'Tenure unknown: check',
  restricted: 'Licensing unconfirmed: check',
  setup: 'Setup cost unknown: check',
  breakeven: 'Break-even unknown: check',
  payback: 'Payback unknown: check',
  motivation: 'Seller’s position unknown: check',
};

export interface Explanation {
  /** "2-bed · under £1,500 pcm · about 18 miles away · clears your £400 minimum". */
  why: string | null;
  /** "83% match · 5 of 6", "· 1 unknown" when any; null under two checks. */
  match: string | null;
  /** Must-haves it could not be judged on, and the member's "warn me" line for a licensed area. */
  flags: string[];
  /** "Near me + the best elsewhere": a deal from outside their area ("Best elsewhere"). */
  elsewhere: boolean;
}

export function matchLine(j: Judgement): string | null {
  if (j.checked < TAILORING.matchMinChecked) return null;
  const pct = Math.round((j.met / j.checked) * 100);
  return `${pct}% match · ${j.met} of ${j.checked}${j.unknown > 0 ? ` · ${j.unknown} unknown` : ''}`;
}

export function explain(f: DealFacts, fig: MemberFigures, j: Judgement, p: TailoringProfile, w: Wants, area: AreaLookup): Explanation {
  const byMode = (mode: 'must' | 'nice') => j.checks.filter((c: Check) => c.mode === mode && c.verdict === 'pass');
  const phrases: string[] = [];
  for (const c of [...byMode('must'), ...byMode('nice')]) {
    if (phrases.length >= 4) break;
    const words = phrase(c.key, f, fig, w);
    if (words && !phrases.includes(words)) phrases.push(words);
  }
  // The one reason "fit for you" lifted it most.
  const top = adjustmentsFor(f, fig, leaningsFor(p), area(f.area, f.bedrooms))
    .filter((a) => a.points > 0)
    .sort((a, b) => b.points - a.points)[0];
  if (top && !phrases.includes(top.reason)) phrases.push(top.reason);
  const flags = j.mustUnknown.map((k) => CHECK[k]);
  if (w.restricted === 'warn' && f.licensing === 'confirmed-licensed') flags.push('Short-let licence needed here');
  const elsewhere = Boolean(w.localAreas && f.area && !w.localAreas.has(f.area));
  return { why: phrases.length > 0 ? phrases.join(' · ') : null, match: matchLine(j), flags, elsewhere };
}

/** For a member with no new answers: the deal's strongest fact, from its card. */
export function genericWhy(card: DealCard, now: Date): string | null {
  const parts: string[] = [];
  const uplift = card.uplift_pct === null ? null : Number(card.uplift_pct);
  if (card.kind === 'sale' && uplift !== null && Number.isFinite(uplift) && uplift >= 40) parts.push(`+${Math.round(uplift)}% on a long let`);
  const profit = card.annual_profit === null ? null : Number(card.annual_profit);
  if (card.kind === 'rent' && profit !== null && Number.isFinite(profit) && profit > 0) parts.push(`${gbpK(profit)}/yr after rent`);
  const motivated = motivationLine(card, now)[0];
  if (motivated) parts.push(motivated.toLowerCase());
  return parts.length > 0 ? `Picked for: ${parts.slice(0, 2).join(' · ')}` : null;
}

/** A card (CARD_COLUMNS) explained for a profile; the generic line for one with no new answers. */
export function explainCard(card: DealCard, p: TailoringProfile | null | undefined, area: AreaLookup, now: Date): Explanation {
  if (!usesTailoring(p)) return { why: genericWhy(card, now), match: null, flags: [], elsewhere: false };
  const { qualifies } = motivationFor({ kind: card.kind, motivation: card.motivation, listed_date: card.listed_date, first_seen_at: card.first_seen_at }, p.goals, now);
  const m = parseMotivation(card.motivation);
  const facts = factsFromRow(card, rentalFromCard(card), { qualifies, score: m?.score ?? 0, fired: m?.fired });
  const wants = wantsFor(p);
  const { judgement, figures } = judgeDeal(facts, p, wants);
  return explain(facts, figures, judgement, p, wants, area);
}
