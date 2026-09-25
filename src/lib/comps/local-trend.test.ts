import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTrend, readLocalTrend, trendDetail, trendSentence, trendShort } from './local-trend.ts';
import { monthIndex } from './months.ts';
import { makeComp, manchesterComps } from './__fixtures__/report-comps.ts';

const AUG = monthIndex('2026-08')!;

test('growing listings read as up, newcomers and part-history listings excluded', () => {
  const t = localTrend(manchesterComps(), AUG)!;
  assert.equal(t.direction, 'up');
  assert.ok(t.revenueChange > 0.07 && t.revenueChange < 0.14, String(t.revenueChange));
  // 16 established + the gapped comp (gaps are before the windows) + part-year; newcomers out.
  assert.equal(t.listings, 18);
  assert.equal(t.to, '2026-08');
  assert.ok(t.adrChange !== null && t.occupancyPointsChange !== null);
});

test('flat and down', () => {
  const flat = Array.from({ length: 8 }, (_, k) => makeComp(`f${k}`, { growth: 0.01 }));
  assert.equal(localTrend(flat, AUG)!.direction, 'flat');
  const down = Array.from({ length: 8 }, (_, k) => makeComp(`d${k}`, { growth: -0.1 }));
  const t = localTrend(down, AUG)!;
  assert.equal(t.direction, 'down');
  assert.match(trendSentence(t), /about \d+% less in the 12 months to Aug 2026/);
});

test('fewer than six matched listings is no trend', () => {
  assert.equal(localTrend(Array.from({ length: 5 }, (_, k) => makeComp(`x${k}`)), AUG), null);
  assert.equal(localTrend(manchesterComps(), null), null);
});

test('two missing pairs are tolerated, three drop the listing', () => {
  const base = Array.from({ length: 6 }, (_, k) => makeComp(`b${k}`));
  const two = makeComp('two', { nullKeys: ['2026-08', '2026-07'] });
  const three = makeComp('three', { nullKeys: ['2026-08', '2026-07', '2026-06'] });
  assert.equal(localTrend([...base, two], AUG)!.listings, 7);
  assert.equal(localTrend([...base, three], AUG)!.listings, 6);
});

test('a missing recent August does not skew the change', () => {
  const full = Array.from({ length: 8 }, (_, k) => makeComp(`g${k}`, { growth: 0.1 }));
  const gapped = full.map((c, k) => (k < 4 ? makeComp(`g${k}`, { growth: 0.1, nullKeys: ['2026-08'] }) : c));
  const a = localTrend(full, AUG)!.revenueChange;
  const b = localTrend(gapped, AUG)!.revenueChange;
  assert.ok(Math.abs(a - b) < 0.005, `${a} vs ${b}`);
});

test('labels and validator', () => {
  const t = localTrend(Array.from({ length: 8 }, (_, k) => makeComp(`j${k}`, { lastKey: '2026-01' })), monthIndex('2026-01')!)!;
  assert.match(trendSentence(t), /to Jan 2026/);
  assert.match(trendShort(t), /year to Jan 2026/);
  assert.ok(trendDetail(t));
  assert.deepEqual(readLocalTrend(JSON.parse(JSON.stringify(t))), t);
  assert.equal(readLocalTrend({ to: 'nope', listings: 3, revenueChange: 0.1, direction: 'up' }), null);
});
