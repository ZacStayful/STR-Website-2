import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterRestart,
  answersAfterReset,
  awaitingAnswers,
  blankProfileInput,
  dealsToHide,
  hiddenNow,
  isResetAnswers,
  isResetDeals,
  learningSince,
  resetCandidates,
  resetMetrics,
  resetPayload,
  restartActivity,
  restorable,
  RESTORE_DAYS,
} from './reset.ts';
import { seatsFor, SHARED_QUESTION_IDS, type SavedProfile } from './rules.ts';
import { creditLine, profileCreditRef } from '../profile/credit.ts';
import { EMPTY_QUIZ, progress, type AnsweredMap } from '../profile/state.ts';
import { accuracyLevel } from '../profile/levels.ts';
import { applyAnswer, emptyAnswers, type Answers, type QuestionId } from '../profile/questions.ts';
import { DEFAULT_GOALS } from '../market/goals.ts';

const AT = '2026-09-28T09:00:00.000Z';
const mark = { at: AT, notSure: false };

function answer(a: Answers, id: QuestionId, value: unknown): Answers {
  const r = applyAnswer(id, value, a);
  assert.ok(r.ok, `${id}: ${r.ok ? '' : r.error}`);
  return r.answers;
}

/** A member who answered the mandatory questions, two About you ones and a few search ones. */
function answeredMember(): { answers: Answers; answered: AnsweredMap } {
  let a = emptyAnswers(DEFAULT_GOALS, null, []);
  a = answer(a, 'roles', ['investor']);
  a = answer(a, 'deal_types', ['buy_str']);
  a = answer(a, 'where', { mode: 'anywhere' });
  a = answer(a, 'budget', 'u200');
  const answered: AnsweredMap = { roles: mark, deals_done: mark, risk: mark, deal_types: mark, where: mark, budget: mark, min_profit: mark, finance: mark };
  return { answers: a, answered };
}

// ── Answers ──

test('"search answers only" keeps About you and its marks; "Clear everything" clears them too', () => {
  const { answered } = answeredMember();
  const search = answersAfterReset('search', answered);
  assert.deepEqual(Object.keys(search).sort(), ['deals_done', 'risk', 'roles']);
  for (const id of Object.keys(search)) assert.ok(SHARED_QUESTION_IDS.includes(id as QuestionId), `${id} is an About you question`);
  for (const id of ['deal_types', 'where', 'budget', 'min_profit', 'finance']) assert.equal(search[id as QuestionId], undefined, `${id} is cleared`);
  assert.deepEqual(answersAfterReset('everything', answered), {});
});

test('the accuracy level drops with the cleared answers', () => {
  const { answers, answered } = answeredMember();
  const s = { advancedPct: 50, siPct: 75 };
  const level = (a: Answers, marks: AnsweredMap) => {
    const p = progress(a, { ...EMPTY_QUIZ, answered: marks });
    return accuracyLevel({ questions: p.questions.length, mandatory: p.mandatory.length, mandatoryDone: p.mandatoryDone, answered: p.answered.length, real: p.real, realMandatory: p.mandatory.filter((id) => p.answered.includes(id)).length }, s).level;
  };
  const before = level(answers, answered);
  assert.ok(before >= 1, 'answered member is at least Basic');
  const cleared = emptyAnswers(DEFAULT_GOALS, answers.about, []);
  assert.equal(level(cleared, answersAfterReset('search', answered)), 0, 'mandatory search answers gone: back to the start');
  assert.equal(level(emptyAnswers(DEFAULT_GOALS, null, []), {}), 0);
});

test('the choices are closed lists', () => {
  assert.equal(isResetAnswers('search'), true);
  assert.equal(isResetAnswers('everything'), true);
  assert.equal(isResetAnswers('all'), false);
  assert.equal(isResetDeals('choose'), true);
  assert.equal(isResetDeals('delete'), false);
  assert.equal(isResetDeals(null), false);
});

// ── The £5 ──

test('a reset never re-pays the £5: nothing it sends can touch the grant or the completion, and the line never offers it', () => {
  const payload = resetPayload({ userId: 'u1', answers: 'everything', deals: 'clear_all', hide: ['d-1', 'd-1', 'd-2'], kept: 1 });
  assert.deepEqual(Object.keys(payload).sort(), ['answers', 'cleared', 'deals', 'hide', 'kept', 'shared', 'user']);
  for (const k of Object.keys(payload)) assert.doesNotMatch(k, /credit|grant|complete|reaction|pass/i);
  assert.deepEqual(payload.hide, ['d-1', 'd-2']);
  assert.equal(payload.cleared, 3, 'counts what was asked for, de-duplicated on write');
  // The grant's reference is one per account, so the ledger can only ever pay it once.
  assert.equal(profileCreditRef('u1'), profileCreditRef('u1'));
  const line = creditLine({ paid: true, already: true, decision: { kind: 'pay' }, pence: 500 });
  assert.match(line, /already had your £5/);
  assert.doesNotMatch(line, /on its way|Complete your profile for|to get your/);
});

