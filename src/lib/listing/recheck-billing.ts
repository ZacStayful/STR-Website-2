/**
 * Batch 21 (B16, D16): who carries a listing re-check's page fetch.
 *
 * One fetch serves every member watching the URL (listing-recheck cron);
 * its nominal cost goes to the first watcher who can carry it: not away
 * (daily picks paused for inactivity: nothing is bought for them until they
 * are back), not a paused team seat (the house carries it, as before, when
 * nobody else can), and, with CREDIT_ENFORCE on, not at or below £0 (as the
 * Airbnb refresh already skips). With nobody to bill the page is not read
 * today and the rows wait at the back of the queue.
 */
export interface RecheckWatcher {
  userId: string;
  /** Daily picks paused for inactivity. */
  away: boolean;
  /** A team seat the owner has stopped paying for. */
  suspended: boolean;
  /** Whose credit a fetch for them is metered against. */
  payerId: string;
  memberId: string | null;
  /** Can be charged today: true in shadow mode; the balance decides when enforcing. */
  canPay: boolean;
}

/** `userId` null: the house pays (a paused seat's listing, nobody else watching). */
export type RecheckBill = { userId: string | null; memberId: string | null };

export function recheckBillFor(watchers: readonly RecheckWatcher[]): RecheckBill | null {
  let house: RecheckBill | null = null;
  for (const w of watchers) {
    if (w.away) continue;
    if (w.suspended) {
      house ??= { userId: null, memberId: w.memberId };
      continue;
    }
    if (!w.canPay) continue;
    return { userId: w.payerId, memberId: w.memberId };
  }
  return house;
}
