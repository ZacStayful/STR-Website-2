import type { BrokerContext, BrokerLedger, BrokerStore, CachedAnswer, ProviderName, Question, ResolveResult } from './types.ts';
import { MAX_LEVEL, budgetFor, providerEnabled } from './config.ts';

/**
 * Walks a question's ladder. Order of business for each call:
 *   1. cache hit that is still fresh → return it (no provider touched);
 *      (a `cacheOnly` context stops here: a stale hit is returned as stale,
 *      nothing else is `unavailable`);
 *   2. otherwise climb rungs in order, skipping disabled providers, rungs
 *      above the mode's max level, and paid rungs that would breach today's
 *      budget; the first non-null, sufficient answer is cached and returned;
 *   3. if nothing answered but a stale cached answer exists → return it
 *      flagged `stale`; else `unavailable`.
 * Identical concurrent requests share one in-flight promise.
 */

export interface BrokerDeps {
  store: BrokerStore;
  ledger: BrokerLedger;
  now?: () => Date;
  enabled?: (p: ProviderName) => boolean;
}

const inFlight = new Map<string, Promise<ResolveResult<unknown>>>();

/**
 * Today's spend per provider and payer, remembered for a few seconds per
 * ledger and bumped as rungs succeed, so a report that asks a dozen
 * questions at once reads the ledger once rather than a dozen times, and
 * the parallel asks see each other's spend instead of all passing the same
 * pre-spend figure. Keyed by ledger so tests, which build their own, stay
 * independent.
 */
const SPENT_MEMO_MS = 5_000;
const spentMemo = new WeakMap<BrokerLedger, Map<string, { at: number; pence: number }>>();

