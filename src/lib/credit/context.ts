import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is paying for the provider calls made inside a request. Set once at the
 * top of an action with `runMetered` and read by `meter()` deep inside the
 * provider clients, so no client signature has to carry billing fields.
 * Code that runs outside any metered scope (crons without a member, cache
 * builds, `after()` callbacks created elsewhere) is house spend.
 */
export interface MeterContext {
  /** null = house spend (logged, never charged). */
  userId: string | null;
  /** Admins run everything; usage is logged with bypass = true. */
  admin: boolean;
  action: string;
  actionId: string;
  /** Open reservation the debits settle against, when the action reserved up front. */
  reservationId?: string;
  /** Charge at most once per action (Google autocomplete sessions). */
  oncePerAction?: boolean;
  /**
   * Price this action's calls at this multiplier instead of each unit row's
   * own. Funnel leads run at x2 where the analyser runs at x5. Read by
   * `meter()` so the charge matches the estimate the caller quoted.
   */
  markupOverride?: number;
  /**
   * Enforce credit even when CREDIT_ENFORCE is off.
   *
   * Shadow mode exists so a billing bug degrades to a warning instead of
   * locking a member out, and for the members-only app that is the right
   * default. A PUBLIC endpoint spending a customer's money is the opposite
   * case: there, an unaffordable run must not proceed whatever the global
   * flag says, or a customer with a £0 balance gets unlimited leads at our
   * cost.
   */
  requireCredit?: boolean;
  /**
   * The funnel this spend belongs to, when it is a lead rather than the
   * member's own work.
   *
   * Written onto each debit so `/account/billing` can tell the two apart.
   * The rule that My reports and Leads never mix holds in storage,
   * navigation and the API; the billing history was the last place both
   * still read "Property report".
   */
  funnelId?: string | null;
}

const als = new AsyncLocalStorage<MeterContext>();

export function runMetered<T>(ctx: MeterContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentMeter(): MeterContext | undefined {
  return als.getStore();
}

export function newActionId(): string {
  return crypto.randomUUID();
}