// ── Deals ──

const tags = new Map([
  ['d-a', 'active'],
  ['d-b', 'active'],
  ['d-other', 'other'],
]);
const entries = [
  { key: 'd-a', mine: true },
  { key: 'd-b', mine: true },
  { key: 'd-other', mine: true },
  { key: 'd-untagged', mine: true },
  { key: 'd-team', mine: false },
];

test('only the active profile’s own deals can be cleared: never another profile’s or a teammate’s', () => {
  assert.deepEqual(resetCandidates(entries, tags, 'active'), ['d-a', 'd-b', 'd-untagged']);
  assert.deepEqual(resetCandidates(entries, tags, 'other'), ['d-other', 'd-untagged']);
});

test('dealsToHide hides only what was chosen, among the shown candidates', () => {
  const candidates = resetCandidates(entries, tags, 'active');
  const shown = ['d-a', 'd-b', 'd-untagged'];
  assert.deepEqual(dealsToHide({ candidates, choice: 'keep_all', shown, keep: [] }), []);
  assert.deepEqual(dealsToHide({ candidates, choice: 'clear_all', shown, keep: [] }), ['d-a', 'd-b', 'd-untagged']);
  assert.deepEqual(dealsToHide({ candidates, choice: 'choose', shown, keep: ['d-a', 'd-b'] }), ['d-untagged'], 'tick 2 of 3: the third is cleared');
});

test('a posted key that is not a candidate, or a deal tracked after the page was drawn, is never hidden', () => {
  const candidates = resetCandidates(entries, tags, 'active');
  const hide = dealsToHide({ candidates, choice: 'clear_all', shown: ['d-a', 'd-other', 'd-team', 'd-made-up'], keep: [] });
  assert.deepEqual(hide, ['d-a'], 'd-b and d-untagged were not shown; the rest are not this profile’s own');
  assert.deepEqual(dealsToHide({ candidates, choice: 'choose', shown: ['d-a'], keep: [] }), ['d-a']);
});

test('a cleared deal stays hidden until restored or acted on again', () => {
  const row = { itemKey: 'd-a', hiddenAt: '2026-09-28T10:00:00Z', restoredAt: null };
  assert.equal(hiddenNow({ lastChangedAt: '2026-09-20T10:00:00Z' }, row), true);
  assert.equal(hiddenNow({ lastChangedAt: '2026-09-28T10:00:00Z' }, row), true, 'changed in the same instant: still hidden');
  assert.equal(hiddenNow({ lastChangedAt: '2026-09-29T10:00:00Z' }, row), false, 'Kept or moved again after clearing');
  assert.equal(hiddenNow({ lastChangedAt: '2026-09-20T10:00:00Z' }, { ...row, restoredAt: '2026-09-29T10:00:00Z' }), false, 'restored');
  assert.equal(hiddenNow({ lastChangedAt: '2026-09-20T10:00:00Z' }, undefined), false, 'never cleared');
});

test('a cleared deal can be brought back for 30 days, then stays hidden', () => {
  const row = { itemKey: 'd-a', hiddenAt: '2026-09-01T10:00:00Z', restoredAt: null };
  assert.equal(RESTORE_DAYS, 30);
  assert.equal(restorable(row, new Date('2026-09-30T10:00:00Z')), true);
  assert.equal(restorable(row, new Date('2026-10-01T10:00:00Z')), true);
  assert.equal(restorable(row, new Date('2026-10-01T10:00:01Z')), false);
  assert.equal(hiddenNow({ lastChangedAt: '2026-08-01T00:00:00Z' }, row), true, 'past 30 days: still hidden');
  assert.equal(restorable({ ...row, restoredAt: '2026-09-02T00:00:00Z' }, new Date('2026-09-03T00:00:00Z')), false);
});

// ── Learning ──

test('learning restarts: only what came after the profile’s latest restart counts, and nothing is recorded', () => {
  const windowStart = new Date('2026-08-01T00:00:00Z');
  assert.equal(learningSince(windowStart, null).toISOString(), windowStart.toISOString());
  assert.equal(learningSince(windowStart, '2026-07-01T00:00:00Z').toISOString(), windowStart.toISOString(), 'an old restart changes nothing');
  assert.equal(learningSince(windowStart, '2026-09-28T09:00:00Z').toISOString(), '2026-09-28T09:00:00.000Z');

  const feedback = [
    { url: 'a', at: '2026-09-27T00:00:00Z', reaction: 'pass', reasons: ['too_expensive'] },
    { url: 'b', at: '2026-09-29T00:00:00Z', reaction: 'keep' },
    { url: 'c', at: null, reaction: 'pass' },
  ];
  const kept = afterRestart(feedback, (e) => e.at, '2026-09-28T09:00:00Z');
  assert.deepEqual(kept.map((e) => e.url), ['b'], 'the old "too expensive" Pass no longer counts');
  assert.equal(afterRestart(feedback, (e) => e.at, null).length, 3, 'no restart: everything');
  assert.equal(feedback.length, 3, 'the records themselves are untouched');
});

