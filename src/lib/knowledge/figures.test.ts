import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureCheck } from './figures.ts';

test('typed figures block approval', () => {
  for (const s of ['From £19 a month', 'A 15% fee', 'Costs 33p a day', 'Spent at 1.3x', 'Spent at 1.3×', 'Wait 48 hours', 'Open 9am to 7pm', 'Ring 07700 900123', 'See https://stayful.co.uk/pricing', 'Email hello@stayful.co.uk', 'The 10-section report']) {
    assert.ok(figureCheck(s).blocking.length > 0, s);
  }
});

test('plain words, product names and number words pass (words warn)', () => {
  assert.deepEqual(figureCheck("Today's 5 is your daily list.").blocking, []);
  const w = figureCheck('About five Full analyses, twice a week.');
  assert.deepEqual(w.blocking, []);
  assert.equal(w.warnings.length, 2);
  assert.deepEqual(figureCheck('Anyone can ask someone.').warnings, []);
});

test('plural number words warn too ("thousands of deals" is a claim to check)', () => {
  const r = figureCheck('It searches thousands of deals and hundreds of areas.');
  assert.equal(r.blocking.length, 0);
  assert.equal(r.warnings.length, 2);
});
