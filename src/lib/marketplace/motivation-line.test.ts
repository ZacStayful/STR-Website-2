import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedFor, motivationLine, recordedCuts } from './motivation-line.ts';
import { MOTIVATION_SIGNALS } from '../listing/motivation.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
const verdict = (...fired: string[]) => ({ score: 50, firmScore: 25, fired });
const cut = (at: string, from: number, to: number) => ({ at, amount: to, period: 'total', status: 'available', previousAmount: from, previousStatus: 'available', notified: false });

test('no data, junk data or only unknown keys means no line at all', () => {
  assert.deepEqual(motivationLine({ kind: 'sale' }, NOW), []);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: null, price_history: null, listed_date: null }, NOW), []);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: 'nonsense', price_history: 'nope' }, NOW), []);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('made_up', 'drop table') }, NOW), []);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: { fired: [] } }, NOW), []);
});

test('firm evidence comes first, and soft wording only appears when there is no firm evidence', () => {
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('chain_free', 'price_reduced', 'offers_invited') }, NOW), ['Price reduced']);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('chain_free', 'offers_invited', 'auction') }, NOW), ['Auction', 'Chain free']);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('repossessed', 'price_reduced', 'back_on_market') }, NOW), ['Repossession', 'Price reduced']);
});

test('never more than two items', () => {
  const line = motivationLine({ kind: 'sale', motivation: verdict('repossessed', 'needs_quick_sale', 'price_reduced', 'back_on_market', 'short_lease') }, NOW);
  assert.equal(line.length, 2);
});

test('price cuts are one item: counted from our history, and only cuts count', () => {
  const twice = [cut(daysAgo(40), 300_000, 285_000), cut(daysAgo(10), 285_000, 270_000)];
  assert.equal(recordedCuts(twice), 2);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('price_reduced', 'reduced_repeatedly'), price_history: twice }, NOW), ['Reduced twice']);
  const three = [...twice, cut(daysAgo(2), 270_000, 260_000)];
  assert.deepEqual(motivationLine({ kind: 'sale', price_history: three }, NOW), ['Reduced 3 times']);
  // A rise is a change, not a cut.
  const rise = [cut(daysAgo(20), 250_000, 260_000), cut(daysAgo(5), 260_000, 255_000)];
  assert.equal(recordedCuts(rise), 1);
  assert.deepEqual(motivationLine({ kind: 'sale', price_history: rise }, NOW), ['Price reduced']);
  // The verdict says more than once but we only saw it ourselves once: no number we cannot back.
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('reduced_repeatedly'), price_history: [cut(daysAgo(3), 200_000, 190_000)] }, NOW), ['Reduced more than once']);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('price_reduced') }, NOW), ['Price reduced']);
});

test('time on the market is only firm, and only numbered, with the portal listing date', () => {
  assert.deepEqual(motivationLine({ kind: 'rent', motivation: verdict('long_on_market'), listed_date: daysAgo(66) }, NOW), ['Listed 2 months']);
  assert.deepEqual(motivationLine({ kind: 'rent', motivation: verdict('long_on_market'), listed_date: daysAgo(50) }, NOW), ['Listed 7 weeks']);
  // Without a listing date the age may be our own sighting: soft, so a firm cut outranks it.
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('long_on_market', 'price_reduced') }, NOW), ['Price reduced']);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('long_on_market', 'chain_free') }, NOW), ['On the market a long time', 'Chain free']);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('slower_than_area') }, NOW), ['Slower to sell than the area']);
  assert.deepEqual(motivationLine({ kind: 'rent', motivation: verdict('slower_than_area') }, NOW), ['Slower to let than the area']);
});

test('listedFor ignores missing, unreadable, future and brand-new dates', () => {
  assert.equal(listedFor(null, NOW), null);
  assert.equal(listedFor('not a date', NOW), null);
  assert.equal(listedFor(daysAgo(-5), NOW), null);
  assert.equal(listedFor(daysAgo(3), NOW), null);
  assert.equal(listedFor(daysAgo(7), NOW), 'Listed 1 week');
  assert.equal(listedFor(daysAgo(31 * 7), NOW), 'Listed 7 months');
});

test('a signal for the other kind of deal is never claimed', () => {
  assert.deepEqual(motivationLine({ kind: 'rent', motivation: verdict('chain_free') }, NOW), []);
  assert.deepEqual(motivationLine({ kind: 'sale', motivation: verdict('void_now') }, NOW), []);
});

test('every signal has card wording and none of it is an internal key', () => {
  for (const key of Object.keys(MOTIVATION_SIGNALS)) {
    const spec = MOTIVATION_SIGNALS[key as keyof typeof MOTIVATION_SIGNALS];
    const kind = (spec.kinds as readonly string[]).includes('sale') ? 'sale' : 'rent';
    const line = motivationLine({ kind, motivation: verdict(key), listed_date: daysAgo(200) }, NOW);
    assert.equal(line.length, 1, `${key} produces one item`);
    assert.ok(!line[0].includes('_'), `${key} reads as English: ${line[0]}`);
  }
});
