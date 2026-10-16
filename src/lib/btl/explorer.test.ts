import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btlDistrictRows, sortBtlDistricts, typicalCashIn } from './explorer.ts';
import type { KeyStatsRow } from '../apis/propertydata-parse.ts';

const row = (outcode: string, o: Partial<KeyStatsRow> = {}): KeyStatsRow => ({ outcode, avgPrice: 160_000, avgPricePsf: null, avgRentWeekly: 300, avgYieldPct: 6.2, growth1y: 3.9, growth3y: null, growth5y: 28.9, growth7y: null, salesPerMonth: 20, turnoverPct: null, ...o });

test('a district’s buy-to-let figures: yield, growth, price and the typical cash in, from the key stats alone', () => {
  const [b44] = btlDistrictRows([row('B44')], 2_500);
  assert.deepEqual(b44, { outcode: 'B44', area: 'B', grossYieldPct: 6.2, growth5yPct: 28.9, growth1yPct: 3.9, avgPrice: 160_000, cashIn: 51_200, enough: true });
  assert.equal(typicalCashIn(160_000, 'B44', 2_500), 51_200, '£40,000 deposit, £8,700 tax on a second home, £2,500 buying costs');
  assert.equal(typicalCashIn(160_000, 'CF10', 2_500) !== 51_200, true, 'Wales: its own tax');
});

test('no yield: "Not enough data", last whatever the sort; duplicates once; cheapest first for price and cash', () => {
  const rows = btlDistrictRows([row('B44'), row('LS1', { avgYieldPct: null }), row('ST1', { avgYieldPct: 9, avgPrice: 90_000 }), row('B44')], 2_500);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.outcode === 'LS1')!.enough, false);
  assert.deepEqual(sortBtlDistricts(rows, 'yield').map((r) => r.outcode), ['ST1', 'B44', 'LS1']);
  assert.deepEqual(sortBtlDistricts(rows, 'cash').map((r) => r.outcode), ['ST1', 'B44', 'LS1']);
  assert.deepEqual(sortBtlDistricts(rows, 'growth5y').map((r) => r.outcode)[2], 'LS1');
});
