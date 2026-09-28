/**
 * Today for a tailored profile (Part A: must-haves and nice-to-haves).
 *
 *   1. Read the member's visible pool narrowed only by kind (and their
 *      passes): every other answer is judged here, in memory, so a
 *      must-have can be switched to a nice-to-have without a different
 *      query, and each kind is judged by its own answers.
 *   2. Judge every deal (criteria.ts). A must-have it fails takes it off
 *      the list; a must-have it cannot be judged on leaves it on, flagged.
 *   3. Rank every deal that is left through the shared ranking (the
 *      feedback rules, the income bar, the money test, the short-let check),
 *      the whole pool and not just the best 40 by fit, so the order below
 *      is not decided by a cut made before it.
 *   4. Order: the short-let check on the card, the income band, fewest
 *      nice-to-haves missed, most checks met, fit, profit, and the deal id
 *      so the order never depends on how the rows came back. Counting
 *      misses and meets rather than a ratio means a deal is never lifted
 *      for the data it lacks.
 *   5. The last pass of the feedback rules on the full stored listing, a
 *      batch at a time until the day is full.
 *
 * Nothing meets the must-haves: the closest deal (fewest must-haves missed),
 * named as a near miss with what it misses. Nothing at all: an empty day,
 * which the page explains.
 *
 * Re-choosing (a switch changed, a widen applied): the cards that still
 * meet every must-have stay where they are, and so does anything the member
 * has answered or opened; only the rest are replaced, from deals not
 * already shown today. The same switch flipped back and forth settles on the
 * same list.
 *
 * Nothing here returns an address, a postcode or a listing URL.
 *
 * Pure: no network, no database, no server-only.
 */
import { feedbackRules } from '../listing/picks.ts';
import { rankForMember } from '../listing/rank.ts';
import { bandRank } from '../listing/screen.ts';
import { parseMotivation } from '../listing/motivation.ts';
import { DEFAULT_FILTERS } from '../marketplace/grid.ts';
import { applyKindFeedback, buildCandidate, motivationFor, parseStoredDeal, type Built, type PoolRow, type TodayCandidate } from '../today/candidates.ts';
import { candidateContext, viableMisses, withFullListings, type ChooseInput, type ChooseReads, type TodayChoice } from '../today/choose.ts';
import { TODAY_SIZE } from '../today/day.ts';
import { TAILORING } from './config.ts';
import { factsFromRow, judgeDeal, wantsFor, type Judgement, type Wants } from './criteria.ts';
import type { CriterionKey, TailoringProfile } from './profile.ts';

export interface TailoredOptions {
  /** Re-choosing: today's list as it stands. */
  current?: readonly string[];
  /** Of those, the ones that stay whatever the answers say: answered or opened. */
  pinned?: ReadonlySet<string>;
}

export interface TailoredChoice extends TodayChoice {
  /** Deals in the member's visible pool (passes left out) that meet every must-have: "N deals match you". */
  mustMatches: number;
  /** The pool read hit its limit, so that count is "at least". */
  capped: boolean;
}

/** What a near miss is told, per must-have it misses. */
const MISSES: Record<CriterionKey, string> = {
  location: 'it is outside where you look',
  budget: 'it is outside your budget',
  cash: 'it needs more cash than you said you have',
  rent: 'the rent is over your limit',
  profit: 'it falls short of your minimum profit',
  bedrooms: 'it has a different number of bedrooms',
  type: 'it is not the type of property you asked for',
  leasehold: 'it is leasehold',
  restricted: 'it is in an area with short-let restrictions',
  setup: 'its setup cost is over your budget',
  breakeven: 'its break-even occupancy is higher than you wanted',
  payback: 'it pays back more slowly than you wanted',
  motivation: 'the seller shows no sign of being motivated',
};

