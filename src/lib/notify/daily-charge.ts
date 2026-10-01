/**
 * Batch 21: the daily email's charge rules, pure and tested.
 *
 *   dayChargeDue    whether a profile's part of the email is charged its day
 *                   (per_day pricing, src/lib/listing/daily-deals.ts): never
 *                   an admin, never a part without teasers, never a seat the
 *                   payer could not fund (Q2), never a member who has not
 *                   answered the mandatory questions (B49, Q16).
 *   freeTeasersFor  a member none of whose profiles the payer could fund still
 *                   gets their Today's 5, uncharged (the teasers carry no
 *                   address); a member funded in part keeps the funded
 *                   profiles and is told which were left out, as before.
 */
export type DailyMode = 'per_pick' | 'per_day';

export function dayChargeDue(p: { mode: DailyMode; admin: boolean; teasers: number; funded: boolean; mandatoryDone: boolean }): boolean {
  return p.mode === 'per_day' && !p.admin && p.teasers > 0 && p.funded && p.mandatoryDone;
}

export function freeTeasersFor(seats: readonly { funded: boolean }[]): boolean {
  return seats.length > 0 && seats.every((s) => !s.funded);
}
