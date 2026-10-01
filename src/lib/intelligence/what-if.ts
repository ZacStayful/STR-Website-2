/**
 * Batch 22, Part F: "here's what would find you one". When the reveal (or
 * Today) has no close match, up to WHAT_IF_MAX_VARIANTS one-change versions of
 * the member's answers are judged against the same pool with Today's own
 * checks (what-if-server.ts), and the best 1–3 are offered with real counts.
 *
 * One change each:
 *   budget / brrr_budget  the next budget band up (bands can't be saved as
 *                         +10%: "Change my budget" instead of "Use this")
 *   rent_10 / rent_20     maximum rent +10% / +20%
 *   areas                 the 3 nearest areas added (areas members)
 *   miles                 10 miles further from home (near-home members)
 *   beds_down / beds_up   bedrooms ±1 (when set)
 *   type_either           flats as well as houses, or houses as well as flats
 *   profit                the minimum profit 20% lower (when set)
 *   add_<type>            ONE deal type the profile didn't choose added (never removes one)
 *
 * "Use this" sends only the key; the server works the change out again from
 * the member's own answers (whatIfChanges), so a stale or forged form can only
 * make a change this page would have offered.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MarketGoals } from '../market/goals.ts';
import { BUDGET_LABELS, type Budget } from '../market/filters.ts';
import { AVAILABLE_DEAL_TYPES, DEAL_TYPE_LABELS, dealTypeOf, typesShown, withAddedType, type DealType } from '../profile/deal-types.ts';
import { activeCriteria, modeOf, wantsFor } from '../tailoring/criteria.ts';
import type { CriterionKey, TailoringProfile } from '../tailoring/profile.ts';
import { WHAT_IF_BUDGET_STEPS, WHAT_IF_EXTRA_MILES, WHAT_IF_MAX_VARIANTS, WHAT_IF_MIN_PROFIT_STEP } from './config.ts';
import type { ChooseInput, ChooseReads } from '../today/choose.ts';
import { admissible, judgeRow, tailoredFilters, tailoredRows } from '../tailoring/today.ts';
import { TAILORING } from '../tailoring/config.ts';

export type WhatIfKey = 'budget' | 'brrr_budget' | 'rent_10' | 'rent_20' | 'areas' | 'miles' | 'beds_down' | 'beds_up' | 'type_either' | 'profit' | `add_${DealType}`;

/** How the change is made: saved for the member, or a link to the answer to change themselves. */
export type WhatIfSave = 'use' | 'budget';

export interface WhatIf {
  key: WhatIfKey;
  /** "raise your budget to £350k–£500k" — fits "If you {phrase}, I'd have …". */
  phrase: string;
  /** The answer it changes is a must-have. */
  mustHave: boolean;
  save: WhatIfSave;
  /** The answers after the change. */
  goals: MarketGoals;
  /** Areas after the change (the areas variant adds some). */
  savedAreas: string[];
  profile: TailoringProfile;
}

const BANDS: Exclude<Budget, 'any'>[] = ['u200', '200-350', '350-500', '500+'];
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export function isWhatIfKey(v: unknown): v is WhatIfKey {
  if (typeof v !== 'string') return false;
  if (['budget', 'brrr_budget', 'rent_10', 'rent_20', 'areas', 'miles', 'beds_down', 'beds_up', 'type_either', 'profit'].includes(v)) return true;
  return v.startsWith('add_') && (AVAILABLE_DEAL_TYPES as readonly string[]).includes(v.slice(4));
}

const nextBand = (b: Exclude<Budget, 'any'> | null) => (b ? BANDS[BANDS.indexOf(b) + 1] ?? null : null);

