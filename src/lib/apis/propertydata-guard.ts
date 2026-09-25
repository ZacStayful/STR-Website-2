/**
 * Guards around PropertyData spend. Pure (no server-only imports, storage
 * injected), so `node --test` can load it.
 *
 * Two things went wrong together in Sep 2026: the Market Explorer asked
 * PropertyData for every area's long-let rent on every hourly snapshot build
 * (up to six attempts each, no cache — 19k calls in a week for 29 areas), and
 * once that used up the monthly plan every call kept failing and retrying.
 * The area-rent cache below makes the lookup once per area per month; the
 * plan-limit breaker stops all PropertyData calls until the next UTC day
 * once the plan is spent.
 */

/** A successful area rent is good for a month; rents move slowly. */
export const AREA_RENT_HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** An area with no answer is retried once a day, not on every build. */
export const AREA_RENT_MISS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * PropertyData's "plan used up" reply: HTTP 403 with
 * `{"status":"error","code":"X04","message":"Monthly plan limit exceeded: …"}`.
 * Accepts the raw body text or a parsed object.
 */
export function isPlanLimitError(status: number, body: unknown): boolean {
  if (status !== 403 && status !== 429) return false;
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return /plan limit|X04/i.test(body);
    }
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const r = parsed as Record<string, unknown>;
  return r.code === 'X04' || (typeof r.message === 'string' && /plan limit/i.test(r.message));
}

/** Midnight UTC after `now`: when a spent plan is next worth trying. */
export function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function areaRentCacheKey(postcode: string, bedrooms: number): string {
  return `${postcode.replace(/\s+/g, '').toUpperCase()}|${bedrooms}`;
}

export interface CachedRent {
  /** Null records "asked, no answer" so a failing area is not re-asked for a day. */
  monthlyRent: number | null;
  expiresAt: string;
}

export interface AreaRentDeps {
  get: (key: string) => Promise<CachedRent | null>;
  set: (key: string, value: CachedRent) => Promise<void>;
  fetchRent: () => Promise<number | null>;
  now?: () => Date;
}

/**
 * Cache-through lookup: a fresh cached answer (hit or recorded miss) is
 * returned without a call; otherwise one fetch, and its answer is stored.
 * Storage failures never block the lookup.
 */
export async function cachedAreaRent(key: string, deps: AreaRentDeps): Promise<number | null> {
  const now = (deps.now ?? (() => new Date()))();
  const hit = await deps.get(key).catch(() => null);
  if (hit && new Date(hit.expiresAt).getTime() > now.getTime()) return hit.monthlyRent;

  let rent: number | null = null;
  try {
    const r = await deps.fetchRent();
    rent = typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null;
  } catch {
    rent = null;
  }
  const ttl = rent === null ? AREA_RENT_MISS_TTL_MS : AREA_RENT_HIT_TTL_MS;
  await deps.set(key, { monthlyRent: rent, expiresAt: new Date(now.getTime() + ttl).toISOString() }).catch(() => {});
  return rent;
}
