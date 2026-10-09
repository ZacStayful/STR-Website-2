import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceIn, allowedFigures, checkFigures, clampWords, cleanQuestion, figuresIn, wordCount } from './guard.ts';

test('figures are read in every form the app writes them', () => {
  const v = figuresIn('£38k cash in, £1,250 pcm, 12.5% yield, 80p, £4.00 and £1.2m').map((f) => f.value);
  assert.deepEqual(v, [38000, 1250, 12.5, 0.8, 4, 1200000]);
});

test('a figure from a tool, a setting or the member passes; an invented one fails', () => {
  const allowed = allowedFigures(['Profit £450–£700/mo at your finance', 'A full analysis is £4.00.', 'Balance £12.40']);
  assert.deepEqual(checkFigures('Your LS6 3-bed makes £450–£700 a month.', allowed), { ok: true });
  assert.deepEqual(checkFigures('A full analysis is £4.', allowed), { ok: true });
  assert.deepEqual(checkFigures('That is £250 more than the next one.', allowed), { ok: false, figures: ['£250'] });
  assert.deepEqual(checkFigures('You have £12.40 left, about 9% of a plan.', allowed), { ok: false, figures: ['9%'] });
});

test('small whole numbers are counts, not figures', () => {
  const allowed = allowedFigures([]);
  assert.deepEqual(checkFigures('You have 2 kept deals and 3 picks today.', allowed), { ok: true });
  assert.deepEqual(checkFigures('I checked 240 listings.', allowed), { ok: false, figures: ['240'] });
  assert.deepEqual(checkFigures('About £2.', allowed), { ok: false, figures: ['£2'] });
});

test('pence and pounds agree', () => {
  const allowed = allowedFigures(['The question cost 8p']);
  assert.deepEqual(checkFigures('That was £0.08.', allowed), { ok: true });
});

test('answers far over the limit are cut at a sentence', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} has five words.`).join(' ');
  const cut = clampWords(long, 80);
  assert.ok(wordCount(cut) <= 80);
  assert.ok(cut.endsWith('.'));
  assert.equal(clampWords('Short answer.', 80), 'Short answer.');
});

test('questions are cleaned and cut', () => {
  assert.equal(cleanQuestion('  how\nmuch\u0000 is it?  ', 500), 'how much is it?');
  assert.equal(cleanQuestion('x'.repeat(600), 500).length, 500);
  assert.equal(cleanQuestion(42, 500), '');
});

test('advice is caught, the survey line is not', () => {
  assert.deepEqual(adviceIn('Profit £450–£700 a month. Get a survey and your own advice before you offer.'), []);
  assert.deepEqual(adviceIn('Honestly, I’d recommend it — buy it.'), ["i'd recommend", 'buy it']);
  assert.deepEqual(adviceIn('Your buyer pays the deposit.'), []);
});
