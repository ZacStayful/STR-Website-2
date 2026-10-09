/**
 * Batch 23: call charging maths. Pure.
 *
 * Answered seconds are charged pro rata at the si:call_minute unit row's
 * price (raw × markup: 13p × 5 = 65p a minute), rounded up to the penny.
 * Every charge is capped at the member's displayed balance, so a call can
 * never push it below zero; any overrun is absorbed as house spend.
 *
 * Batch 25 (R2-13): "the balance" here is the credit a call may take
 * (callablePence): the displayed balance less what open reservations hold
 * for a running analysis, deep search or funnel lead, so the call never
 * spends credit that action will settle against. The ledger's
 * credit_debit_face refuses any more.
 */

/** Displayed pence for an answered call of `seconds` at `perMinutePence`. */
export function minutesChargePence(seconds: number, perMinutePence: number): number {
  if (!(seconds > 0) || !(perMinutePence > 0)) return 0;
  return Math.ceil((seconds * perMinutePence) / 60 - 1e-9);
}

/**
 * The face pence a call (or its texts and email) may take without touching
 * credit an open reservation holds. With nothing reserved, the displayed
 * balance. Otherwise the larger of two amounts that each always leave the
 * reservation covered (every spend rate is at least 1, so base pence never
 * exceed face pence): the spendable base itself, and the balance less the
 * reservation at the dearest spend rate.
 */
export function callablePence(b: { totalPence: number; spendableBasePence: number; reservedBasePence: number }, maxSpendRate: number): number {
  const total = Math.max(0, b.totalPence);
  if (!(b.reservedBasePence > 0)) return total;
  const rate = Math.max(1, Number.isFinite(maxSpendRate) ? maxSpendRate : 1);
  return Math.max(0, Math.min(total, Math.max(b.spendableBasePence, total - b.reservedBasePence * rate)));
}

/** The dearest spend rate in force (at least 1): how much face a reserved base penny can need. */
export function maxSpendRate(rates: { readonly [kind: string]: number } | { plan: number; welcome: number; topup: number; adjustment: number }): number {
  return Math.max(1, ...Object.values(rates).filter((r): r is number => typeof r === 'number' && Number.isFinite(r)));
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
