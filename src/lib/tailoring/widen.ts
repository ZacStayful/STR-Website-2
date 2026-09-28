/**
 * Part D: "widen and see". When a tailored profile's must-haves leave its
 * Today short of five, the page offers up to three changes, each with the
 * real number of deals it would add: "+10 miles · 6 more deals".
 *
 * The count is leave-one-out on the member's own visible pool, after every
 * check the list itself makes (exclusions and "wrong area", the feedback
 * rules, the money test and the income bar, strict suitability, motivated
 * only, and the last read of the full listing), less what is already on
 * today's list. A change that adds nothing is never offered.
 *
 * Offered, when the answer is a must-have:
 *   miles    search 10 miles further from home (to 100 at most)
 *   rent     a rent ceiling £250 higher
 *   profit   a minimum profit £100 lower
 *   cash     the next cash-available band up
 *   nice-*   any must-have made a nice-to-have
 *
 * One tap sends only the key. The server works the change out again from
 * the member's own answers (widenChanges), so a stale or forged form can
 * only make a change this page would have offered.
 *
 * Pure: no network, no database, no `server-only`.
 */
import { GOAL_OPTIONS, MAX_RENT_PCM_RANGE, type GoalOption, type MarketGoals } from '../market/goals.ts';
import type { ChooseInput, ChooseReads } from '../today/choose.ts';
import { TAILORING } from './config.ts';
import { activeCriteria, CRITERIA, modeOf, wantsFor } from './criteria.ts';
import { isSwitchable, type CriterionKey, type TailoringProfile } from './profile.ts';
import { admissible, passFullListing, tailoredFilters, tailoredRows } from './today.ts';

export type WidenKey = 'miles' | 'rent' | 'profit' | 'cash' | `nice-${CriterionKey}`;

export type WidenChange = { kind: 'goals'; goals: MarketGoals } | { kind: 'mode'; criterion: CriterionKey };

export interface WidenCandidate {
  key: WidenKey;
  label: string;
  change: WidenChange;
  /** The profile as it would be after the change. */
  profile: TailoringProfile;
}

export interface WidenOption {
  key: WidenKey;
  /** "+10 miles", "Rent up to £1,750", "Make bedrooms a nice-to-have". */
  label: string;
  /** Deals it would add to today's list. */
  adds: number;
}

export function isWidenKey(v: unknown): v is WidenKey {
  if (typeof v !== 'string') return false;
  if (v === 'miles' || v === 'rent' || v === 'profit' || v === 'cash') return true;
  return v.startsWith('nice-') && isSwitchable(v.slice(5));
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const CASH_LABELS: Record<GoalOption<'cashAvailable'>, string> = { u30: 'under £30k', '30-60': 'up to £60k', '60-100': 'up to £100k', '100-200': 'up to £200k', '200+': '£200k or more' };

/** Every change this profile could be offered, with what it would do: before counting. */
export function widenChanges(p: TailoringProfile): WidenCandidate[] {
  const g = p.goals;
  if (!g) return [];
  const w = wantsFor(p);
  const on = activeCriteria(w);
  const must = (k: CriterionKey) => on.has(k) && modeOf(k, p) === 'must';
  const out: WidenCandidate[] = [];
  const withGoals = (key: WidenKey, label: string, goals: MarketGoals) => out.push({ key, label, change: { kind: 'goals', goals }, profile: { ...p, goals } });

  const { milesStep, maxMiles, rentStepPcm, profitStepPcm } = TAILORING.widen;
  const nearHome = (g.where === 'near' || (g.where === null && g.home)) && g.maxDistanceMiles !== null && g.maxDistanceMiles < maxMiles;
  if (must('location') && nearHome) {
    const miles = Math.min(maxMiles, Math.ceil((g.maxDistanceMiles! + 1) / milesStep) * milesStep);
    withGoals('miles', `+${miles - g.maxDistanceMiles!} miles`, { ...g, maxDistanceMiles: miles });
  }
  if (must('rent') && w.rentMax !== null && w.rentMax + rentStepPcm <= MAX_RENT_PCM_RANGE.max) withGoals('rent', `Rent up to ${gbp(w.rentMax + rentStepPcm)}`, { ...g, maxRentPcm: w.rentMax + rentStepPcm });
  if (must('profit') && w.minProfit !== null && w.minProfit >= profitStepPcm) withGoals('profit', `Minimum profit ${gbp(w.minProfit - profitStepPcm)}`, { ...g, finance: { ...g.finance, targetMarginPcm: w.minProfit - profitStepPcm } });
  const bands = GOAL_OPTIONS.cashAvailable;
  const band = g.buyer.cashAvailable;
  const next = band ? bands[bands.indexOf(band) + 1] : undefined;
  if (must('cash') && next) withGoals('cash', `Cash ${CASH_LABELS[next]}`, { ...g, buyer: { ...g.buyer, cashAvailable: next } });

  for (const key of on) {
    if (!isSwitchable(key) || modeOf(key, p) !== 'must') continue;
    out.push({ key: `nice-${key}`, label: `Make ${CRITERIA[key].label.toLowerCase()} a nice-to-have`, change: { kind: 'mode', criterion: key }, profile: { ...p, modes: { ...p.modes, [key]: 'nice' } } });
  }
  return out;
}

/** The offers worth making, most deals first, each with its real count. */
export async function widenOptions(input: ChooseInput, p: TailoringProfile, reads: ChooseReads, current: readonly string[]): Promise<WidenOption[]> {
  const changes = widenChanges(p);
  if (changes.length === 0) return [];
  // The areas any change would look in are read in full too (a wider radius reaches past the country's top rows).
  const { rows } = await tailoredRows(reads, p, tailoredFilters(p, input.feedback), changes.flatMap((c) => [...(wantsFor(c.profile).areas ?? [])]));
  const already = new Set([...current, ...admissible(rows, input, p).map((c) => c.dealId)]);
  const deltas = changes.map((c) => ({ c, added: admissible(rows, input, c.profile).filter((x) => !already.has(x.dealId)) }));
  // One read of the full listings for the deals any change would add: only
  // when the member's own "Not for me" answers could drop one on its full
  // text, and for at most checkLimit of them (the rest are counted), so a
  // Today view never reads hundreds of listings.
  const union = [...new Map(deltas.flatMap((d) => d.added.map((x) => [x.dealId, x] as const))).values()];
  const checked = input.feedback.length > 0 ? union.slice(0, TAILORING.widen.checkLimit) : [];
  const dropped = new Set(checked.map((x) => x.dealId));
  for (const x of await passFullListing(reads, checked, input)) dropped.delete(x.dealId);
  return deltas
    .map(({ c, added }) => ({ key: c.key, label: c.label, adds: added.filter((x) => !dropped.has(x.dealId)).length }))
    .filter((o) => o.adds > 0)
    .sort((a, b) => b.adds - a.adds || (a.key < b.key ? -1 : 1))
    .slice(0, TAILORING.widen.maxSuggestions);
}