async function spentToday(ledger: BrokerLedger, provider: ProviderName, userId: string | null | undefined, now: number): Promise<number> {
  let memo = spentMemo.get(ledger);
  if (!memo) {
    memo = new Map();
    spentMemo.set(ledger, memo);
  }
  const key = `${provider}|${userId ?? ''}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < SPENT_MEMO_MS) return hit.pence;
  const pence = await ledger.spentToday(provider, userId ?? undefined);
  memo.set(key, { at: now, pence });
  return pence;
}

function addSpent(ledger: BrokerLedger, provider: ProviderName, userId: string | null | undefined, pence: number): void {
  const memo = spentMemo.get(ledger);
  const key = `${provider}|${userId ?? ''}`;
  const hit = memo?.get(key);
  if (hit) hit.pence += pence;
}

export async function resolveQuestion<P, T>(deps: BrokerDeps, question: Question<P, T>, params: P, ctx: BrokerContext): Promise<ResolveResult<T>> {
  const key = question.key(params);
  const flightKey = `${question.name}|${key}|${ctx.mode}|${ctx.cacheOnly ? 'ro' : 'rw'}`;
  const existing = inFlight.get(flightKey);
  if (existing && !ctx.bypassCache) return existing as Promise<ResolveResult<T>>;
  const p = run(deps, question, params, ctx, key).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, p as Promise<ResolveResult<unknown>>);
  return p;
}

async function run<P, T>(deps: BrokerDeps, question: Question<P, T>, params: P, ctx: BrokerContext, key: string): Promise<ResolveResult<T>> {
  const now = (deps.now ?? (() => new Date()))();
  const enabled = deps.enabled ?? providerEnabled;
  const cached = ctx.bypassCache ? null : await safeGet<T>(deps.store, question.name, key);
  if (cached && new Date(cached.expiresAt).getTime() > now.getTime()) {
    void deps.ledger.record({ provider: cached.provider, question: question.name, key, costPence: 0, cacheHit: true, userId: ctx.userId ?? null, ok: true, ms: 0 }).catch(() => {});
    return { value: cached.value, provider: cached.provider, level: cached.level, cached: true, stale: false, unavailable: false, updatedAt: cached.fetchedAt, costPence: 0 };
  }

  if (ctx.cacheOnly) {
    if (cached) return { value: cached.value, provider: cached.provider, level: cached.level, cached: true, stale: true, unavailable: false, updatedAt: cached.fetchedAt, costPence: 0 };
    return { value: null, provider: null, level: null, cached: false, stale: false, unavailable: true, updatedAt: null, costPence: 0 };
  }

  const maxLevel = MAX_LEVEL[ctx.mode];
  for (const rung of question.rungs) {
    if (rung.level > maxLevel) continue;
    if (!enabled(rung.provider)) continue;
    if (rung.enabled && !rung.enabled()) continue;
    if (rung.costPence > 0) {
      const budget = budgetFor(rung.provider);
      const global = await spentToday(deps.ledger, rung.provider, null, Date.now());
      if (global + rung.costPence > budget.globalPence) continue;
      if (ctx.userId) {
        const mine = await spentToday(deps.ledger, rung.provider, ctx.userId, Date.now());
        if (mine + rung.costPence > budget.memberPence) continue;
      }
    }
    const started = Date.now();
    let value: T | null = null;
    let ok = true;
    try {
      value = await rung.run(params);
    } catch (err) {
      ok = false;
      console.error(`[broker] ${question.name} rung ${rung.provider} threw:`, err);
    }
    const ms = Date.now() - started;
    if (rung.costPence > 0 || !ok) {
      void deps.ledger.record({ provider: rung.provider, question: question.name, key, costPence: ok ? rung.costPence : 0, cacheHit: false, userId: ctx.userId ?? null, ok, ms }).catch(() => {});
      if (ok) {
        addSpent(deps.ledger, rung.provider, null, rung.costPence);
        if (ctx.userId) addSpent(deps.ledger, rung.provider, ctx.userId, rung.costPence);
      }
    }
    if (value === null || value === undefined) continue;
    if (rung.sufficient && !rung.sufficient(value)) continue;
    const fetchedAt = now.toISOString();
    const answer: CachedAnswer<T> = { value, provider: rung.provider, level: rung.level, fetchedAt, expiresAt: new Date(now.getTime() + rung.ttlMs).toISOString() };
    await safeSet(deps.store, question.name, key, answer);
    return { value, provider: rung.provider, level: rung.level, cached: false, stale: false, unavailable: false, updatedAt: fetchedAt, costPence: rung.costPence };
  }

  if (cached) {
    return { value: cached.value, provider: cached.provider, level: cached.level, cached: true, stale: true, unavailable: false, updatedAt: cached.fetchedAt, costPence: 0 };
  }
  return { value: null, provider: null, level: null, cached: false, stale: false, unavailable: true, updatedAt: null, costPence: 0 };
}

async function safeGet<T>(store: BrokerStore, question: string, key: string): Promise<CachedAnswer<T> | null> {
  try {
    return await store.get<T>(question, key);
  } catch (err) {
    console.error('[broker] cache read failed:', err);
    return null;
  }
}

async function safeSet<T>(store: BrokerStore, question: string, key: string, answer: CachedAnswer<T>): Promise<void> {
  try {
    await store.set(question, key, answer);
  } catch (err) {
    console.error('[broker] cache write failed:', err);
  }
}

/** In-memory adapters for tests and for environments without Supabase. */
export function memoryStore(): BrokerStore & { map: Map<string, CachedAnswer<unknown>> } {
  const map = new Map<string, CachedAnswer<unknown>>();
  return {
    map,
    async get<T>(q: string, k: string) {
      return (map.get(`${q}|${k}`) as CachedAnswer<T> | undefined) ?? null;
    },
    async set<T>(q: string, k: string, a: CachedAnswer<T>) {
      map.set(`${q}|${k}`, a as CachedAnswer<unknown>);
    },
  };
}

export function memoryLedger(): BrokerLedger & { calls: import('./types.ts').CallRecord[] } {
  const calls: import('./types.ts').CallRecord[] = [];
  return {
    calls,
    async record(c) {
      calls.push(c);
    },
    async spentToday(provider, userId) {
      return calls.filter((c) => c.provider === provider && c.ok && (userId ? c.userId === userId : true)).reduce((s, c) => s + c.costPence, 0);
    },
  };
}
