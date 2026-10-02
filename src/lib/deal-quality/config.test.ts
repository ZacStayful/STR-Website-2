import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEAL_CHECKS, DEFAULT_DEAL_COMPS, DEFAULT_DEAL_CONFIDENCE, DEFAULT_LOW_ENTRY, parseDealChecks, parseDealComps, parseDealConfidence, parseLowEntry } from './config.ts';

test('no row at all: the decided defaults (20 checks, £1 a day, 3/12/5 since Batch 22c, 12 comps, 0.8–25 km, high ≤20%, medium ≤40%)', () => {
  assert.deepEqual(parseDealChecks(undefined), DEFAULT_DEAL_CHECKS);
  assert.deepEqual(parseDealComps(null), DEFAULT_DEAL_COMPS);
  assert.deepEqual(parseDealConfidence(undefined), DEFAULT_DEAL_CONFIDENCE);
  assert.equal(DEFAULT_DEAL_CHECKS.perDay, 20);
  assert.equal(DEFAULT_DEAL_CHECKS.dailyCapPence, 100);
  assert.deepEqual(DEFAULT_DEAL_CHECKS.split, { top60: 3, low_entry: 12, r2r: 5, project: 5 }, 'Batch 22c: cheap deals first (was 6/8/6); Batch 17 adds the Project candidates’ five');
  assert.equal(DEFAULT_DEAL_CHECKS.lowEntryShortlistExpiryDays, 14);
  assert.equal(DEFAULT_DEAL_COMPS.targetCount, 12);
  assert.deepEqual(DEFAULT_DEAL_COMPS.radiiKm, [0.8, 2, 5, 12, 25]);
  assert.equal(DEFAULT_DEAL_CONFIDENCE.highPct, 20);
  assert.equal(DEFAULT_DEAL_CONFIDENCE.mediumPct, 40);
});

test('stored values are read, objects or JSON strings, field by field', () => {
  const c = parseDealChecks({ perDay: 10, dailyCapPence: '250', split: { top60: 4, low_entry: 10, r2r: 6 } });
  assert.equal(c.perDay, 10);
  assert.equal(c.dailyCapPence, 250);
  assert.deepEqual(c.split, { top60: 4, low_entry: 10, r2r: 6, project: 5 }, 'a row from before Batch 17: the Project share at its default');
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

test('low entry: a £150,000 cheap price and search cap (Batch 22c), a £75,000 lender note, £50,000 cash in kept but unused, 1+ bedrooms, £4 a week, 8 areas a pass; a bad field keeps its default', () => {
  assert.deepEqual(parseLowEntry(undefined), DEFAULT_LOW_ENTRY);
  assert.equal(DEFAULT_LOW_ENTRY.maxCashIn, 50_000);
  assert.equal(DEFAULT_LOW_ENTRY.searchMaxPrice, 150_000);
  assert.equal(DEFAULT_LOW_ENTRY.cheapMaxPrice, 150_000);
  assert.equal(DEFAULT_LOW_ENTRY.lenderMinPrice, 75_000);
  assert.equal(DEFAULT_LOW_ENTRY.minBedrooms, 1);
  assert.equal(DEFAULT_LOW_ENTRY.weeklyCapPence, 400);
  assert.equal(DEFAULT_LOW_ENTRY.areasPerPass, 8);
  const s = parseLowEntry({ maxCashIn: 75_000, searchMaxPrice: '190000', weeklyCapPence: 600, cheapMaxPrice: 120_000, lenderMinPrice: '60000' });
  assert.equal(s.cheapMaxPrice, 120_000);
  assert.equal(s.lenderMinPrice, 60_000);
  assert.equal(s.maxCashIn, 75_000);
  assert.equal(s.searchMaxPrice, 190_000);
  assert.equal(s.weeklyCapPence, 600);
  assert.equal(s.areasPerPass, 8);
  assert.deepEqual(parseLowEntry({ maxCashIn: -5, searchMaxPrice: 5_000, minBedrooms: 9, weeklyCapPence: 'lots', areasPerPass: 0, cheapMaxPrice: 5_000, lenderMinPrice: -1 }), DEFAULT_LOW_ENTRY);
  // A row from before Batch 22c (no cheap price, the old £135,000 cap) reads the new fields at their defaults; the seeded cap is raised by schema.sql.
  const old = parseLowEntry({ maxCashIn: 50_000, searchMaxPrice: 135_000, minBedrooms: 1, weeklyCapPence: 400, areasPerPass: 8 });
  assert.equal(old.cheapMaxPrice, 150_000);
  assert.equal(old.lenderMinPrice, 75_000);
  assert.equal(old.searchMaxPrice, 135_000);
  assert.equal(parseLowEntry({ weeklyCapPence: 0 }).weeklyCapPence, 0, 'a zero cap stops the search');
});
