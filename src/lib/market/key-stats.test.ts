import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_FIXTURES } from '../apis/__fixtures__/propertydata.ts';
import { parseKeyStats, type KeyStatsRow } from '../apis/propertydata-parse.ts';
import { aggregateKeyStats, areaKeyStats, keyStatsForOutcode, outcodeGrowth, pdRegionForArea, pdRegionForOutcode, warmRegionKeyStats, PD_REGIONS, type KeyStatsRead, type PdRegion } from './key-stats.ts';

const rows = parseKeyStats(PD_FIXTURES.keyStats) as KeyStatsRow[];

test('every explorer region maps to one of PropertyData\'s eleven, or to nothing', () => {
  assert.equal(pdRegionForOutcode('BN1'), 'south_east');
  assert.equal(pdRegionForOutcode('NG7'), 'east_midlands');
  assert.equal(pdRegionForOutcode('EH1'), 'scotland');
  assert.equal(pdRegionForOutcode('CF10'), 'wales');
  assert.equal(pdRegionForOutcode('BT1'), 'northern_ireland');
  assert.equal(pdRegionForOutcode('E1'), 'greater_london');
  // Yorkshire is provisionally read from the north east until the preview settles it.
  assert.equal(pdRegionForOutcode('LS1'), 'north_east');
  assert.equal(pdRegionForArea('JE'), null);
  assert.equal(pdRegionForArea(''), null);
  assert.equal(PD_REGIONS.length, 11);
});

test('an outcode\'s own row, and the area aggregate weighted by sales', () => {
  assert.equal(keyStatsForOutcode(rows, 'bn11')?.growth1y, -0.6);
  assert.equal(keyStatsForOutcode(rows, 'BN99'), null);
  assert.equal(keyStatsForOutcode(null, 'BN1'), null);
  const bn = areaKeyStats(rows, 'BN');
  assert.ok(bn);
  assert.equal(bn.outcodes, 3);
  // Rent: BN1 (315.1/wk, 24 sales) and BN11 (187.2/wk, 17 sales); BN10 has none.
  const weeklyRent = (315.1 * 24 + 187.2 * 17) / 41;
  assert.equal(bn.avgRentPcm, Math.round((Math.round(weeklyRent * 10) / 10) * 52 / 12));
  // Growth over five years across all three, weighted 24 / 8 / 17.
  assert.equal(bn.growth5y, Math.round(((17.8 * 24 + 15.4 * 8 + 14.4 * 17) / 49) * 10) / 10);
  assert.equal(bn.salesPerMonth, 49);
  assert.equal(areaKeyStats(rows, 'XX'), null);
  // A lone outcode aggregates to itself.
  const one = aggregateKeyStats([rows[0]]);
  assert.equal(one?.avgRentPcm, Math.round((315.1 * 52) / 12));
  assert.equal(one?.growth5y, 17.8);
  // Without sales weights the mean is plain.
  const plain = aggregateKeyStats(rows.map((r) => ({ ...r, salesPerMonth: null })));
  assert.equal(plain?.growth1y, Math.round(((3.6 + 1.1 - 0.6) / 3) * 10) / 10);
  assert.equal(plain?.salesPerMonth, null);
});

test('the report stores one outcode\'s growth with its provenance', () => {
  const g = outcodeGrowth(rows[0], 'south_east', '2026-09-01T06:45:00.000Z');
  assert.equal(g.outcode, 'BN1');
  assert.equal(g.region, 'south_east');
  assert.equal(g.growth5y, 17.8);
  assert.equal(g.growth7y, 18.5);
  assert.equal(g.turnoverPct, 1);
  assert.equal(g.asOf, '2026-09-01T06:45:00.000Z');
});

test('the warm-up buys only what is missing or stale, a few regions a run, in a fixed order', async () => {
  const state = new Map<PdRegion, 'fresh' | 'stale' | 'missing'>([
    ['north_east', 'fresh'],
    ['north_west', 'stale'],
    ['east_midlands', 'missing'],
    ['west_midlands', 'fresh'],
    ['east_of_england', 'missing'],
    ['greater_london', 'missing'],
    ['south_east', 'fresh'],
    ['south_west', 'fresh'],
    ['wales', 'fresh'],
    ['scotland', 'missing'],
    ['northern_ireland', 'fresh'],
  ]);
  const bought: PdRegion[] = [];
  const read = async (region: PdRegion, mode: 'cache' | 'buy'): Promise<KeyStatsRead> => {
    const s = state.get(region);
    if (mode === 'cache') {
      if (s === 'fresh') return { value: rows, cached: true, stale: false, unavailable: false, updatedAt: null };
      if (s === 'stale') return { value: rows, cached: true, stale: true, unavailable: false, updatedAt: null };
      return { value: null, cached: false, stale: false, unavailable: true, updatedAt: null };
    }
    bought.push(region);
    if (region === 'scotland') return { value: null, cached: false, stale: false, unavailable: true, updatedAt: null };
    // The broker could not buy the north west and returned its stale rows instead.
    if (region === 'north_west' && s === 'stale') return { value: rows, cached: true, stale: true, unavailable: false, updatedAt: null };
    return { value: rows, cached: false, stale: false, unavailable: false, updatedAt: null };
  };
  const r = await warmRegionKeyStats(read, 3);
  // A stale region the broker would not refresh counts as failed, not fresh, and does not use up the allowance.
  assert.deepEqual(r.warmed, ['east_midlands', 'east_of_england', 'greater_london']);
  assert.deepEqual(r.failed, ['north_west']);
  assert.deepEqual(r.deferred, ['scotland']);
  assert.deepEqual(r.fresh, ['north_east', 'west_midlands', 'south_east', 'south_west', 'wales', 'northern_ireland']);
  assert.deepEqual(bought, ['north_west', 'east_midlands', 'east_of_england', 'greater_london']);

  // Next run: the north west refreshes, Scotland fails outright.
  for (const w of r.warmed) state.set(w, 'fresh');
  state.set('north_west', 'missing');
  bought.length = 0;
  const r2 = await warmRegionKeyStats(read, 3);
  assert.deepEqual(r2.warmed, ['north_west']);
  assert.deepEqual(r2.failed, ['scotland']);
  assert.deepEqual(r2.deferred, []);
});
