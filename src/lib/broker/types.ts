/**
 * The data broker answers typed "questions" by walking a ladder of sources,
 * cheapest first, and stopping at the first rung that answers well enough.
 * Nothing fans out to every provider; every paid call is recorded.
 */

export type ProviderName = 'internal' | 'airbtics' | 'pmi' | 'propertydata' | 'onthemarket' | 'google' | 'airroi';

/** Who is asking, which caps the most expensive rung that may be climbed. */
export type BrokerMode = 'quick' | 'full' | 'cron';

export interface BrokerContext {
  mode: BrokerMode;
  userId?: string | null;
  /** Force a refresh even if a fresh cached answer exists (admin spike only). */
  bypassCache?: boolean;
  /** Runs work after the response is sent (Next `after`). Optional. */
  background?: (fn: () => Promise<void>) => void;
}

export interface Rung<P, T> {
  provider: ProviderName;
  /** Cost of one call in pence (0 for our own data and free reads). */
  costPence: number;
  /** Rung level 1 (free, ours) … 4 (expensive). Mode caps compare against this. */
  level: 1 | 2 | 3 | 4;
  /** How long an answer from this rung stays fresh. */
  ttlMs: number;
  /** Returns null when this rung cannot answer; the ladder continues. */
  run: (params: P) => Promise<T | null>;
  /** Optional: reject a non-null answer as "not good enough" so the ladder continues. */
  sufficient?: (value: T) => boolean;
  /** Provider-specific enable check (missing key ⇒ rung removed). */
  enabled?: () => boolean;
}

export interface Question<P, T> {
  name: string;
  /** Stable cache key for these params. */
  key: (params: P) => string;
  rungs: Rung<P, T>[];
}

export interface ResolveResult<T> {
  value: T | null;
  provider: ProviderName | null;
  level: number | null;
  /** True when the answer came from the cache table rather than a live call. */
  cached: boolean;
  /** True when the cached answer is past its TTL but was returned anyway (budget or mode stopped a refresh). */
  stale: boolean;
  /** True when no rung could answer within budget/mode. */
  unavailable: boolean;
  updatedAt: string | null;
  costPence: number;
}

export interface CachedAnswer<T> {
  value: T;
  provider: ProviderName;
  level: number;
  fetchedAt: string;
  expiresAt: string;
}

export interface BrokerStore {
  get<T>(question: string, key: string): Promise<CachedAnswer<T> | null>;
  set<T>(question: string, key: string, answer: CachedAnswer<T>): Promise<void>;
}

export interface CallRecord {
  provider: ProviderName;
  question: string;
  key: string;
  costPence: number;
  cacheHit: boolean;
  userId: string | null;
  ok: boolean;
  ms: number;
}

export interface BrokerLedger {
  record(call: CallRecord): Promise<void>;
  /** Pence spent today (UTC) for a provider, globally or for one member. */
  spentToday(provider: ProviderName, userId?: string | null): Promise<number>;
}

export interface Budget {
  /** Daily global cap in pence for this provider. */
  globalPence: number;
  /** Daily cap per member in pence. */
  memberPence: number;
}
