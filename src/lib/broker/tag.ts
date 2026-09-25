import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which broker question a provider call is answering, if any.
 *
 * The resolver runs each rung inside `withBrokerQuestion`, and `meter()` logs
 * that name as the call's `question`; calls made outside the broker (the
 * full report, its fallback, its thumbnail search) keep `provider.unit`.
 * The broker's daily budgets count only the tagged rows, so a member running
 * several full reports no longer switches off their competitor lookups.
 * Pure: no server-only imports.
 */
const als = new AsyncLocalStorage<string>();

export function withBrokerQuestion<T>(question: string, fn: () => T): T {
  return als.run(question, fn);
}

export function currentBrokerQuestion(): string | undefined {
  return als.getStore();
}

/** Whether a logged call counts toward the broker's budget for `provider`. */
export function countsTowardBrokerBudget(provider: string, question: string | null | undefined): boolean {
  return Boolean(question) && !question!.startsWith(`${provider}.`);
}