/** Every one-change variant this member could be offered, before counting (at most WHAT_IF_MAX_VARIANTS). */
export function whatIfChanges(p: TailoringProfile, extra: { nearbyAreas: readonly string[] }): WhatIf[] {
  const g = p.goals;
  if (!g) return [];
  const on = activeCriteria(wantsFor(p));
  const must = (k: CriterionKey) => on.has(k) && modeOf(k, p) === 'must';
  const types = typesShown({ goals: g, about: p.about });
  const out: WhatIf[] = [];
  const add = (key: WhatIfKey, phrase: string, criterion: CriterionKey | null, goals: MarketGoals, save: WhatIfSave = 'use', savedAreas = p.savedAreas) =>
    out.push({ key, phrase, mustHave: criterion ? must(criterion) : false, save, goals, savedAreas, profile: { ...p, goals, savedAreas } });

  // Budgets of the chosen types.
  if (types.includes('buy_str')) {
    const up = nextBand(g.budget);
    if (up) add('budget', `raise your budget to ${BUDGET_LABELS[up]}`, 'budget', { ...g, budget: up }, 'budget');
  }
  if (types.includes('brrr')) {
    const up = nextBand(g.brrr.budget);
    if (up) add('brrr_budget', `raise your project budget to ${BUDGET_LABELS[up]}`, 'budget', { ...g, brrr: { ...g.brrr, budget: up } }, 'budget');
  }
  if (types.includes('r2r') && g.maxRentPcm !== null) {
    const [a, b] = WHAT_IF_BUDGET_STEPS;
    const ten = Math.round((g.maxRentPcm * (1 + a)) / 50) * 50;
    const twenty = Math.round((g.maxRentPcm * (1 + b)) / 50) * 50;
    add('rent_10', `pay up to ${gbp(ten)} a month in rent`, 'rent', { ...g, maxRentPcm: ten });
    if (twenty > ten) add('rent_20', `pay up to ${gbp(twenty)} a month in rent`, 'rent', { ...g, maxRentPcm: twenty });
  }
  // Wider area.
  if (g.where === 'near' && g.maxDistanceMiles !== null) {
    add('miles', `look ${WHAT_IF_EXTRA_MILES} miles further`, 'location', { ...g, maxDistanceMiles: g.maxDistanceMiles + WHAT_IF_EXTRA_MILES });
  } else if (extra.nearbyAreas.length > 0 && (g.where === 'areas' || g.where === null)) {
    const areas = [...new Set([...p.savedAreas, ...extra.nearbyAreas])];
    add('areas', `add ${listOf(extra.nearbyAreas)}`, 'location', g, 'use', areas);
  }
  // Bedrooms ±1.
  if (g.bedrooms !== null) {
    if (g.bedrooms > 1) add('beds_down', `look at ${g.bedrooms - 1}-bed instead of ${g.bedrooms === 4 ? '4+' : g.bedrooms}-bed`, 'bedrooms', { ...g, bedrooms: (g.bedrooms - 1) as 1 | 2 | 3 });
    if (g.bedrooms < 4) add('beds_up', `look at ${g.bedrooms + 1 === 4 ? '4+' : g.bedrooms + 1}-bed instead of ${g.bedrooms}-bed`, 'bedrooms', { ...g, bedrooms: (g.bedrooms + 1) as 2 | 3 | 4 });
  }
  // Property type: the other one as well.
  const t = g.buyer.propertyType;
  if (t === 'house' || t === 'flat') add('type_either', t === 'house' ? 'take flats as well as houses' : 'take houses as well as flats', 'type', { ...g, buyer: { ...g.buyer, propertyType: 'either' as typeof t } });
  // Minimum profit −20%, when the member set one (Today's own wants).
  const w = wantsFor(p);
  if ((w.minProfit ?? 0) > 0 || (w.minProfitR2r ?? 0) > 0) {
    const lower = (n: number) => Math.round((n * (1 - WHAT_IF_MIN_PROFIT_STEP)) / 25) * 25;
    const buy = w.minProfit !== null && w.minProfit > 0 ? lower(w.minProfit) : null;
    const r2r = w.minProfitR2r !== null && w.minProfitR2r > 0 ? lower(w.minProfitR2r) : null;
    add('profit', `set your minimum profit at ${gbp((buy ?? r2r)!)} a month`, 'profit', {
      ...g,
      finance: buy !== null ? { ...g.finance, targetMarginPcm: buy } : g.finance,
      r2r: r2r !== null ? { ...g.r2r, minMarginPcm: r2r } : g.r2r,
    });
  }
  // One deal type they didn't choose, added (never removed): one suggestion, the first that applies.
  for (const type of AVAILABLE_DEAL_TYPES) {
    if (types.includes(type)) continue;
    const next = withAddedType({ goals: g, about: p.about }, type);
    if (next) {
      add(`add_${type}`, `add ${DEAL_TYPE_LABELS[type]} deals to what I show you`, null, next);
      break;
    }
  }
  // Nice-to-have changes first (they cost the member least), then in the order above.
  return [...out.filter((x) => !x.mustHave), ...out.filter((x) => x.mustHave)].slice(0, WHAT_IF_MAX_VARIANTS);
}

