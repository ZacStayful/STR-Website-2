/**
 * Daily deals (Today's 5) priced by the day, from
 * billing_settings.new_pricing_from: todays_5_daily_pence (33p on a plan)
 * for each day the email is delivered, instead of the charge per pick. Before
 * that date the pick is charged exactly as it always was.
 *
 * Also the one rule both ways of charging share: a payer's balance is spent
 * in order across everyone it pays for, so teammates on one owner's credit
 * cannot between them overdraw it (the purse below).
 *
 * Pure: no server-only, relative `.ts` imports only.
 */

import { dailyDealsMonthly, formatPence, newPricingActive, type DealPricing } from '../credit/deal-pricing.ts';

export type DailyDealsMode = 'per_pick' | 'per_day';

/** How Today's 5 is charged at this moment. */
export function dailyDealsMode(pricing: Pick<DealPricing, 'newPricingFrom'>, at: Date = new Date()): DailyDealsMode {
  return newPricingActive(pricing, at) ? 'per_day' : 'per_pick';
}

/** The day a charge belongs to: the UTC day, the same day the daily email slot is kept by. */
export function dailyChargeDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * What each paying account can still spend in this run, in base pence. A
 * member's cost is taken from their payer's purse before they are sent
 * anything; a cheaper send gives the difference back.
 */
export class PayerPurse {
  private readonly left = new Map<string, number>();

  /** `spendable`: each payer's spendable base pence, or null when it could not be read. */
  constructor(spendable: ReadonlyMap<string, number | null>) {
    for (const [payer, pence] of spendable) if (pence !== null && Number.isFinite(pence)) this.left.set(payer, pence);
  }

  /** Whether the payer's balance could be read at all. */
  known(payerId: string): boolean {
    return this.left.has(payerId);
  }

  remaining(payerId: string): number {
    return this.left.get(payerId) ?? 0;
  }

  /** Takes `pence` if the payer can cover it; otherwise takes nothing. */
  take(payerId: string, pence: number): boolean {
    if (pence <= 0) return true;
    const left = this.left.get(payerId);
    if (left === undefined || left + 1e-9 < pence) return false;
    this.left.set(payerId, left - pence);
    return true;
  }

  giveBack(payerId: string, pence: number): void {
    if (pence <= 0 || !this.left.has(payerId)) return;
    this.left.set(payerId, (this.left.get(payerId) ?? 0) + pence);
  }

  /** Moves a member's hold from `from` to `to` pence: true when the payer can cover the change. */
  adjust(payerId: string, from: number, to: number): boolean {
    if (to <= from) {
      this.giveBack(payerId, from - to);
      return true;
    }
    return this.take(payerId, to - from);
  }
}

/** One member's day of daily deals, in the words of the Notifications panel and the pricing page. */
export function dailyDealsLine(dailyPence: number): string {
  return `Daily deals: ${formatPence(dailyPence)} a day, ${dailyDealsMonthly(dailyPence)}, charged only on days we send them`;
}
