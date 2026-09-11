import 'server-only';

import { resolveQuestion, type BrokerDeps } from './resolve';
import { brokerLedger, brokerStore } from './store';
import type { BrokerContext, Question, ResolveResult } from './types';

export type { BrokerContext, ResolveResult } from './types';
export * from './questions';

let deps: BrokerDeps | null = null;

function getDeps(): BrokerDeps {
  if (!deps) deps = { store: brokerStore(), ledger: brokerLedger() };
  return deps;
}

/** Ask a question through the ladder. Never throws. */
export async function ask<P, T>(question: Question<P, T>, params: P, ctx: BrokerContext): Promise<ResolveResult<T>> {
  try {
    return await resolveQuestion(getDeps(), question, params, ctx);
  } catch (err) {
    console.error(`[broker] ${question.name} failed:`, err);
    return { value: null, provider: null, level: null, cached: false, stale: false, unavailable: true, updatedAt: null, costPence: 0 };
  }
}