/** "Nothing met all your must-haves today. This is the closest: it is outside your budget." */
export function mustMissAdvice(keys: readonly CriterionKey[]): string {
  const parts = keys.map((k) => MISSES[k]);
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Nothing met all your must-haves today. This is the closest: ${list}. You can widen your search or make one of them a nice-to-have.`;
}

const byId = (a: { dealId: string }, b: { dealId: string }) => (a.dealId < b.dealId ? -1 : a.dealId > b.dealId ? 1 : 0);

/**
 * The tailored order (Part A). `bonus` is Part B's "fit for you" on top of
 * the shared fit; missing entries are 0.
 */
export function tailoredOrder<C extends TodayCandidate & { fit: number }>(ranked: readonly C[], judged: ReadonlyMap<string, Judgement>, bonus: ReadonlyMap<string, number> = new Map()): C[] {
  const missed = (c: C) => judged.get(c.dealId)?.niceMissed ?? 0;
  const met = (c: C) => judged.get(c.dealId)?.met ?? 0;
  const fit = (c: C) => c.fit + (bonus.get(c.dealId) ?? 0);
  const band = (c: C) => bandRank(c.screening?.band ?? 'qualified');
  return [...ranked].sort(
    (a, b) =>
      Number(a.precheck !== 'ok') - Number(b.precheck !== 'ok') ||
      band(a) - band(b) ||
      missed(a) - missed(b) ||
      met(b) - met(a) ||
      fit(b) - fit(a) ||
      (b.profit ?? -Infinity) - (a.profit ?? -Infinity) ||
      byId(a, b),
  );
}

/** Up to `need` of `ordered` that pass the full-listing check, read a batch at a time. */
async function checkedHead<C extends TodayCandidate>(reads: ChooseReads, ordered: readonly C[], input: ChooseInput, need: number): Promise<C[]> {
  const out: C[] = [];
  const rules = feedbackRules(input.feedback);
  for (let i = 0; i < ordered.length && out.length < need; i += TAILORING.fullListingBatch) {
    const batch = ordered.slice(i, i + TAILORING.fullListingBatch);
    out.push(...(await withFullListings(reads, batch, input.feedback, rules, batch.length)));
  }
  return out.slice(0, need);
}

/** One pool row judged for one profile. */
export function judgeRow(row: PoolRow, p: TailoringProfile, wants: Wants, now: Date): Judgement {
  const { qualifies } = motivationFor(row, p.goals, now);
  const facts = factsFromRow(row, parseStoredDeal(row.deal), { qualifies, score: parseMotivation(row.motivation)?.score ?? 0 });
  return judgeDeal(facts, p, wants).judgement;
}

/** "N deals match you" for a tailored profile: the rows meeting every must-have. */
export function mustMatchCount(rows: readonly PoolRow[], p: TailoringProfile, now: Date): number {
  const wants = wantsFor(p);
  return rows.filter((row) => judgeRow(row, p, wants, now).mustFails.length === 0).length;
}

export async function chooseTailored(input: ChooseInput, p: TailoringProfile, reads: ChooseReads, opts: TailoredOptions = {}): Promise<TailoredChoice> {
  const { goals, feedback, exclude, now } = input;
  const rules = feedbackRules(feedback);
  const filters = applyKindFeedback({ ...DEFAULT_FILTERS, kind: goals?.sourcingKind ?? 'both' }, rules);
  const mode = goals?.motivation.mode ?? 'off';
  // No price bounds: the budget and the rent ceiling are judged per kind below.
  const ctx = candidateContext(goals, filters, input.cards, now);
  const wants = wantsFor(p);
  const current = opts.current ?? [];
  const onList = new Set(current);
  const pinned = opts.pinned ?? new Set<string>();

  const rows = await reads.pool(filters, TAILORING.poolLimit);
  const judged = new Map<string, Judgement>();
  const meetsMusts = new Set<string>();
  const exact: TodayCandidate[] = [];
  const misses: Built[] = [];
  let mustMatches = 0;
  for (const row of rows) {
    const judgement = judgeRow(row, p, wants, now);
    judged.set(row.id, judgement);
    if (judgement.mustFails.length === 0) {
      mustMatches += 1;
      meetsMusts.add(row.id);
    }
    // Already today's (re-choosing), or never to be on it again.
    if (onList.has(row.id) || exclude.has(row.id)) continue;
    // "Wrong area" answers: the picks run stops searching there, Today stops showing it.
    if (row.postcode_area && rules.badAreas.has(row.postcode_area.toUpperCase())) continue;
    const built = buildCandidate(row, ctx);
    if (!built) continue;
    if (judgement.mustFails.length === 0) exact.push(built.candidate);
    else misses.push(built);
  }

  // ── The cards that stay (re-choosing) ──
  const stays = current.filter((id) => pinned.has(id) || meetsMusts.has(id));
  const need = Math.max(0, TODAY_SIZE - stays.length);

  // ── The day's list ──
  const ranked = rankForMember(exact, feedback, rules, { depth: Math.max(1, exact.length), mode }).ranked;
  const fresh = need > 0 ? await checkedHead(reads, tailoredOrder(ranked, judged), input, need) : [];
  if (stays.length > 0 || fresh.length > 0) {
    // Survivors keep their places; new deals take the freed ones, then the end.
    const queue = fresh.map((c) => c.dealId);
    const list: string[] = [];
    for (const id of current) {
      if (stays.includes(id)) list.push(id);
      else if (queue.length > 0) list.push(queue.shift()!);
    }
    list.push(...queue);
    return { dealIds: list.slice(0, TODAY_SIZE), nearMiss: false, advice: null, mustMatches, capped: rows.length >= TAILORING.poolLimit };
  }

  // ── Nothing meets the must-haves: the closest, and what it misses ──
  const viable = viableMisses(misses, feedback, rules);
  const missesOf = (b: Built) => judged.get(b.candidate.dealId)?.mustFails.length ?? 0;
  const closest = [...viable].sort(
    (a, b) =>
      missesOf(a) - missesOf(b) ||
      Number(a.candidate.precheck !== 'ok') - Number(b.candidate.precheck !== 'ok') ||
      (judged.get(a.candidate.dealId)?.niceMissed ?? 0) - (judged.get(b.candidate.dealId)?.niceMissed ?? 0) ||
      (judged.get(b.candidate.dealId)?.met ?? 0) - (judged.get(a.candidate.dealId)?.met ?? 0) ||
      (b.candidate.profit ?? -Infinity) - (a.candidate.profit ?? -Infinity) ||
      byId(a.candidate, b.candidate),
  );
  const [nearest] = await checkedHead(reads, closest.map((b) => b.candidate), input, 1);
  if (nearest) return { dealIds: [nearest.dealId], nearMiss: true, advice: mustMissAdvice(judged.get(nearest.dealId)?.mustFails ?? []), mustMatches, capped: rows.length >= TAILORING.poolLimit };
  return { dealIds: [], nearMiss: false, advice: null, mustMatches, capped: rows.length >= TAILORING.poolLimit };
}
