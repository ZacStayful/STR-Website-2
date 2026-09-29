import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_QUIZ, SECONDS_PER_QUESTION, minutesLeftLabel, parseAnswered, parseQuizRow, pillLabel, progress, seedFromGoals, type AnsweredMap, type QuizRecord } from './state.ts';
import { applyAnswer, emptyAnswers, questionsFor, type Answers, type QuestionId } from './questions.ts';
import { DEFAULT_GOALS, parseMarketGoals } from '../market/goals.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const AT = NOW.toISOString();

const fresh = (): Answers => emptyAnswers(DEFAULT_GOALS, null, []);
const quiz = (answered: AnsweredMap, over: Partial<QuizRecord> = {}): QuizRecord => ({ ...EMPTY_QUIZ, answered, ...over });

function answer(a: Answers, id: QuestionId, value: unknown): Answers {
  const r = applyAnswer(id, value, a);
  assert.ok(r.ok, `${id}: ${r.ok ? '' : r.error}`);
  return r.answers;
}

test('a new member: nothing answered, the first question next, the gate closed', () => {
  const p = progress(fresh(), EMPTY_QUIZ);
  assert.equal(p.percent, 0);
  assert.equal(p.next, 'roles');
  assert.equal(p.complete, false);
  assert.equal(p.mandatoryDone, false);
  assert.deepEqual(p.mandatory, ['roles', 'deal_types', 'where']);
  assert.deepEqual(p.types, [], 'no deal types yet, and nothing throws');
  assert.ok(p.minutesLeft >= 1);
  assert.equal(pillLabel(p), 'Profile 0%');
});

test('answers move the bar, "Not sure" counts for the bar but not as real, and the last one completes it', () => {
  let a = answer(fresh(), 'roles', ['investor']);
  a = answer(a, 'deal_types', ['buy_let']);
  a = answer(a, 'where', { mode: 'anywhere' });
  a = answer(a, 'budget', 'u200');
  const marks: AnsweredMap = { roles: { at: AT, notSure: false }, deal_types: { at: AT, notSure: false }, where: { at: AT, notSure: false }, budget: { at: AT, notSure: false } };
  let p = progress(a, quiz(marks));
  assert.equal(p.mandatoryDone, true, 'the mandatory answers open the app');
  assert.deepEqual(p.mandatory, ['roles', 'deal_types', 'where', 'budget']);
  assert.deepEqual(p.types, ['buy_let']);
  assert.equal(p.next, 'deals_done', 'straight on to question 5');
  assert.equal(p.answered.length, 4);
  assert.equal(p.real, 4);
  const total = questionsFor(a).length;
  assert.equal(p.percent, Math.round((4 / total) * 100));
  assert.equal(p.minutesLeft, Math.ceil(((total - 4) * SECONDS_PER_QUESTION) / 60));

  for (const q of questionsFor(a)) marks[q.id] = marks[q.id] ?? { at: AT, notSure: q.id === 'bedrooms' };
  p = progress(a, quiz(marks));
  assert.equal(p.complete, true);
  assert.equal(p.percent, 100);
  assert.equal(p.next, null);
  assert.equal(p.minutesLeft, 0);
  assert.equal(p.notSure, 1);
  assert.equal(p.real, total - 1);
  assert.equal(pillLabel(p), 'Profile');
});

test('a question that stops applying drops out of the count; marks for it are ignored', () => {
  let a = answer(fresh(), 'roles', ['investor']);
  a = answer(a, 'units_now', '1-2');
  const marks: AnsweredMap = { roles: { at: AT, notSure: false }, units_now: { at: AT, notSure: false }, unit_areas: { at: AT, notSure: true }, setup_budget: { at: AT, notSure: false } };
  const withUnits = progress(a, quiz(marks));
  assert.ok(withUnits.questions.includes('unit_areas'));
  assert.ok(withUnits.answered.includes('unit_areas'));
  assert.ok(!withUnits.answered.includes('setup_budget'), 'a rent-to-rent question is not this member’s');
  const none = progress(answer(a, 'units_now', '0'), quiz(marks));
  assert.ok(!none.questions.includes('unit_areas'));
  assert.ok(!none.answered.includes('unit_areas'));
});

