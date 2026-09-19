/**
 * When to warn a customer that an automatic payment is coming.
 *
 * Today the sequence is: low-balance email, then a charge. Nothing in
 * between says "a payment is about to be taken", which is how an auto
 * top-up arrives as a surprise on a card the customer had forgotten they
 * saved.
 *
 * The warning sits in the band ABOVE the auto-top-up threshold: close enough
 * that the charge is genuinely imminent, far enough that there is time to
 * turn it off or top up by hand first. One band means exactly one warning on
 * the way down rather than a stream of them.
 *
 * Pure, and tested, because `afterDebit` is dense, side-effecting and
 * entirely un-unit-testable — putting the decision inline there would mean
 * the one piece of logic worth checking is the one piece nobody can check.
 */

/**
 * How far above the threshold the warning band reaches, as a multiple.
 *
 * Two is deliberate rather than tuned. At a £20 threshold it opens at £40 —
 * roughly six standard funnel leads of warning, which is a useful amount of
 * notice without firing so early that the charge feels unrelated when it
 * finally lands.
 */
export const WARNING_BAND_MULTIPLE = 2;

export interface WarningInput {
  /** Base pence the balance covers after open reservations. */
  spendableBasePence: number;
  /** The customer's auto-top-up trigger. */
  thresholdPence: number;
  /** What would be charged. Null or 0 means auto top-up is OFF. */
  autoTopupAmountPence: number | null;
  /** When the last warning was sent, if any. */
  lastWarningAt: string | null;
  /** Start of the current billing cycle; a warning is sent once per cycle. */
  cycleStart: Date;
  now?: Date;
}

export type WarningDecision =
  | { warn: true }
  | { warn: false; because: 'auto_topup_off' | 'not_in_band' | 'already_sent_this_cycle' | 'unusable_threshold' };

/**
 * Whether to send the pre-charge warning now.
 *
 * Only fires when auto top-up is ON. With it off, `lowBalanceEmail` already
 * says the right thing — that credit is running out — and no payment is
 * coming, so a second email would be both redundant and untrue.
 */
export function shouldWarnBeforeTopup(input: WarningInput): WarningDecision {
  const amount = input.autoTopupAmountPence;
  if (!amount || amount <= 0) return { warn: false, because: 'auto_topup_off' };

  const threshold = input.thresholdPence;
  if (!Number.isFinite(threshold) || threshold <= 0) {
    // A missing or nonsense threshold has no band to sit above. Silence beats
    // warning about a charge at a figure we cannot state.
    return { warn: false, because: 'unusable_threshold' };
  }

  const balance = input.spendableBasePence;
  if (!Number.isFinite(balance)) return { warn: false, because: 'unusable_threshold' };

  // Strictly above the threshold: at or below it the charge is happening now,
  // and the receipt is the honest message rather than a warning about it.
  const inBand = balance > threshold && balance <= threshold * WARNING_BAND_MULTIPLE;
  if (!inBand) return { warn: false, because: 'not_in_band' };

  if (input.lastWarningAt) {
    const sent = new Date(input.lastWarningAt).getTime();
    if (Number.isFinite(sent) && sent >= input.cycleStart.getTime()) {
      return { warn: false, because: 'already_sent_this_cycle' };
    }
  }

  return { warn: true };
}

/** The band's upper edge, for wording and for tests. */
export function warningBandOpensAt(thresholdPence: number): number {
  return thresholdPence * WARNING_BAND_MULTIPLE;
}
