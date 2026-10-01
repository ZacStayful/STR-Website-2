import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answersFor, type AnswerFacts } from './answers.ts';

const facts: AnswerFacts = {
  balancePence: 1240, topupRate: 1.3, openMinPence: 25, openMaxPence: 100, pack: { pricePence: 1000, creditPence: 3000 },
  alertsByText: false, checked: 43, tailored: false, belowTopLevel: true, fullPence: 500, pmiPence: 200,
  welcome: { fullPence: 250, until: '8 October' }, firstDeepPence: 600, freeMember: true, freeDelayHours: 48,
  call: { perMinPence: 65, textPence: 22, emailPence: 20 }, topupPresetsPence: [1000, 2500, 5000], autoTopupOn: false, noMatch: null,
};
const byKey = (f: AnswerFacts) => new Map(answersFor(f).map((a) => [a.key, a]));

test('at most 8, only those that apply', () => {
  assert.ok(answersFor(facts).length <= 8);
  assert.equal(byKey({ ...facts, pack: null }).has('pack'), false);
  assert.equal(byKey({ ...facts, freeMember: false }).has('free_delay'), false);
});

test('figures come from the facts: change a setting, the answer changes', () => {
  assert.match(byKey(facts).get('analysis')!.answer, /A full analysis is £5 \(£2\.50 on your matches until 8 October\).*£7 \(£6 your first time\)/);
  assert.match(byKey({ ...facts, fullPence: 600 }).get('analysis')!.answer, /A full analysis is £6/);
  assert.match(byKey({ ...facts, call: { ...facts.call, perMinPence: 70 } }).get('calls')!.answer, /about 70p a minute/);
  assert.match(byKey({ ...facts, pack: null }).get('topup')!.answer, /Top up £10, £25 or £50/);
});

test('a low match puts its answer first', () => {
  const a = answersFor({ ...facts, noMatch: 'Nothing near your criteria yet.' });
  assert.equal(a[0].key, 'no_match');
});

test('no price is typed into a template', () => {
  const src = readFileSync(new URL('./answers.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /£\s?\d|\d+p\b/);
});