test('the mandatory questions are one money question per chosen type (Q27)', () => {
  const marks: AnsweredMap = { roles: { at: AT, notSure: false }, deal_types: { at: AT, notSure: false }, where: { at: AT, notSure: false } };
  const two = answer(answer(fresh(), 'roles', ['investor', 'r2r']), 'deal_types', ['buy_let', 'r2r']);
  const p = progress(two, quiz(marks));
  assert.deepEqual(p.mandatory, ['roles', 'deal_types', 'where', 'budget', 'max_rent']);
  assert.equal(p.mandatoryDone, false);
  assert.equal(p.next, 'budget');
  const all = answer(two, 'deal_types', ['all']);
  assert.deepEqual(progress(all, quiz(marks)).mandatory, ['roles', 'deal_types', 'where', 'budget', 'brrr_budget', 'max_rent'], 'All: three budgets, each asked once');
  const exploring = answer(fresh(), 'roles', ['exploring']);
  assert.deepEqual(progress(exploring, EMPTY_QUIZ).mandatory, ['roles', 'deal_types', 'where'], 'no follow-up role question any more');
});

test('a member from before the quiz is seeded from what they already told us', () => {
  const stored = parseMarketGoals({ version: 1, home: { postcode: 'NG2 5GB', lat: 52.9, lng: -1.1 }, maxDistanceMiles: 25, budget: '200-350', bedrooms: 2, sourcingKind: 'sale', finance: { depositPct: 20, mortgageRatePct: 6 } })!;
  const { answers, answered } = seedFromGoals(emptyAnswers(stored, null, []), NOW);
  assert.deepEqual(answers.about.roles, ['investor']);
  assert.equal(answers.goals.path, 'buy');
  assert.equal(answers.goals.where, 'near');
  assert.deepEqual(Object.keys(answered).sort(), ['bedrooms', 'budget', 'deal_types', 'finance', 'roles', 'where']);
  assert.deepEqual(answers.goals.dealTypes, ['buy_let']);
  assert.equal(answered.budget?.notSure, false);
  const p = progress(answers, quiz(answered));
  assert.equal(p.mandatoryDone, true, 'never blocked: they answered the welcome questions');
  assert.ok(p.percent > 0 && p.percent < 100, 'part-way up the bar');
  assert.equal(p.next, 'deals_done');
});

test('seeding: "not sure yet" on money counts as answered but not real; both kinds leave the main role open; areas and anywhere are kept', () => {
  const rent = parseMarketGoals({ version: 1, sourcingKind: 'rent', maxRentPcm: null })!;
  const r = seedFromGoals(emptyAnswers(rent, null, ['NG']), NOW);
  assert.deepEqual(r.answers.about.roles, ['r2r']);
  assert.equal(r.answers.goals.where, 'areas');
  assert.equal(r.answered.max_rent?.notSure, true);
  assert.equal(progress(r.answers, quiz(r.answered)).mandatoryDone, true);

  const both = seedFromGoals(emptyAnswers(parseMarketGoals({ version: 1, sourcingKind: 'both', finance: { targetMarginPcm: 700 } })!, null, []), NOW);
  assert.deepEqual(both.answers.about.roles, ['investor', 'r2r']);
  assert.deepEqual(both.answers.goals.dealTypes, ['buy_let', 'r2r']);
  assert.equal(both.answers.goals.where, 'anywhere');
  assert.equal(both.answered.budget?.notSure, true, 'a money question per type, "not sure yet" as then');
  assert.equal(both.answered.max_rent?.notSure, true);
  assert.equal(both.answers.goals.r2r.minMarginPcm, 700, 'the one minimum they gave then is the rent-to-rent one too');
  const p = progress(both.answers, quiz(both.answered));
  assert.equal(p.mandatoryDone, true);
  assert.equal(p.next, 'deals_done');
});

test('quiz rows and marks are read tolerantly', () => {
  assert.equal(parseQuizRow(null), null);
  const rec = parseQuizRow({ started_at: AT, completed_at: null, last_question: 'budget', answered: { roles: { at: AT, notSure: false }, nope: { at: AT }, where: { at: 'never' }, risk: { at: AT, notSure: 'yes' } }, credit_grant_id: 'g1', reminder_collapsed_day: '2026-09-28' })!;
  assert.equal(rec.startedAt, AT);
  assert.equal(rec.lastQuestion, 'budget');
  assert.deepEqual(rec.answered, { roles: { at: AT, notSure: false }, risk: { at: AT, notSure: false } });
  assert.equal(rec.creditGrantId, 'g1');
  assert.equal(rec.reminderCollapsedDay, '2026-09-28');
  assert.equal(parseQuizRow({ last_question: 'made_up' })!.lastQuestion, null);
  assert.deepEqual(parseAnswered('junk'), {});
  assert.equal(minutesLeftLabel(1), 'about 1 minute left');
  assert.equal(minutesLeftLabel(4), 'about 4 minutes left');
});
