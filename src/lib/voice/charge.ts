/**
 * Batch 23: call charging maths. Pure.
 *
 * Answered seconds are charged pro rata at the si:call_minute unit row's
 * price (raw × markup: 13p × 5 = 65p a minute), rounded up to the penny.
 * Every charge is capped at the member's displayed balance, so a call can
 * never push it below zero; any overrun is absorbed as house spend.
 */

/** Displayed pence for an answered call of `seconds` at `perMinutePence`. */
export function minutesChargePence(seconds: number, perMinutePence: number): number {
  if (!(seconds > 0) || !(perMinutePence > 0)) return 0;
  return Math.ceil((seconds * perMinutePence) / 60 - 1e-9);
}

/** What may actually be taken: never more than the balance. */
export function capToBalance(chargePence: number, balancePence: number): number {
  return Math.max(0, Math.min(Math.ceil(chargePence), Math.floor(Math.max(0, balancePence))));
}

/**
 * Seconds of calling the balance pays for, keeping enough back for the texts
 * the call may send, never more than the longest call.
 */
export function affordableSeconds(balancePence: number, perMinutePence: number, maxCallSeconds: number, reservePence = 0): number {
  if (!(perMinutePence > 0)) return maxCallSeconds;
  const usable = Math.max(0, balancePence - reservePence);
  return Math.max(0, Math.min(maxCallSeconds, Math.floor((usable / perMinutePence) * 60)));
}
