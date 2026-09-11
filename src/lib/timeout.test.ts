import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from './timeout.ts';

const sleep = (ms: number, v = 'slow') => new Promise<string>((r) => setTimeout(() => r(v), ms));

test('returns the value when it arrives in time', async () => {
  assert.equal(await withTimeout(sleep(5, 'fast'), 200, 'fallback'), 'fast');
});

test('returns the fallback when the promise is slow', async () => {
  let called = 0;
  const v = await withTimeout(sleep(200), 10, () => {
    called += 1;
    return 'fallback';
  });
  assert.equal(v, 'fallback');
  assert.equal(called, 1);
});

test('returns the fallback when the promise rejects', async () => {
  assert.equal(await withTimeout(Promise.reject(new Error('boom')), 200, 'fallback'), 'fallback');
});

test('a late value never overrides the fallback', async () => {
  const p = sleep(30, 'late');
  const v = await withTimeout(p, 5, 'fallback');
  assert.equal(v, 'fallback');
  assert.equal(await p, 'late');
});
