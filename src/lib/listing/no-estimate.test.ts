import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainNoEstimate, LADDER_MIN } from './no-estimate.ts';

const base = { postcode: 'NG7 1AB', outcode: 'NG7', bedrooms: 2, areaName: 'Nottingham', postcodeSamples: 0, sameSizeEarning: 2, nearbyTotal: 9, areaBedroomSamples: 0, areaSamples: 0, pmi: 'no-data' as const };

test('every rung says what it needed and what it found', () => {
  const e = explainNoEstimate(base);
  assert.equal(e.reasons.length, 5);
  assert.deepEqual(e.reasons.map((r) => r.source), ['postcode-reports', 'competitors', 'area-bedrooms', 'area', 'pmi-market']);
  assert.equal(e.reasons[0].needed, LADDER_MIN.postcode);
  assert.match(e.reasons[0].detail, /Need 1 Stayful report for NG7 1AB with 2 bedrooms in the last 90 days; found 0\./);
  assert.equal(e.reasons[1].found, 2);
  assert.match(e.reasons[1].detail, /found 2 of 9 tracked/);
  assert.match(e.reasons[2].detail, /2-bed in Nottingham; found 0/);
  assert.match(e.reasons[3].detail, /anywhere in Nottingham; found 0/);
  assert.match(e.reasons[4].detail, /no area snapshot for NG7/);
  assert.match(e.summary, /^Need 1 Stayful report/);
  assert.match(e.unlock, /Run the full report/);
  assert.match(e.unlock, /12 targeted/);
  assert.match(e.unlock, /Nottingham also improves/);
});

test('missing inputs read as unavailable or skipped rather than zero', () => {
  const e = explainNoEstimate({ ...base, postcode: null, sameSizeEarning: null, nearbyTotal: null, areaName: null, areaBedroomSamples: 0, areaSamples: 0, pmi: 'skipped' });
  assert.equal(e.reasons[0].status, 'unavailable');
  assert.match(e.reasons[0].detail, /no full postcode/);
  assert.equal(e.reasons[1].status, 'unavailable');
  assert.match(e.reasons[1].detail, /could not be placed on the map/);
  assert.equal(e.reasons[2].status, 'unavailable');
  assert.match(e.reasons[2].detail, /No area data/);
  assert.equal(e.reasons[4].status, 'skipped');
  assert.ok(!e.unlock.includes('also improves'));
  const skipped = explainNoEstimate({ ...base, postcodeSamples: null, nearbySkipped: true });
  assert.equal(skipped.reasons[0].status, 'skipped');
  assert.equal(skipped.reasons[1].status, 'skipped');
});

test('the summary leads with the rungs that fell short', () => {
  const e = explainNoEstimate({ ...base, postcode: null, sameSizeEarning: null, nearbyTotal: null });
  assert.match(e.summary, /^Need 1 report for a 2-bed in Nottingham/);
});