// ── Waiting for answers: no deals, no charge ──

const profile = (over: Partial<SavedProfile>): SavedProfile => ({
  id: 'p',
  userId: 'u',
  name: 'P',
  goals: null,
  areas: [],
  answered: {},
  forClient: false,
  copiedFrom: null,
  isActive: false,
  pausedAt: null,
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

test('a profile with no mandatory search answers is waiting; About you is not its to answer', () => {
  assert.equal(awaitingAnswers(profile({})), true);
  assert.equal(awaitingAnswers(profile({ answered: { roles: mark } })), true);
  const { answers } = answeredMember();
  assert.equal(awaitingAnswers(profile({ goals: answers.goals, answered: { deal_types: mark, where: mark, budget: mark } })), false);
  assert.equal(awaitingAnswers(profile({ goals: answers.goals, answered: { deal_types: mark, where: mark } })), true, 'the money question for its type too');
});

test('seats: a waiting profile that is not active gets no daily deals and no charge; the active one is left to the member-level rule', () => {
  const seats = seatsFor('u', [
    profile({ id: 'act', isActive: true, awaitingAnswers: true, createdAt: '2026-01-01T00:00:00Z' }),
    profile({ id: 'blank', awaitingAnswers: true, createdAt: '2026-02-01T00:00:00Z' }),
    profile({ id: 'ok', createdAt: '2026-03-01T00:00:00Z' }),
  ]);
  assert.deepEqual(seats.seats.map((s) => s.profile?.id), ['act', 'ok']);
  assert.equal(seats.allPaused, false);
  const legacy = seatsFor('u', [profile({ id: 'a', isActive: true }), profile({ id: 'b' })]);
  assert.deepEqual(legacy.seats.map((s) => s.profile?.id), ['a', 'b'], 'never restarted: served exactly as before');
});

// ── Start blank ──

test('Start blank has empty answers and copies nothing from the source profile', () => {
  const blank = blankProfileInput({ userId: 'u', name: 'New search', forClient: false });
  assert.deepEqual(blank, { user: 'u', name: 'New search', criteria: null, areas: [], answered: {}, for_client: false, copied_from: null });
  const source = profile({ id: 'src', goals: answeredMember().answers.goals, areas: ['LS'], answered: answeredMember().answered });
  const before = JSON.stringify(source);
  blankProfileInput({ userId: 'u', name: 'Another', forClient: true });
  assert.equal(JSON.stringify(source), before, 'the source profile is untouched');
});

// ── Activity and admin ──

test('profile_reset is logged once per reset: one event, deduplicated on the reset id', () => {
  const a = restartActivity('r1', { answers: 'search', kept: 2, cleared: 1 });
  assert.deepEqual(a, { kind: 'profile_reset', dedupeKey: 'profile_reset:r1', extras: { answers: 'search', deals_kept: 2, deals_cleared: 1 } });
  assert.equal(restartActivity('r1', { answers: 'search', kept: 2, cleared: 1 }).dedupeKey, a.dedupeKey, 'a retry carries the same key');
  assert.notEqual(restartActivity('r2', { answers: 'search', kept: 2, cleared: 1 }).dedupeKey, a.dedupeKey);
});

test('the resets panel: this week’s resets, members, and who Kept a deal within 7 days after', () => {
  const range = { start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') };
  const restarts = [
    { userId: 'a', kind: 'reset' as const, createdAt: '2026-09-28T10:00:00Z' },
    { userId: 'a', kind: 'reset' as const, createdAt: '2026-09-29T10:00:00Z' },
    { userId: 'b', kind: 'reset' as const, createdAt: '2026-10-01T10:00:00Z' },
    { userId: 'c', kind: 'blank' as const, createdAt: '2026-10-01T10:00:00Z' },
    { userId: 'd', kind: 'reset' as const, createdAt: '2026-09-20T10:00:00Z' },
  ];
  const keeps = [
    { userId: 'a', at: '2026-10-01T10:00:00Z' },
    { userId: 'b', at: '2026-09-30T10:00:00Z' },
    { userId: 'd', at: '2026-09-21T10:00:00Z' },
  ];
  const m = resetMetrics(restarts, keeps, range, new Date('2026-10-02T00:00:00Z'));
  assert.deepEqual(m, { resets: 3, members: 2, keptWithin7: 1, settled: 0 }, 'blank is not a reset; b Kept only before resetting; d was last week');
  assert.equal(resetMetrics(restarts, keeps, range, new Date('2026-10-10T00:00:00Z')).settled, 2);
});
