import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accuracyHint, accuracyLevel, levelMarkers, levelUpLabel } from './levels.ts';

const s = { advancedPct: 50, siPct: 75 };
// 3 mandatory + 20 optional: Advanced = 10 real optional; top = 3 + 15 = 18 real.
const base = { questions: 23, mandatory: 3, mandatoryDone: true, answered: 3, real: 3, realMandatory: 3 };

test('waking up until the mandatory questions are done', () => {
  const l = accuracyLevel({ ...base, mandatoryDone: false, answered: 1, real: 1, realMandatory: 1 }, s);
  assert.equal(l.level, 0);
  assert.equal(l.next?.needed, 2);
  assert.equal(accuracyHint(l), 'Answer 2 more and I can start matching you.');
});

test('Basic, then Advanced at half the optional questions answered for real', () => {
  assert.equal(accuracyLevel(base, s).level, 1);
  assert.equal(accuracyLevel(base, s).next?.needed, 10);
  assert.equal(accuracyLevel({ ...base, answered: 13, real: 13 }, s).level, 2);
  assert.equal(accuracyLevel({ ...base, answered: 12, real: 12 }, s).level, 1);
});

test('"Not sure" never counts', () => {
  const l = accuracyLevel({ ...base, answered: 20, real: 12 }, s);
  assert.equal(l.level, 1);
  assert.equal(l.next?.needed, 1);
});

test('Stayful Intelligence at the profile credit count', () => {
  const l = accuracyLevel({ ...base, answered: 18, real: 18 }, s);
  assert.equal(l.level, 3);
  assert.equal(l.next, null);
  assert.equal(accuracyHint(l), 'Stayful Intelligence unlocked. Every answer from here sharpens my picks.');
});

test('when the questions left cannot reach the next level, it asks to change a "Not sure"', () => {
  // 23 answered, 14 real: top needs 18, nothing left unanswered.
  const l = accuracyLevel({ ...base, answered: 23, real: 14 }, s);
  assert.equal(l.level, 2);
  assert.equal(l.next?.changeNotSure, 4);
  assert.equal(accuracyHint(l), 'Change 4 “Not sure” answers to unlock Stayful Intelligence.');
});

test('level-up labels and bar markers', () => {
  assert.equal(levelUpLabel(2), 'Advanced unlocked');
  assert.equal(levelUpLabel(0), null);
  const m = levelMarkers(base, s);
  assert.ok(m[1] < m[2] && m[2] < m[3]);
  assert.equal(m[3], 78);
});
