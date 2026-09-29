/**
 * Which way a Today list is chosen: tailored (Batch 14, src/lib/tailoring)
 * for a profile with any of the new answers, and exactly as before this
 * batch (choose.ts) for everyone else. choose.test.ts holds the second to a
 * golden record through this function.
 *
 * Batch 17: a profile shows the deal types it chose (Buy and let, BRRR,
 * Rent-to-rent). Each type is chosen on its own — the same chooser, its pool
 * narrowed to that type, judged on that type's own money answer (a BRRR
 * deal on the project budget) — and the day is their mix (mix.ts): the
 * starting mix shifted toward the types the member keeps, at least one of
 * each, empty slots only from other chosen types. A type never chosen is
 * never read. Only when no type has anything that meets the member's answers
 * is the closest near miss shown, as before.
 *
 * "I want rent-to-rent, not to buy" no longer flips the kind for the day: it
 * adds the type to the profile (Q25), so the choosers here never flip it.
 *
 * Pure: no network, no database, no server-only.
 */
import { withoutKindFlips, withoutReasons } from '../listing/picks.ts';
import { orderedTypes, type DealType } from '../profile/deal-types.ts';
import { chooseTailored, shortListAdvice, type TailoredOptions } from '../tailoring/today.ts';
import { usesTailoring } from '../tailoring/profile.ts';
import { chooseTodayFrom, type ChooseInput, type ChooseReads, type TodayChoice } from './choose.ts';
import { TODAY_SIZE } from './day.ts';
import { goalsForType, lightOnlyFor } from './type-filters.ts';
import { DEFAULT_TODAY_MIX, fillMix, mixSlots, type Strength } from './mix.ts';

export interface DayChoice extends TodayChoice {
  /** Tailored: the deals meeting every must-have ("N deals match you"). Null on the untailored path. */
  mustMatches: number | null;
  /** That count reached the pool's read limit. */
  capped: boolean;
}

async function chooseOne(input: ChooseInput, reads: ChooseReads, opts: TailoredOptions): Promise<DayChoice> {
  if (usesTailoring(input.tailoring)) return chooseTailored(input, input.tailoring, reads, opts);
  return { ...(await chooseTodayFrom(input, reads)), mustMatches: null, capped: false };
}

/** The member's feedback without the kind flips (a type is chosen, not flipped): picks.ts. */
export { withoutKindFlips };

/**
 * One type's own input (type-filters.ts): its kind and money answer, without
 * the kind flips. A BRRR list also leaves out "Needs too much work": every
 * Project deal needs work, and the profile chose them (the level is its "How
 * much work?" answer).
 */
export function inputForType(input: ChooseInput, t: DealType): ChooseInput {
  const g = input.goals;
  const goals = g ? goalsForType(g, t) : null;
  const feedback = withoutKindFlips(input.feedback);
  return {
    ...input,
    goals,
    feedback: t === 'brrr' ? withoutReasons(feedback, ['needs_work']) : feedback,
    tailoring: input.tailoring ? { ...input.tailoring, goals } : input.tailoring,
    types: [t],
  };
}

/**
 * The pool narrowed to one type: the rest of the reads unchanged. `lightOnly`
 * (a BRRR "Light refresh" answer on the untailored path): light projects
 * only. A tailored profile reads both levels and judges the answer as a
 * must-have it can switch (criteria.ts, work).
 */
export function readsForType(reads: ChooseReads, t: DealType, lightOnly = false): ChooseReads {
  return { ...reads, pool: (filters, limit) => reads.pool({ ...filters, types: [t], brrrLightOnly: lightOnly }, limit) };
}

function readsFor(input: ChooseInput, reads: ChooseReads, t: DealType): ChooseReads {
  return readsForType(reads, t, !usesTailoring(input.tailoring) && lightOnlyFor(input.goals, t));
}

export async function chooseDay(input: ChooseInput, reads: ChooseReads, opts: TailoredOptions = {}): Promise<DayChoice> {
  const types = input.types ? orderedTypes(input.types) : [];
  if (types.length === 0) return chooseOne(input, reads, opts);
  if (types.length === 1) return chooseOne(inputForType(input, types[0]), readsFor(input, reads, types[0]), opts);

  // Re-choosing a mixed list: each type keeps (and replaces) only its own cards.
  const current = opts.current ?? [];
  const typeOf = current.length > 0 && reads.dealTypes ? await reads.dealTypes([...current]) : new Map<string, DealType>();
  const optsFor = (t: DealType): TailoredOptions => (current.length === 0 ? opts : { ...opts, current: current.filter((id) => typeOf.get(id) === t) });

  const lists: Partial<Record<DealType, string[]>> = {};
  const strength: Strength = {};
  const nearMisses: DayChoice[] = [];
  let mustMatches = 0;
  let tailored = false;
  let capped = false;
  for (const t of types) {
    const c = await chooseOne(inputForType(input, t), readsFor(input, reads, t), optsFor(t));
    if (c.mustMatches !== null) {
      tailored = true;
      mustMatches += c.mustMatches;
    }
    capped = capped || c.capped;
    if (c.nearMiss) {
      nearMisses.push(c);
      continue;
    }
    lists[t] = c.dealIds;
    if (c.dealIds.length > 0) strength[t] = c.best ?? 0;
  }
  const slots = mixSlots(types, input.typeKeeps ?? {}, strength, input.mix ?? DEFAULT_TODAY_MIX);

  let dealIds: string[];
  if (current.length === 0) dealIds = fillMix(types, slots, lists, strength);
  else {
    // The cards each type kept stay where they are; the freed places take the
    // fresh cards in the mix's order, then the end.
    const kept = new Set(Object.values(lists).flat());
    const staying = current.filter((id) => kept.has(id));
    const fresh: Partial<Record<DealType, string[]>> = {};
    const freeSlots: Partial<Record<DealType, number>> = {};
    for (const t of types) {
      fresh[t] = (lists[t] ?? []).filter((id) => !current.includes(id));
      freeSlots[t] = Math.max(0, (slots[t] ?? 0) - staying.filter((id) => typeOf.get(id) === t).length);
    }
    const queue = fillMix(types, freeSlots, fresh, strength, Math.max(0, TODAY_SIZE - staying.length));
    const list: string[] = [];
    for (const id of current) {
      if (staying.includes(id)) list.push(id);
      else if (queue.length > 0) list.push(queue.shift()!);
    }
    list.push(...queue);
    dealIds = list.slice(0, TODAY_SIZE);
  }

  if (dealIds.length === 0) {
    // Nothing of any chosen type meets the member's answers: the closest, as before.
    const closest = nearMisses.find((c) => c.dealIds.length > 0);
    if (closest) return { ...closest, mustMatches: tailored ? mustMatches : null, capped };
    return { dealIds: [], nearMiss: false, advice: null, mustMatches: tailored ? mustMatches : null, capped, best: null };
  }
  return { dealIds, nearMiss: false, advice: tailored ? shortListAdvice(dealIds.length) : null, mustMatches: tailored ? mustMatches : null, capped, best: null };
}
