import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ABOUT, effectiveRole, parseAboutYou, pathFor, roleList, RISK_TO_APPETITE, TIME_TO_MANAGEMENT } from './about.ts';

test('nothing stored reads as null; a stored value reads tolerantly', () => {
  assert.equal(parseAboutYou(null), null);
  assert.equal(parseAboutYou({}), null);
  assert.equal(parseAboutYou({ version: 2 }), null);
  const a = parseAboutYou({ version: 1, roles: ['sourcer', 'nope', 'investor', 'investor'], mainRole: 'ghost', dealsDone: '4-10', unitsNow: '99', unitAreas: ['ng', 'zz'], time: 'hands_off', risk: 'go', blocker: 'time' })!;
  assert.deepEqual(a.roles, ['investor', 'sourcer'], 'unknown and repeated roles dropped, canonical order');
  assert.equal(a.mainRole, null, 'a main role outside the roles is dropped');
  assert.equal(a.dealsDone, '4-10');
  assert.equal(a.unitsNow, null);
  assert.deepEqual(a.unitAreas, ['NG']);
  assert.equal(a.time, 'hands_off');
  assert.equal(a.risk, 'go');
  assert.equal(a.nextDeal, null);
  assert.deepEqual(parseAboutYou(JSON.parse(JSON.stringify(a))), a, 'stable through JSON');
});

test('one role is its own main role', () => {
  const a = parseAboutYou({ version: 1, roles: ['r2r'] })!;
  assert.equal(a.mainRole, 'r2r');
  assert.equal(effectiveRole(a), 'r2r');
  assert.equal(effectiveRole(DEFAULT_ABOUT), null);
  assert.equal(effectiveRole({ ...DEFAULT_ABOUT, roles: ['investor', 'sourcer'] }), null, 'two roles and no main one: not decided yet');
});

test('the path follows the main role, and "just exploring" follows their pick', () => {
  const with_ = (roles: string[], mainRole: string | null = null, exploringPick: string | null = null) => parseAboutYou({ version: 1, roles, mainRole, exploringPick })!;
  assert.equal(pathFor(with_(['investor'])), 'buy');
  assert.equal(pathFor(with_(['r2r'])), 'r2r');
  assert.equal(pathFor(with_(['sourcer'])), 'source');
  assert.equal(pathFor(with_(['manager'])), 'manage');
  assert.equal(pathFor(with_(['exploring'])), null, 'no pick yet');
  assert.equal(pathFor(with_(['exploring'], null, 'r2r')), 'r2r');
  assert.equal(pathFor(with_(['investor', 'manager'], 'manager')), 'manage');
  assert.equal(pathFor(with_(['investor', 'manager'])), null);
});

test('roleList and the two mirrors', () => {
  assert.deepEqual(roleList('investor'), []);
  assert.deepEqual(roleList(['exploring', 'investor']), ['investor', 'exploring']);
  assert.equal(TIME_TO_MANAGEMENT.hands_off, 'managed');
  assert.equal(TIME_TO_MANAGEMENT.hands_on, 'self');
  assert.equal(RISK_TO_APPETITE.avoid, 'cautious');
  assert.equal(RISK_TO_APPETITE.go, 'tolerant');
});
