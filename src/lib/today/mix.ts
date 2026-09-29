/**
 * Today's 5 as a mix of the profile's chosen deal types (Batch 17, Part I;
 * the numbers decided 29 Sep, Q18 and Q28).
 *
 *   STARTING MIX  All three: 2 Short-let / 2 Rent-to-rent / 1 BRRR.
 *                 Two: 3 / 2, the extra slot to the type whose best match
 *                 is stronger that day. One: all 5.
 *   THE SHIFT     Each chosen type's weight is its starting slots plus the
 *                 Keeps of that type on this profile in the last 14 days ÷ 3.
 *                 The 5 slots are shared in proportion to the weights (largest
 *                 remainder), with at least 1 for every chosen type. All with
 *                 6 rent-to-rent Keeps: weights 2 / 4 / 1 → 1 / 3 / 1.
 *   EMPTY SLOTS   A type with fewer deals than its slots passes the spare ones
 *                 to the other CHOSEN types, strongest best match first. Never
 *                 to a type that was not chosen.
 *
 * The day's cards are then dealt round the types, strongest first, so the
 * mix reads as a mix. Every number is a setting (billing_settings.today_mix).
 *
 * Pure: no network, no database, no server-only.
 */

import { AVAILABLE_DEAL_TYPES, DEAL_TYPES, availableTypes, type DealType } from '../profile/deal-types.ts';
import { TODAY_SIZE } from './day.ts';

export const TODAY_MIX_KEY = 'today_mix';

export interface TodayMixSettings {
  /** The starting mix when every available type is chosen (a coming-soon type never has slots). */
  all: Partial<Record<DealType, number>>;
  /** Two types: the stronger one's slots, then the other's. */
  two: [number, number];
  /** Keeps counted over this many days. */
  windowDays: number;
  /** This many Keeps of a type weigh as one more slot. */
  keepsPerSlot: number;
  /** Every chosen type gets at least this many slots (while there are slots to give). */
  floor: number;
}

