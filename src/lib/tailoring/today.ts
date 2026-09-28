/**
 * Today for a tailored profile (Part A: must-haves and nice-to-haves; Part
 * B: the order, "fit for you" and near me + the best elsewhere, order.ts).
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
 *   4. Order (order.ts): the short-let check on the card, the income band,
 *      fewest nice-to-haves missed, most checks met, fit for you (the shared
 *      fit plus the profile's named adjustments), profit, and the deal id
 *      so the order never depends on how the rows came back. Counting
 *      misses and meets rather than a ratio means a deal is never lifted
 *      for the data it lacks.
 *   5. The last pass of the feedback rules on the full stored listing, a
 *      batch at a time until the day is full. A cautious member's or a
 *      beginner's day keeps projects back unless nothing else fills it.
 *      "Near me + the best elsewhere" takes 3 local deals and 2 from
 *      anywhere, each group filling from the other when short.
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
import { applyCandidateFeedback, feedbackRules, NEEDS_WORK } from '../listing/picks.ts';
import { rankForMember } from '../listing/rank.ts';
import { parseMotivation } from '../listing/motivation.ts';
import { DEFAULT_FILTERS } from '../marketplace/grid.ts';
import { applyKindFeedback, buildCandidate, dealKey, motivationFor, parseStoredDeal, type Built, type PoolRow, type TodayCandidate } from '../today/candidates.ts';
import { candidateContext, viableMisses, withFullListings, type ChooseInput, type ChooseReads, type TodayChoice } from '../today/choose.ts';
import { TODAY_SIZE } from '../today/day.ts';
import { TAILORING } from './config.ts';
import { factsFromRow, judgeDeal, wantsFor, type DealFacts, type Judgement, type MemberFigures, type Wants } from './criteria.ts';
import { adjustmentsFor, areaLookup, bonusOf, compareKeys, leaningsFor, orderKey } from './order.ts';
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
 * The tailored order (order.ts). `bonus` is "fit for you" on top of the
 * shared fit; missing entries are 0.
 */
export function tailoredOrder<C extends TodayCandidate & { fit: number }>(ranked: readonly C[], judged: ReadonlyMap<string, Judgement>, bonus: ReadonlyMap<string, number> = new Map()): C[] {
  const keys = new Map(ranked.map((c) => [c, orderKey(c, judged.get(c.dealId), bonus.get(c.dealId) ?? 0, c.profit, c.dealId)]));
  return [...ranked].sort((a, b) => compareKeys(keys.get(a)!, keys.get(b)!));
}

/**
 * Up to `need` of `ordered` that pass the full-listing check (the last pass
 * of the feedback rules on the full stored listing, as the untailored path
 * makes it), read a batch at a time. `holdBackWork`: a deal whose full
 * listing reads as a project is kept back, used only if the day cannot be
 * filled without it (cautious members and beginners). The full listing is
 * read server-side and never leaves.
 */
async function checkedHead<C extends TodayCandidate>(reads: ChooseReads, ordered: readonly C[], input: ChooseInput, need: number, holdBackWork = false): Promise<C[]> {
  const out: C[] = [];
  const later: C[] = [];
  const rules = feedbackRules(input.feedback);
  for (let i = 0; i < ordered.length && out.length < need; i += TAILORING.fullListingBatch) {
    const batch = ordered.slice(i, i + TAILORING.fullListingBatch);
    if (!holdBackWork) {
      out.push(...(await withFullListings(reads, batch, input.feedback, rules, batch.length)));
      continue;
    }
    const snapshots = await reads.fullListings(batch.map((c) => c.dealId));
    const full = batch.map((c) => {
      const snap = snapshots.get(c.dealId);
      return snap ? { ...c, listing: { ...snap, canonicalUrl: dealKey(c.dealId) } } : c;
    });
    const kept = new Set(applyCandidateFeedback(full, input.feedback, rules).map((c) => c.dealId));
    for (const c of batch) {
      if (!kept.has(c.dealId)) continue;
      const snap = snapshots.get(c.dealId);
      const words = snap ? [snap.title, snap.rawType ?? '', snap.priceQualifier ?? '', ...(snap.features ?? [])].join(' | ') : '';
      (NEEDS_WORK.test(words) ? later : out).push(c);
    }
  }
  return [...out, ...later].slice(0, need);
}

