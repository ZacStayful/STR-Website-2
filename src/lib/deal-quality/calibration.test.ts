import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATION_MAX_CALLS, chooseCases, gapPct, latestResults, median, optionsFromMultipliers, splitAtReset, summariseCalibration, type CaseResult } from './calibration.ts';

function row(id: string, cls: string, area: string, beds: number, day: number) {
  return { id, created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`, postcode_area: area, bedrooms: beds, location_class: cls };
}

test('the comparison can never make more than 72 calls (£3.60 at 5p)', () => {
  assert.equal(CALIBRATION_MAX_CALLS, 72);
});

test('cases: eight a class, newest first, a spread of sizes, one per postcode area', () => {
  const rows = [];
  let n = 0;
  for (const cls of ['urban', 'rural_village', 'coastal']) {
    for (let a = 0; a < 12; a++) for (let beds = 1; beds <= 5; beds++) rows.push(row(`${cls}-${a}-${beds}`, cls, `${cls[0].toUpperCase()}${a}`, beds, 1 + (n++ % 27)));
  }
  rows.push(row('suburban-1', 'suburban', 'ZZ', 2, 27));
  const chosen = chooseCases(rows);
  assert.equal(chosen.length, 24);
  for (const cls of ['urban', 'rural_village', 'coastal']) {
    const mine = chosen.filter((r) => r.location_class === cls);
    assert.equal(mine.length, 8);
    assert.equal(new Set(mine.map((r) => r.postcode_area)).size, 8);
    assert.deepEqual([...new Set(mine.map((r) => r.bedrooms))].sort(), [1, 2, 3, 4, 5]);
  }
  assert.ok(!chosen.some((r) => r.location_class === 'suburban'));
});

test('cases: a class with few reports gives what it has, sizes filled in order', () => {
  // 1-bed first (c, PL), then the only 2-bed (a, TR); the 3-bed shares TR, so it is left out.
  const chosen = chooseCases([row('a', 'coastal', 'TR', 2, 1), row('b', 'coastal', 'TR', 3, 2), row('c', 'coastal', 'PL', 1, 3)]);
  assert.deepEqual(chosen.map((r) => r.id), ['c', 'a']);
});

test('gap and median', () => {
  assert.equal(gapPct(110, 100), 10);
  assert.equal(gapPct(92_500, 100_000), -7.5);
  assert.equal(gapPct(null, 100), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

function result(id: string, cls: string, gaps: Partial<Record<'planned' | 'withDates' | 'bothCurves' | 'setting', number | null>>, over: Partial<CaseResult> = {}): CaseResult {
  const variant = (g: number | null | undefined) => (g === undefined ? undefined : { gross: g === null ? null : 100 + g, compCount: 12, spreadPct: 30, confidence: g === null ? 'insufficient' : 'medium', gapPct: g });
  return {
    id, area: 'XX', locationClass: cls, bedrooms: 2, guests: 6, storedGross: 100, storedCompCount: 12, storedRadiusKm: 1, storedSpreadPct: 30,
    found: 20, radiusKm: 2, calls: 1, pence: 5, filtered: true, filterMatch: 1, kindRelaxed: false, settingDropped: 0,
    variants: { planned: variant(gaps.planned), withDates: variant(gaps.withDates), bothCurves: variant(gaps.bothCurves), setting: variant(gaps.setting) },
    ...over,
  };
}

test('the gate waits for 20 cases, passes at a typical gap of 10% or less, stops above it', () => {
  const few = Array.from({ length: 10 }, (_, i) => result(`a${i}`, 'urban', { planned: 5 }));
  assert.equal(summariseCalibration(few, 24, 10, 50).gate, 'pending');
  const close = Array.from({ length: 22 }, (_, i) => result(`b${i}`, i % 2 ? 'urban' : 'coastal', { planned: i % 2 ? -9 : 8, withDates: 12, bothCurves: 14, setting: 9 }));
  const s = summariseCalibration(close, 24, 30, 150);
  assert.equal(s.gate, 'pass');
  assert.equal(s.medianAbsGap.planned, 8.5);
  assert.equal(s.best, 'planned');
  const far = Array.from({ length: 22 }, (_, i) => result(`c${i}`, 'rural_village', { planned: 18, withDates: 16, bothCurves: 22, setting: 15 }));
  const f = summariseCalibration(far, 24, 30, 150);
  assert.equal(f.gate, 'fail');
  assert.equal(f.best, 'setting');
});

test('failed cases are left out of the figures and counted to retry', () => {
  const rs = [result('x', 'urban', { planned: 4 }), result('y', 'urban', { planned: 50 }, { error: 'search failed' })];
  const s = summariseCalibration(rs, 2, 2, 10);
  assert.equal(s.done, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.medianAbsGap.planned, 4);
});

test('cases under the minimum comparables count as not shown', () => {
  const s = summariseCalibration([result('x', 'coastal', { planned: null })], 1, 1, 5);
  assert.equal(s.insufficient, 1);
  assert.equal(s.confidence.insufficient, 1);
});

test('a later run’s result for a case replaces the earlier one', () => {
  const m = latestResults([{ results: [result('x', 'urban', { planned: 40 }, { error: 'search failed' })] }, { results: [result('x', 'urban', { planned: 4 })] }]);
  assert.equal(m.get('x')?.error, undefined);
  assert.equal(m.get('x')?.variants.planned?.gapPct, 4);
});

test('the stored headline multiplier gives the extras back', () => {
  assert.deepEqual(optionsFromMultipliers({ outdoorSpace: 1.03, parking: 1.05 }), { outdoorSpace: 'garden', parkingSpaces: 2 });
  assert.deepEqual(optionsFromMultipliers({ outdoorSpace: 1.12, parking: 1.03 }), { outdoorSpace: 'hot_tub', parkingSpaces: 1 });
  assert.deepEqual(optionsFromMultipliers({ outdoorSpace: 1, parking: 1 }), {});
  assert.deepEqual(optionsFromMultipliers(null), {});
});

test('"start again": the comparison after the last marker, on the marker’s cases; the one before it is kept apart', () => {
  const run = (summary: Record<string, unknown>) => ({ summary });
  const first = [run({ caseIds: ['a', 'b'], results: [result('a', 'urban', { planned: 30 })], calls: 2, pence: 10 }), run({ results: [result('b', 'urban', { planned: 20 })], calls: 1, pence: 5 })];
  const none = splitAtReset(first);
  assert.equal(none.current.length, 2);
  assert.equal(none.previous.length, 0);
  assert.deepEqual(none.caseIds, ['a', 'b']);
  const marker = run({ reset: true, caseIds: ['a', 'b'], calls: 0, pence: 0 });
  const second = run({ results: [result('a', 'urban', { planned: 4 })], calls: 1, pence: 5 });
  const split = splitAtReset([...first, marker, second]);
  assert.deepEqual(split.current, [second], 'only the runs after the marker');
  assert.deepEqual(split.previous, first, 'the comparison before it, whole');
  assert.deepEqual(split.caseIds, ['a', 'b'], 'the same cases again');
  const twice = splitAtReset([...first, marker, second, run({ reset: true, caseIds: ['a'] })]);
  assert.deepEqual(twice.current, []);
  assert.deepEqual(twice.previous, [second], 'the previous comparison is the one between the two markers');
  assert.deepEqual(twice.caseIds, ['a']);
  assert.deepEqual(splitAtReset([run({ reset: true }), second]).caseIds, [], 'a marker without cases: the next run that names them');
});

test('the nearest-only variants compete for "closest" alongside the planned one', () => {
  const rs = Array.from({ length: 22 }, (_, i) => ({ ...result(`n${i}`, 'coastal', { planned: 14, withDates: 14, bothCurves: 16, setting: 14 }), variants: { ...result(`n${i}`, 'coastal', { planned: 14, withDates: 14, bothCurves: 16, setting: 14 }).variants, nearest12: { gross: 106, compCount: 12, spreadPct: 20, confidence: 'high', gapPct: 6 }, nearest20: { gross: 109, compCount: 12, spreadPct: 25, confidence: 'medium', gapPct: 9 } } }));
  const s = summariseCalibration(rs, 24, 30, 150);
  assert.equal(s.medianAbsGap.nearest12, 6);
  assert.equal(s.medianAbsGap.nearest20, 9);
  assert.equal(s.best, 'nearest12');
  assert.equal(s.gate, 'pass', 'the gate reads the closest variant');
});
