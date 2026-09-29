import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ceilingFrom, homeTypeOf, valueAfterWorks, valueTest, weightedQuantile, type SoldSale } from './value.ts';

const NOW = new Date('2026-09-29T12:00:00Z');
const sale = (price: number, distanceMiles: number, bedrooms: number | null = 3, soldOn = '2026-03-01', homeType: SoldSale['homeType'] = 'terraced'): SoldSale => ({ price, soldOn, distanceMiles, homeType, bedrooms });

test('weighted quantile: the first price where the running weight reaches the share', () => {
  assert.equal(weightedQuantile([{ price: 155, weight: 1 }, { price: 160, weight: 1 }, { price: 165, weight: 1 }, { price: 174, weight: 1 }], 0.75), 165);
  // A far sale at the top counts for less, so the quartile sits lower.
  assert.equal(weightedQuantile([{ price: 100, weight: 1 }, { price: 110, weight: 1 }, { price: 120, weight: 1 }, { price: 300, weight: 0.25 }], 0.75), 120);
  assert.equal(weightedQuantile([], 0.75), null);
});

test('the ceiling widens from 0.5 miles until it holds about 10 sales', () => {
  const near = Array.from({ length: 6 }, (_, i) => sale(150_000 + i * 1_000, 0.3));
  const mid = Array.from({ length: 6 }, (_, i) => sale(170_000 + i * 1_000, 0.9));
  const c = ceilingFrom([...near, ...mid, sale(400_000, 2.5)], { homeType: 'terraced', bedrooms: 3 }, NOW);
  assert.ok(c);
  assert.equal(c!.radiusMiles, 1, '6 within half a mile is short of 10; 12 within a mile is enough');
  assert.equal(c!.sales, 12);
  assert.equal(c!.basis, 'bedrooms');
});

test('fewer than 5 of the same bedrooms: the same type at any size (Q7); fewer than 5 of those: no ceiling', () => {
  const sales = [sale(150_000, 0.4, 3), sale(152_000, 0.4, 3), sale(140_000, 0.6, null), sale(145_000, 0.7, 2), sale(160_000, 1.5, 4), sale(158_000, 2.2, null)];
  const c = ceilingFrom(sales, { homeType: 'terraced', bedrooms: 3 }, NOW);
  assert.equal(c?.basis, 'type');
  assert.equal(c?.sales, 6);
  assert.equal(ceilingFrom(sales.slice(0, 4), { homeType: 'terraced', bedrooms: 3 }, NOW), null);
});

test('only the same type, within 3 miles and the last 24 months', () => {
  const sales = [
    ...Array.from({ length: 5 }, () => sale(150_000, 0.4)),
    sale(900_000, 0.2, 3, '2026-03-01', 'detached'),
    sale(900_000, 3.4),
    sale(900_000, 0.2, 3, '2024-08-01'),
  ];
  const c = ceilingFrom(sales, { homeType: 'terraced', bedrooms: 3 }, NOW);
  assert.equal(c?.value, 150_000);
  assert.equal(c?.sales, 5);
  assert.equal(ceilingFrom(sales, { homeType: null, bedrooms: 3 }, NOW), null, 'an unknown type has nothing to compare with');
});

test('home types from portal and PropertyData wording', () => {
  assert.equal(homeTypeOf('End of Terrace'), 'terraced');
  assert.equal(homeTypeOf('semi-detached_house'), 'semi');
  assert.equal(homeTypeOf('Detached'), 'detached');
  assert.equal(homeTypeOf('Maisonette'), 'flat');
  assert.equal(homeTypeOf('Detached Bungalow'), 'bungalow');
  assert.equal(homeTypeOf('Land'), null);
  assert.equal(homeTypeOf(null), null);
});

test('value after works is the lower of the works rule and the ceiling', () => {
  const works = { visibleNeeded: 21_700, atCostHigh: 14_400 };
  assert.deepEqual(valueAfterWorks(70_000, works, null), { fromWorks: 127_800, ceiling: null, value: 127_800, ceilingApplied: false });
  const capped = valueAfterWorks(70_000, works, { value: 120_000, sales: 9, radiusMiles: 2, basis: 'bedrooms' });
  assert.equal(capped.value, 120_000);
  assert.equal(capped.ceilingApplied, true);
});

test('the test needs both bars: £15,000 and 10% of the value', () => {
  assert.deepEqual(valueTest(70_000, 39_710, 127_800), { value: 127_800, valueAdded: 18_090, valueAddedPct: 14.2, passes: true, missed: null });
  assert.equal(valueTest(70_000, 30_000, 114_000).missed, 'amount', '£14,000 added');
  assert.equal(valueTest(300_000, 20_000, 340_000).missed, 'share', '£20,000 is under 10% of £340,000');
});
