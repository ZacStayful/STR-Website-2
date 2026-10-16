import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TypedDeal } from '../profile/deal-types.ts';
import type { DealType } from '../market/goals.ts';
import { emptyFunnel, keepRate, othersThan, sharePct, shownAs, tallyLists } from './admin.ts';

const deals = new Map<string, TypedDeal>([
  ['str', { kind: 'sale', band: 'qualified', btl_pass: false, project: null }],
  ['both', { kind: 'sale', band: 'qualified', btl_pass: true, project: null }],
  ['btl', { kind: 'sale', band: 'unqualified', btl_pass: true, project: null }],
  ['r2r', { kind: 'rent', band: 'qualified', btl_pass: false, project: null }],
]);

const TYPES: Record<string, DealType[]> = { btlOnly: ['btl'], all4: ['buy_str', 'brrr', 'r2r', 'btl'], legacy: ['buy_str', 'brrr', 'r2r'] };

test('a deal counts as the type its profile is shown it as', () => {
  assert.equal(shownAs(deals.get('both'), TYPES.btlOnly), 'btl');
  assert.equal(shownAs(deals.get('both'), TYPES.legacy), 'buy_str');
  assert.equal(shownAs(deals.get('btl'), TYPES.btlOnly), 'btl');
  assert.equal(shownAs(undefined, TYPES.all4), null, 'a deal gone from the pool is not typed');
});

test('Today lists: shown per type, and the widened rate over lists with buy-to-let deals', () => {
  const { funnel, widen } = tallyLists(
    [
      { profileId: 'btlOnly', dealIds: ['both', 'btl'], shownIds: ['btl'], choice: { btlWiden: { from: 'Leeds', found: { scope: 'miles', miles: 25 } } } },
      { profileId: 'legacy', dealIds: ['str', 'both', 'r2r'], choice: null },
      { profileId: 'all4', dealIds: ['btl', 'gone'], choice: { btlWiden: null } },
    ],
    deals,
    (pid) => TYPES[pid],
  );
  assert.equal(funnel.btl.shown, 3, 'both + btl (once, though also replaced) + btl');
  assert.equal(funnel.buy_str.shown, 2);
  assert.equal(funnel.r2r.shown, 1);
  assert.deepEqual(widen, { lists: 2, widened: 1, byScope: { miles: 1, region: 0, national: 0 } });
});

test('keep rate and the other types', () => {
  const f = emptyFunnel();
  f.btl = { shown: 10, opened: 4, keeps: 3, passes: 1 };
  f.buy_str = { shown: 20, opened: 5, keeps: 1, passes: 3 };
  f.r2r = { shown: 5, opened: 1, keeps: 1, passes: 0 };
  assert.equal(keepRate(f.btl), 75);
  assert.equal(keepRate(f.brrr), null);
  assert.deepEqual(othersThan(f, 'btl'), { shown: 25, opened: 6, keeps: 2, passes: 3 });
  assert.equal(sharePct(1, 3), 33);
  assert.equal(sharePct(1, 0), null);
});