export const DEFAULT_TODAY_MIX: TodayMixSettings = {
  all: { buy_str: 2, brrr: 1, r2r: 2 },
  two: [3, 2],
  windowDays: 14,
  keepsPerSlot: 3,
  floor: 1,
};

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return asObject(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function wholeIn(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** The stored row; anything missing or out of bounds keeps its default, and each mix must add up to the day. */
export function parseTodayMix(raw: unknown): TodayMixSettings {
  const o = asObject(raw);
  const d = DEFAULT_TODAY_MIX;
  const a = asObject(o.all);
  // Every available type needs its share, and they fill the day; anything else in the row is ignored.
  const shares = AVAILABLE_DEAL_TYPES.map((t) => [t, wholeIn(a[t], 0, TODAY_SIZE)] as const);
  const allOk = shares.every(([, n]) => n !== null) && shares.reduce((sum, [, n]) => sum + (n ?? 0), 0) === TODAY_SIZE;
  const two = Array.isArray(o.two) ? o.two.map((v) => wholeIn(v, 0, TODAY_SIZE)) : [];
  const twoOk = two.length === 2 && two[0] !== null && two[1] !== null && two[0] + two[1] === TODAY_SIZE && two[0] >= two[1];
  return {
    all: allOk ? (Object.fromEntries(shares) as Partial<Record<DealType, number>>) : { ...d.all },
    two: twoOk ? [two[0]!, two[1]!] : [...d.two],
    windowDays: wholeIn(o.windowDays, 1, 90) ?? d.windowDays,
    keepsPerSlot: wholeIn(o.keepsPerSlot, 1, 50) ?? d.keepsPerSlot,
    floor: wholeIn(o.floor, 0, 2) ?? d.floor,
  };
}

/**
 * How strong each type's best match is today: higher is stronger, a type
 * with nothing to offer is absent. Ties go to the question's order.
 */
export type Strength = Partial<Record<DealType, number>>;

function byStrength(types: readonly DealType[], strength: Strength): DealType[] {
  const rank = (t: DealType) => strength[t] ?? Number.NEGATIVE_INFINITY;
  return [...types].sort((a, b) => rank(b) - rank(a) || DEAL_TYPES.indexOf(a) - DEAL_TYPES.indexOf(b));
}

/** The starting mix for these types (available ones only: a coming-soon type is never given a slot). */
export function baseSlots(types: readonly DealType[], strength: Strength = {}, s: TodayMixSettings = DEFAULT_TODAY_MIX, size = TODAY_SIZE): Partial<Record<DealType, number>> {
  const chosen = availableTypes(types);
  if (chosen.length === 0) return {};
  if (chosen.length === 1) return { [chosen[0]]: size };
  if (chosen.length === 2) {
    const [strong, weak] = byStrength(chosen, strength);
    return { [strong]: s.two[0], [weak]: s.two[1] };
  }
  return Object.fromEntries(chosen.map((t) => [t, s.all[t] ?? 0])) as Partial<Record<DealType, number>>;
}

/** The shift toward the types the member Keeps (largest remainder over the day, the floor honoured). */
export function mixSlots(types: readonly DealType[], keeps: Partial<Record<DealType, number>>, strength: Strength = {}, s: TodayMixSettings = DEFAULT_TODAY_MIX, size = TODAY_SIZE): Partial<Record<DealType, number>> {
  const chosen = availableTypes(types);
  const base = baseSlots(chosen, strength, s, size);
  if (chosen.length <= 1) return base;
  const weight = new Map(chosen.map((t) => [t, (base[t] ?? 0) + Math.max(0, keeps[t] ?? 0) / s.keepsPerSlot]));
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) return base;
  const tieOrder = byStrength(chosen, strength);
  // In proportion to the weights, whole slots first…
  const exact = new Map(chosen.map((t) => [t, (weight.get(t)! / total) * size]));
  const out = new Map(chosen.map((t) => [t, Math.floor(exact.get(t)!)]));
  const remainder = (t: DealType) => exact.get(t)! - Math.floor(exact.get(t)!);
  // …then the largest remainders (the heavier type, then the stronger match, on a tie).
  const byRemainder = [...chosen].sort((a, b) => remainder(b) - remainder(a) || weight.get(b)! - weight.get(a)! || tieOrder.indexOf(a) - tieOrder.indexOf(b));
  let left = size - [...out.values()].reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % byRemainder.length, left -= 1) out.set(byRemainder[i], out.get(byRemainder[i])! + 1);
  // The floor: a type below it takes a slot from the type with the most.
  const floor = Math.min(s.floor, Math.floor(size / chosen.length));
  for (const t of chosen) {
    while (out.get(t)! < floor) {
      const donor = [...chosen].filter((d) => d !== t && out.get(d)! > floor).sort((a, b) => out.get(b)! - out.get(a)! || remainder(a) - remainder(b))[0];
      if (!donor) break;
      out.set(donor, out.get(donor)! - 1);
      out.set(t, out.get(t)! + 1);
    }
  }
  return Object.fromEntries(out) as Partial<Record<DealType, number>>;
}

/**
 * The day's list: each type's best deals up to its slots, the spare slots
 * passed to the other chosen types (strongest best match first), dealt round
 * the types strongest first. A deal is never on the list twice, and a type
 * that was not chosen never appears, whatever `lists` holds.
 */
export function fillMix(types: readonly DealType[], slots: Partial<Record<DealType, number>>, lists: Partial<Record<DealType, readonly string[]>>, strength: Strength = {}, size = TODAY_SIZE): string[] {
  const chosen = byStrength(availableTypes(types), strength);
  const seen = new Set<string>();
  const avail = new Map(chosen.map((t) => [t, (lists[t] ?? []).filter((id) => (seen.has(id) ? false : (seen.add(id), true)))]));
  const take = new Map(chosen.map((t) => [t, Math.min(slots[t] ?? 0, avail.get(t)!.length)]));
  let spare = Math.min(size, chosen.reduce((n, t) => n + (slots[t] ?? 0), 0)) - [...take.values()].reduce((a, b) => a + b, 0);
  for (const t of chosen) {
    if (spare <= 0) break;
    const more = Math.min(spare, avail.get(t)!.length - take.get(t)!);
    if (more > 0) {
      take.set(t, take.get(t)! + more);
      spare -= more;
    }
  }
  const out: string[] = [];
  const cursor = new Map(chosen.map((t) => [t, 0]));
  while (out.length < size) {
    let added = false;
    for (const t of chosen) {
      const i = cursor.get(t)!;
      if (i >= take.get(t)!) continue;
      out.push(avail.get(t)![i]);
      cursor.set(t, i + 1);
      added = true;
      if (out.length >= size) break;
    }
    if (!added) break;
  }
  return out;
}
