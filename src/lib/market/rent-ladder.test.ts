import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NATIONAL_MONTHLY_RENT, nationalRentFor, rungFor, scaleRentToBedrooms, modalBedroomsOf } from './rent-ladder.ts';

test('the ladder rises with bedroom count', () => {
  const rungs = [0, 1, 2, 3, 4, 5].map((b) => NATIONAL_MONTHLY_RENT[b]);
  for (let i = 1; i < rungs.length; i += 1) assert.ok(rungs[i] > rungs[i - 1], `rung ${i} must exceed rung ${i - 1}`);
});

test('bedroom counts clamp onto the ladder', () => {
  assert.equal(rungFor(0), 0);
  assert.equal(rungFor(-2), 0);
  assert.equal(rungFor(5), 5);
  assert.equal(rungFor(9), 5);
  assert.equal(nationalRentFor(2), 1_400);
  assert.equal(nationalRentFor(11), 2_500);
});

test('scaling an exact match leaves the rent alone', () => {
  assert.equal(scaleRentToBedrooms(1_234, 3, 3), 1_234);
  // Anything above 5 shares the top rung, so no scaling happens between them.
  assert.equal(scaleRentToBedrooms(3_000, 6, 8), 3_000);
});

test('scaling moves a local rent by the ladder ratio, both ways', () => {
  // 2-bed → 4-bed is 2050/1400 = 1.464…
  assert.equal(scaleRentToBedrooms(1_000, 2, 4), 1_464);
  // and back again, symmetrically
  assert.equal(scaleRentToBedrooms(1_464, 4, 2), 1_000);
  assert.ok(scaleRentToBedrooms(1_000, 3, 1) < 1_000, 'stepping down must reduce the rent');
});

test('scaling refuses a rent it cannot use', () => {
  assert.equal(scaleRentToBedrooms(0, 2, 3), 0);
  assert.equal(scaleRentToBedrooms(-50, 2, 3), 0);
  assert.equal(scaleRentToBedrooms(Number.NaN, 2, 3), 0);
});

test('modal bedrooms is the best-sampled size, ties to the smaller', () => {
  assert.equal(modalBedroomsOf([{ bedrooms: 1, samples: 3 }, { bedrooms: 2, samples: 9 }, { bedrooms: 3, samples: 4 }]), 2);
  assert.equal(modalBedroomsOf([{ bedrooms: 3, samples: 5 }, { bedrooms: 1, samples: 5 }]), 1, 'a tie takes the smaller size');
  assert.equal(modalBedroomsOf([]), null);
});
