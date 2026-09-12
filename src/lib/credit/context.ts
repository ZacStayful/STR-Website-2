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
