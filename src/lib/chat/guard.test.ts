import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceIn, allowedFigures, checkFigures, clampWords, cleanQuestion, figuresIn, saysDontKnow, wordCount } from './guard.ts';

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

test('pence and pounds agree; a kind never turns into another', () => {
  const allowed = allowedFigures(['The question cost 8p', '{"checked":240}']);
  assert.deepEqual(checkFigures('That was £0.08.', allowed), { ok: true });
  assert.deepEqual(checkFigures('That was £8.', allowed), { ok: false, figures: ['£8'] });
  assert.deepEqual(checkFigures('I checked 240 deals.', allowed), { ok: true });
  assert.deepEqual(checkFigures('It makes £240.', allowed), { ok: false, figures: ['£240'] });
});

test('a unit stuck to a figure is read, not skipped or misread', () => {
  assert.deepEqual(figuresIn('£999pcm, 18months, £80pn').map((f) => f.value), [999, 18, 80]);
  const allowed = allowedFigures(['Rent £1,250 pcm']);
  assert.deepEqual(checkFigures('Rent is £1,250pcm.', allowed), { ok: true });
  assert.deepEqual(checkFigures('Rent is £999pcm.', allowed), { ok: false, figures: ['£999'] });
});

test('ids in tool results allow no figures', () => {
  const allowed = allowedFigures(['{"deal_id":"0b6a3c3e-1111-4222-8333-444455556666"}']);
  assert.deepEqual(checkFigures('It makes £4222.', allowed), { ok: false, figures: ['£4222'] });
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

test('advice is caught, the survey line and honest caveats are not', () => {
  assert.deepEqual(adviceIn('Profit £450–£700 a month. Get a survey and your own advice before you offer.'), []);
  assert.deepEqual(adviceIn('Honestly, I’d recommend it — go for it.'), ["i'd recommend", 'go for it']);
  assert.deepEqual(adviceIn('Profits aren’t guaranteed; run a full analysis before you buy it.'), []);
  assert.deepEqual(adviceIn('Your buyer pays the deposit.'), []);
});

test("the don't-know line is recognised in any quote style", () => {
  assert.ok(saysDontKnow("I don't know that one yet — I've passed it to the team."));
  assert.ok(saysDontKnow('Sorry, I don’t know that one yet.'));
  assert.ok(!saysDontKnow('A full analysis is £4.'));
});