function listOf(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export interface WhatIfResult {
  key: WhatIfKey;
  phrase: string;
  mustHave: boolean;
  save: WhatIfSave;
  count: number;
  best: { dealId: string; matchPct: number | null; profitLine: string | null } | null;
}

/**
 * The ones worth showing: at least one match, nice-to-have changes first
 * (they cost the member least), then the most matches; at most `shown`.
 */
export function bestWhatIfs(results: readonly WhatIfResult[], shown: number): WhatIfResult[] {
  return results
    .filter((r) => r.count > 0)
    .sort((a, b) => Number(a.mustHave) - Number(b.mustHave) || b.count - a.count || (a.key < b.key ? -1 : 1))
    .slice(0, shown);
}

/** "If you raise your budget to £350k–£500k, I'd have 6 matches — the best is 88% (£1,150–£1,400/month)." */
export function whatIfLine(r: WhatIfResult): string {
  const n = `${r.count} match${r.count === 1 ? '' : 'es'}`;
  const best = r.best ? (r.best.matchPct !== null ? ` — the best is ${r.best.matchPct}%${r.best.profitLine ? ` (${r.best.profitLine})` : ''}` : r.best.profitLine ? ` — the best makes ${r.best.profitLine}` : '') : '';
  return `If you ${r.phrase}, I’d have ${n}${best}.`;
}

export const NO_WHAT_IF_LINE = 'Nothing near your criteria yet — I’m searching your area and I’ll tell you when one comes up.';
export const NO_WHAT_IF_LINE_NO_SEARCH = 'Nothing near your criteria yet — I’ll tell you when one comes up.';

/**
 * Each variant judged on one read of the pool (with the extra areas any
 * variant looks in), with Today's own checks (admissible): how many deals it
 * would show that today's answers don't, and the best of them. No AI, no
 * provider call.
 */
export async function whatIfResults(input: ChooseInput, p: TailoringProfile, reads: Pick<ChooseReads, 'pool'>, variants: readonly WhatIf[]): Promise<WhatIfResult[]> {
  if (variants.length === 0) return [];
  const extraAreas = variants.flatMap((v) => [...(wantsFor(v.profile).areas ?? [])]);
  const wide = { ...p, goals: { ...p.goals!, sourcingKind: 'both' as const } };
  const { rows } = await tailoredRows(reads, wide, tailoredFilters(wide, input.feedback), extraAreas);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Never a deal type the answers don't choose (Batch 17): each variant sees only its own types.
  const ofTypes = (goals: MarketGoals | null) => {
    const allowed = new Set(typesShown({ goals, about: p.about }));
    return rows.filter((r) => allowed.has(dealTypeOf({ kind: r.kind, project: (r as { project?: unknown }).project })));
  };
  const already = new Set(admissible(ofTypes(p.goals), input, p).map((c) => c.dealId));
  return variants.map((v) => {
    const added = admissible(ofTypes(v.goals), input, v.profile).filter((c) => !already.has(c.dealId));
    const top = added[0];
    const row = top ? byId.get(top.dealId) : undefined;
    let best: WhatIfResult['best'] = null;
    if (top && row) {
      const j = judgeRow(row, v.profile, wantsFor(v.profile), input.now).judgement;
      const pct = j.checked >= TAILORING.matchMinChecked ? Math.round((j.met / j.checked) * 100) : null;
      const profit = row.annual_profit === null || row.annual_profit === undefined ? null : Number(row.annual_profit);
      best = { dealId: top.dealId, matchPct: pct, profitLine: profit && profit > 0 ? `${gbp(profit / 12)}/month` : null };
    }
    return { key: v.key, phrase: v.phrase, mustHave: v.mustHave, save: v.save, count: added.length, best };
  });
}

/**
 * "Use this": the quiz answer that makes the change (saved through the quiz's
 * own answerQuestion, so it is logged as profile_edited and re-chooses Today
 * like any answer), and the one that undoes it. Null for a budget band, which
 * the member changes themselves ("Change my budget").
 */
export function whatIfAnswer(v: WhatIf, before: { goals: MarketGoals; savedAreas: readonly string[] }): { questionId: string; value: unknown; undo: unknown } | null {
  const g = v.goals;
  const b = before.goals;
  const where = (goals: MarketGoals, areas: readonly string[]) => ({ mode: goals.where ?? 'areas', postcode: goals.home?.postcode ?? null, miles: goals.maxDistanceMiles, areas: [...areas] });
  switch (v.key) {
    case 'budget':
    case 'brrr_budget':
      return null;
    case 'rent_10':
    case 'rent_20':
      return { questionId: 'max_rent', value: g.maxRentPcm, undo: b.maxRentPcm };
    case 'miles':
      return { questionId: 'where', value: where(g, before.savedAreas), undo: where(b, before.savedAreas) };
    case 'areas':
      return { questionId: 'where', value: { ...where(g, v.savedAreas), mode: 'areas' }, undo: where(b, before.savedAreas) };
    case 'beds_down':
    case 'beds_up':
      return { questionId: 'bedrooms', value: String(g.bedrooms), undo: b.bedrooms === null ? null : String(b.bedrooms) };
    case 'type_either':
      return { questionId: 'property_type', value: 'either', undo: b.buyer.propertyType };
    case 'profit':
      return g.finance.targetMarginPcm !== b.finance.targetMarginPcm
        ? { questionId: 'min_profit', value: g.finance.targetMarginPcm, undo: b.finance.targetMarginPcm }
        : { questionId: 'r2r_min_profit', value: g.r2r.minMarginPcm, undo: b.r2r.minMarginPcm };
    default:
      // add_<type>: the deal types with one added.
      return { questionId: 'deal_types', value: g.dealTypes, undo: b.dealTypes };
  }
}
