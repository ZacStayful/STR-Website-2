import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparablesFor, narrowWithValuation, percentile, rentRangeFor, type RentComp, type RentSubject } from './rent.ts';

const HERE = { lat: 52.54, lng: -1.86 };

function comp(pcm: number, over: Partial<RentComp> = {}): RentComp {
  return { pcm, bedrooms: 3, kind: 'house', postcodeArea: 'B', lat: HERE.lat + 0.005, lng: HERE.lng + 0.005, ...over };
}

// B44-like: the district's 2-bed-equivalent rent scales to £1,362 for 3 beds.
const B44: RentSubject = { bedrooms: 3, kind: 'house', postcodeArea: 'B', ...HERE, districtRentPcm: 1_155.64, districtYieldPct: 6.2 };
const B44_COMPS = [1_100, 1_150, 1_200, 1_200, 1_250, 1_275, 1_300, 1_300, 1_350, 1_450, 1_475, 1_500, 1_550, 1_600].map((r) => comp(r));

test('percentile interpolates like Postgres percentile_cont', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10], 0.25), 10);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.25), 2);
});

test('district and 14 agreeing comparables: high confidence, the middle halfway, ±10% (B44)', () => {
  const r = rentRangeFor(B44, B44_COMPS);
  assert.ok(r);
  assert.equal(r.base, 1_362);
  assert.equal(r.compsMedian, 1_300);
  assert.equal(r.mid, 1_331);
  assert.equal(r.low, 1_198);
  assert.equal(r.high, 1_464);
  assert.equal(r.confidence, 'high');
  assert.equal(r.compCount, 14);
  assert.deepEqual(r.sources, ['district', 'comparables']);
});

test('comparables come from the same postcode area, size and type, within 5 km', () => {
  const others = [
    comp(1_475, { postcodeArea: 'L' }), // across the river
    comp(900, { bedrooms: 2 }),
    comp(1_100, { kind: 'flat' }),
    comp(1_200, { lat: HERE.lat + 0.2 }), // about 22 km away
    comp(1_250, { lat: null }),
  ];
  assert.equal(comparablesFor(B44, others).length, 0);
  assert.equal(comparablesFor({ ...B44, kind: 'unknown' }, [comp(1_100, { kind: 'flat' })]).length, 1, 'an unknown type takes either');
});

test('too few comparables: the district alone, low confidence, ±20% (CH41)', () => {
  const ch41: RentSubject = { bedrooms: 2, kind: 'house', postcodeArea: 'CH', lat: 53.39, lng: -3.02, districtRentPcm: 814, districtYieldPct: 7.6 };
  const r = rentRangeFor(ch41, [comp(675, { bedrooms: 2, postcodeArea: 'CH', lat: 53.39, lng: -3.02 })]);
  assert.ok(r);
  assert.deepEqual([r.low, r.mid, r.high], [651, 814, 977]);
  assert.equal(r.confidence, 'low');
  assert.equal(r.compCount, 1);
});

test('the district and the comparables disagree: low confidence, the range covers both', () => {
  const comps = [1_400, 1_450, 1_475, 1_500, 1_600].map((r) => comp(r, { bedrooms: 2 }));
  const r = rentRangeFor({ ...B44, bedrooms: 2, districtRentPcm: 814 }, comps);
  assert.ok(r);
  assert.equal(r.disagree, true);
  assert.equal(r.confidence, 'low');
  assert.ok(r.low <= 814 && r.high >= 1_500);
});

test('no district yield is low confidence, with the wider range', () => {
  const r = rentRangeFor({ ...B44, districtYieldPct: null }, B44_COMPS)!;
  assert.equal(r.confidence, 'low');
  assert.equal(r.low, Math.round(1_331 * 0.8));
});

test('comparables alone when the district has no rent; nothing when neither speaks', () => {
  const r = rentRangeFor({ ...B44, districtRentPcm: null }, B44_COMPS)!;
  assert.equal(r.mid, 1_300);
  assert.equal(r.confidence, 'low');
  assert.equal(rentRangeFor({ ...B44, districtRentPcm: null }, []), null, 'never the national ladder');
});

test('a rent valuation narrows the range and lifts confidence; it never replaces the comparables', () => {
  const base = rentRangeFor({ ...B44, districtYieldPct: null }, B44_COMPS)!; // low: 1,065–1,597
  const inside = narrowWithValuation(base, { monthly: 1_300, low: 1_200, high: 1_400 });
  assert.equal(inside.mid, 1_316);
  assert.equal(inside.low, 1_184, 'never narrower than ±10% of the new middle');
  assert.equal(inside.high, 1_447);
  assert.equal(inside.confidence, 'medium');
  assert.equal(inside.valuation, 1_300);
  assert.ok(inside.sources.includes('comparables') && inside.sources.includes('valuation'));
  const outside = narrowWithValuation(base, { monthly: 2_000 });
  assert.equal(outside.high, 2_000);
  assert.equal(outside.confidence, 'low');
  assert.equal(narrowWithValuation(base, { monthly: Number.NaN }), base);
});