/** One pool row judged for one profile, with the facts and figures behind the judgement. */
export interface JudgedRow {
  judgement: Judgement;
  facts: DealFacts;
  figures: MemberFigures;
}

export function judgeRow(row: PoolRow, p: TailoringProfile, wants: Wants, now: Date): JudgedRow {
  const { qualifies } = motivationFor(row, p.goals, now);
  const m = parseMotivation(row.motivation);
  const facts = factsFromRow(row, parseStoredDeal(row.deal), { qualifies, score: m?.score ?? 0, fired: m?.fired });
  const { judgement, figures } = judgeDeal(facts, p, wants);
  return { judgement, facts, figures };
}

/** "N deals match you" for a tailored profile: the rows meeting every must-have. */
export function mustMatchCount(rows: readonly PoolRow[], p: TailoringProfile, now: Date): number {
  const wants = wantsFor(p);
  return rows.filter((row) => judgeRow(row, p, wants, now).judgement.mustFails.length === 0).length;
}

/**
 * "Near me + the best elsewhere": the local deals first, up to the local
 * slots, then the national ones, each group filling from the other when it
 * is short, in the tailored order throughout.
 */
function slotted<C extends TodayCandidate>(local: readonly C[], national: readonly C[], order: ReadonlyMap<string, number>): C[] {
  const { local: nLocal, national: nNational } = TAILORING.nearPlusBest;
  const chosen = [...local.slice(0, nLocal), ...national.slice(0, nNational)];
  const rest = [...local.slice(nLocal), ...national.slice(nNational)].sort((a, b) => (order.get(a.dealId) ?? 0) - (order.get(b.dealId) ?? 0));
  chosen.push(...rest.slice(0, Math.max(0, TODAY_SIZE - chosen.length)));
  return chosen.sort((a, b) => (order.get(a.dealId) ?? 0) - (order.get(b.dealId) ?? 0));
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

  const leanings = leaningsFor(p);
  const area = areaLookup(input.cards);

  const rows = await reads.pool(filters, TAILORING.poolLimit);
  const judged = new Map<string, Judgement>();
  const bonus = new Map<string, number>();
  const meetsMusts = new Set<string>();
  const exact: TodayCandidate[] = [];
  const misses: Built[] = [];
  let mustMatches = 0;
  for (const row of rows) {
    const { judgement, facts, figures } = judgeRow(row, p, wants, now);
    judged.set(row.id, judgement);
    bonus.set(row.id, bonusOf(adjustmentsFor(facts, figures, leanings, area(facts.area, facts.bedrooms))));
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
  const ordered = tailoredOrder(ranked, judged, bonus);
  const holdBack = leanings.steady && !leanings.bold;
  let fresh: TodayCandidate[] = [];
  if (need > 0 && wants.localAreas && current.length === 0) {
    const local = wants.localAreas;
    const isLocal = (c: TodayCandidate) => c.listing.postcodeArea !== null && local.has(c.listing.postcodeArea.toUpperCase());
    const position = new Map(ordered.map((c, i) => [c.dealId, i]));
    const [near, far] = await Promise.all([checkedHead(reads, ordered.filter(isLocal), input, TODAY_SIZE, holdBack), checkedHead(reads, ordered.filter((c) => !isLocal(c)), input, TODAY_SIZE, holdBack)]);
    fresh = slotted(near, far, position).slice(0, need);
  } else if (need > 0) fresh = await checkedHead(reads, ordered, input, need, holdBack);
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
  const [nearest] = await checkedHead(reads, closest.map((b) => b.candidate), input, 1, holdBack);
  if (nearest) return { dealIds: [nearest.dealId], nearMiss: true, advice: mustMissAdvice(judged.get(nearest.dealId)?.mustFails ?? []), mustMatches, capped: rows.length >= TAILORING.poolLimit };
  return { dealIds: [], nearMiss: false, advice: null, mustMatches, capped: rows.length >= TAILORING.poolLimit };
}
