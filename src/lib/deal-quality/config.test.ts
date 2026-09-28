import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEAL_CHECKS, DEFAULT_DEAL_COMPS, DEFAULT_DEAL_CONFIDENCE, parseDealChecks, parseDealComps, parseDealConfidence } from './config.ts';

test('no row at all: the decided defaults (20 checks, £1 a day, 6/8/6, 12 comps, 0.8–25 km, high ≤20%, medium ≤40%)', () => {
  assert.deepEqual(parseDealChecks(undefined), DEFAULT_DEAL_CHECKS);
  assert.deepEqual(parseDealComps(null), DEFAULT_DEAL_COMPS);
  assert.deepEqual(parseDealConfidence(undefined), DEFAULT_DEAL_CONFIDENCE);
  assert.equal(DEFAULT_DEAL_CHECKS.perDay, 20);
  assert.equal(DEFAULT_DEAL_CHECKS.dailyCapPence, 100);
  assert.deepEqual(DEFAULT_DEAL_CHECKS.split, { top60: 6, low_entry: 8, r2r: 6 });
  assert.equal(DEFAULT_DEAL_COMPS.targetCount, 12);
  assert.deepEqual(DEFAULT_DEAL_COMPS.radiiKm, [0.8, 2, 5, 12, 25]);
  assert.equal(DEFAULT_DEAL_CONFIDENCE.highPct, 20);
  assert.equal(DEFAULT_DEAL_CONFIDENCE.mediumPct, 40);
});

test('stored values are read, objects or JSON strings, field by field', () => {
  const c = parseDealChecks({ perDay: 10, dailyCapPence: '250', split: { top60: 4, low_entry: 10, r2r: 6 } });
  assert.equal(c.perDay, 10);
  assert.equal(c.dailyCapPence, 250);
  assert.deepEqual(c.split, { top60: 4, low_entry: 10, r2r: 6 });
  assert.equal(c.maxCallsPerCheck, DEFAULT_DEAL_CHECKS.maxCallsPerCheck);
  const s = parseDealComps(JSON.stringify({ targetCount: 10, radiiKm: [1, 3, 9], maxRadiusKm: 9 }));
  assert.equal(s.targetCount, 10);
  assert.deepEqual(s.radiiKm, [1, 3, 9]);
});

test('a bad field falls back to its default, never to something looser', () => {
  const c = parseDealChecks({ perDay: -1, dailyCapPence: 'lots', maxCallsPerCheck: 50, split: { top60: 2.5 } });
  assert.equal(c.perDay, DEFAULT_DEAL_CHECKS.perDay);
  assert.equal(c.dailyCapPence, DEFAULT_DEAL_CHECKS.dailyCapPence);
  assert.equal(c.maxCallsPerCheck, DEFAULT_DEAL_CHECKS.maxCallsPerCheck);
  assert.equal(c.split.top60, DEFAULT_DEAL_CHECKS.split.top60);
});

test('a £0 daily cap and zero checks are allowed (they stop the checks)', () => {
  assert.equal(parseDealChecks({ dailyCapPence: 0 }).dailyCapPence, 0);
  assert.equal(parseDealChecks({ perDay: 0 }).perDay, 0);
});

test('radii must rise; steps past the max radius are dropped', () => {
  assert.deepEqual(parseDealComps({ radiiKm: [5, 2, 12] }).radiiKm, DEFAULT_DEAL_COMPS.radiiKm);
  assert.deepEqual(parseDealComps({ radiiKm: [0.8, 'x'] }).radiiKm, DEFAULT_DEAL_COMPS.radiiKm);
  assert.deepEqual(parseDealComps({ maxRadiusKm: 12 }).radiiKm, [0.8, 2, 5, 12]);
});

test('the minimum comparables can never exceed the target', () => {
  assert.equal(parseDealComps({ targetCount: 6, minComps: 10 }).minComps, 6);
});

test('medium is never tighter than high', () => {
  assert.equal(parseDealConfidence({ highPct: 30, mediumPct: 25 }).mediumPct, 30);
});
