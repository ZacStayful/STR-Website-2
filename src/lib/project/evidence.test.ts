import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ceilingTypeFor, designationExclusion, pdSoldTypeFor, soldSalesFrom } from './evidence.ts';
import { ceilingFrom } from './value.ts';
import type { PdSoldSale } from '../apis/propertydata-parse.ts';

const NOW = new Date('2026-09-29T12:00:00Z');
const sale = (over: Partial<PdSoldSale> = {}): PdSoldSale => ({ price: 160_000, date: '2026-03-01', distanceMiles: 0.3, lat: null, lng: null, type: 'terraced_house', bedrooms: 3, ...over });

test('each home type asks for, and is compared on, its own sales; a bungalow on detached ones', () => {
  assert.equal(pdSoldTypeFor('terraced'), 'terraced_house');
  assert.equal(pdSoldTypeFor('semi'), 'semi-detached_house');
  assert.equal(pdSoldTypeFor('flat'), 'flat');
  assert.equal(pdSoldTypeFor('bungalow'), 'detached_house');
  assert.equal(ceilingTypeFor('bungalow'), 'detached');
  assert.equal(pdSoldTypeFor(null), null);
});

test('sales the ceiling can use: a known distance and a readable type, whatever spelling PropertyData uses', () => {
  const out = soldSalesFrom([sale(), sale({ type: 'T' }), sale({ type: 'semi-detached' }), sale({ distanceMiles: null }), sale({ type: 'O' })]);
  assert.deepEqual(out.map((s) => s.homeType), ['terraced', 'terraced', 'semi', null]);
  assert.equal(out.length, 4, 'no distance: dropped');
});

test('the Norton example: Mill Street terraced sales put the ceiling above the value from the works', () => {
  const pd = [155_000, 160_000, 165_000, 174_000, 158_000, 162_000].map((price, i) => sale({ price, distanceMiles: 0.2 + i * 0.1, bedrooms: null }));
  const ceiling = ceilingFrom(soldSalesFrom(pd), { homeType: 'terraced', bedrooms: 3 }, NOW);
  assert.ok(ceiling);
  assert.equal(ceiling!.basis, 'type', 'bedrooms unknown on the sales: the type fallback (Q7)');
  assert.ok(ceiling!.value > 127_800, 'the ceiling does not bind');
});

test('PropertyData’s listed-building and conservation checks rule a candidate out (Q9); a failed call never does', () => {
  assert.equal(designationExclusion([{ name: 'Church of St Peter', grade: 'II', distanceMiles: 0.01, url: null, listDate: null }], null), 'listed');
  assert.equal(designationExclusion([{ name: 'Mill', grade: 'II', distanceMiles: 0.4, url: null, listDate: null }], { inside: false, name: null }), null);
  assert.equal(designationExclusion([], { inside: true, name: 'Norton conservation area' }), 'conservation');
  assert.equal(designationExclusion(null, null), null);
});
