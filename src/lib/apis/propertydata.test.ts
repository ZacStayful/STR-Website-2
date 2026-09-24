import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLongLetData, getLongLetOnce } from './propertydata.ts';
import { NATIONAL_MONTHLY_RENT } from '../market/rent-ladder.ts';

// These run with no PROPERTYDATA_API_KEY, which is the no-key path — no network.
// That path is exactly where the two functions must differ.

test('getLongLetData still falls back to the national median with no API key', async () => {
  assert.equal(process.env.PROPERTYDATA_API_KEY, undefined, 'this test asserts the no-key path');
  const data = await getLongLetData('NG1 5DT', 2);
  assert.equal(data.monthlyRent, NATIONAL_MONTHLY_RENT[2]);
  assert.equal(data.estimateHigh, Math.round(NATIONAL_MONTHLY_RENT[2] * 1.15));
  assert.equal(data.estimateLow, Math.round(NATIONAL_MONTHLY_RENT[2] * 0.85));
  assert.deepEqual(data.comparables, []);
});

test('getLongLetOnce returns null rather than laundering the national median', async () => {
  assert.equal(await getLongLetOnce('NG1 5DT', 2), null);
  assert.equal(await getLongLetOnce('NG1 5DT', 4), null);
});

test('the two disagree on purpose: a figure that always exists is not a confirmed one', async () => {
  const always = await getLongLetData('M1 1AE', 3);
  const honest = await getLongLetOnce('M1 1AE', 3);
  assert.ok(always.monthlyRent > 0, 'the analyser must always get something to render');
  assert.equal(honest, null, 'the screening path must be able to tell that nothing was confirmed');
});

test('the shared ladder is the one the fallback uses', () => {
  // Guards against the alias in propertydata.ts drifting from rent-ladder.ts.
  assert.equal(NATIONAL_MONTHLY_RENT[1], 1_100);
  assert.equal(NATIONAL_MONTHLY_RENT[5], 2_500);
});
