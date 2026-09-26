import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capDay, isCapMonday, maxSendsOn, sendKey, slotAllowed, slotFor, testSendKey, SLOT_FOR, type SendKind } from './cap.ts';

const MONDAY = new Date('2026-09-28T07:05:00Z');
const TUESDAY = new Date('2026-09-29T07:05:00Z');

test('every capped kind but Your week shares the one daily slot', () => {
  const daily: SendKind[] = ['todays_5', 'deal_changes', 'picks_paused', 'notice'];
  for (const k of daily) assert.equal(slotFor(k), 'daily', k);
  assert.equal(slotFor('your_week'), 'weekly');
  // Every kind has a slot: a new kind cannot slip past the cap unassigned.
  for (const k of Object.keys(SLOT_FOR) as SendKind[]) assert.ok(['daily', 'weekly'].includes(slotFor(k)));
});

test('one email a day, two on Mondays', () => {
  assert.equal(maxSendsOn(TUESDAY), 1);
  assert.equal(maxSendsOn(MONDAY), 2);
  assert.equal(slotAllowed('daily', TUESDAY), true);
  assert.equal(slotAllowed('weekly', TUESDAY), false);
  assert.equal(slotAllowed('weekly', MONDAY), true);
});

test('the day is the UTC date, whatever the UK clock says', () => {
  // 23:30 UTC on Sunday is 00:30 BST on Monday; the cap still counts it as Sunday.
  const late = new Date('2026-09-27T23:30:00Z');
  assert.equal(capDay(late), '2026-09-27');
  assert.equal(isCapMonday(late), false);
  assert.equal(capDay(MONDAY), '2026-09-28');
});

test('the send key is the slot, so a second daily email cannot share it', () => {
  const a = sendKey('daily', 'u1', '2026-09-28');
  assert.equal(a, sendKey('daily', 'u1', '2026-09-28'));
  assert.notEqual(a, sendKey('weekly', 'u1', '2026-09-28'));
  assert.notEqual(a, sendKey('daily', 'u1', '2026-09-29'));
  assert.notEqual(a, sendKey('daily', 'u2', '2026-09-28'));
  assert.notEqual(a, sendKey('daily', 'u1', '2026-09-28', 'sms'));
  assert.ok(a.length <= 256);
  assert.match(testSendKey('n1'), /^test\//);
});

test('send tokens are unguessable and validated before use', async () => {
  const { newSendToken, isSendToken } = await import('./cap.ts');
  const a = newSendToken();
  assert.ok(isSendToken(a));
  assert.notEqual(a, newSendToken());
  assert.equal(isSendToken('short'), false);
  assert.equal(isSendToken("x'; drop table"), false);
});
