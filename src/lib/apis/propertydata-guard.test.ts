import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_RENT_HIT_TTL_MS, AREA_RENT_MISS_TTL_MS, areaRentCacheKey, cachedAreaRent, isPlanLimitError, nextUtcDay, type CachedRent } from './propertydata-guard.ts';

test('recognises the plan-limit reply, and nothing else', () => {
  const body = '{"status":"error","code":"X04","message":"Monthly plan limit exceeded: 5000 API credits"}';
  assert.equal(isPlanLimitError(403, body), true);
  assert.equal(isPlanLimitError(403, JSON.parse(body)), true);
  assert.equal(isPlanLimitError(403, 'Monthly plan limit exceeded'), true);
  assert.equal(isPlanLimitError(403, '{"status":"error","code":"X01","message":"Invalid postcode"}'), false);
  assert.equal(isPlanLimitError(500, body), false);
  assert.equal(isPlanLimitError(403, null), false);
});

test('pauses until the next UTC midnight', () => {
  assert.equal(nextUtcDay(new Date('2026-09-25T23:59:00Z')).toISOString(), '2026-09-26T00:00:00.000Z');
  assert.equal(nextUtcDay(new Date('2026-12-31T08:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});

test('cache key ignores spacing and case', () => {
  assert.equal(areaRentCacheKey('m4 1pp', 2), areaRentCacheKey('M41PP', 2));
});

function memory() {
  const rows = new Map<string, CachedRent>();
  return {
    rows,
    get: async (k: string) => rows.get(k) ?? null,
    set: async (k: string, v: CachedRent) => void rows.set(k, v),
  };
}

test('a cached rent is reused for a month without calling PropertyData', async () => {
  const store = memory();
  let calls = 0;
  const now = new Date('2026-09-25T10:00:00Z');
  const deps = { ...store, fetchRent: async () => (calls++, 1150), now: () => now };
  assert.equal(await cachedAreaRent('LE1|2', deps), 1150);
  assert.equal(await cachedAreaRent('LE1|2', deps), 1150);
  assert.equal(calls, 1);
  const later = { ...deps, now: () => new Date(now.getTime() + AREA_RENT_HIT_TTL_MS + 1) };
  await cachedAreaRent('LE1|2', later);
  assert.equal(calls, 2);
});

test('no answer is remembered for a day, then retried', async () => {
  const store = memory();
  let calls = 0;
  const now = new Date('2026-09-25T10:00:00Z');
  const deps = { ...store, fetchRent: async () => (calls++, null), now: () => now };
  assert.equal(await cachedAreaRent('LE1|2', deps), null);
  assert.equal(await cachedAreaRent('LE1|2', deps), null);
  assert.equal(calls, 1);
  await cachedAreaRent('LE1|2', { ...deps, now: () => new Date(now.getTime() + AREA_RENT_MISS_TTL_MS + 1) });
  assert.equal(calls, 2);
});

test('a throwing fetch or a broken store never throws', async () => {
  const deps = {
    get: async () => { throw new Error('db down'); },
    set: async () => { throw new Error('db down'); },
    fetchRent: async () => { throw new Error('network'); },
  };
  assert.equal(await cachedAreaRent('X|1', deps), null);
});
