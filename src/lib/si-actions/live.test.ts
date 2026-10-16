import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftBehind, type LiveInstruction, type LiveStep } from './live.ts';

const now = new Date('2026-10-16T12:00:00Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
const ins = (over: Partial<LiveInstruction> = {}): LiveInstruction => ({ status: 'ready', starts_after: ago(10), charged_started_at: null, updated_at: ago(15), ...over });
const step = (over: Partial<LiveStep> = {}): LiveStep => ({ id: 's1', status: 'queued', started_at: null, finished_at: null, ...over });

test('a countdown is left behind a minute after it ended, not before', () => {
  assert.equal(leftBehind(ins({ starts_after: ago(10) }), [step()], now).expire, false);
  assert.equal(leftBehind(ins({ starts_after: ago(-3) }), [step()], now).expire, false, 'still counting down');
  assert.equal(leftBehind(ins({ starts_after: ago(61) }), [step()], now).expire, true);
});

test('a running instruction with steps going is never left behind', () => {
  const r = leftBehind(ins({ status: 'running', charged_started_at: ago(600), updated_at: ago(600) }), [step({ id: 'a', status: 'handed_out', started_at: ago(600) }), step({ id: 'b' })], now);
  assert.deepEqual(r, { expire: false, abandon: [], skipQueued: false });
});

test('queued steps nobody started for two minutes are skipped; a recent start keeps them', () => {
  const quiet = leftBehind(ins({ status: 'running', charged_started_at: ago(300), updated_at: ago(300) }), [step({ id: 'a', status: 'done', started_at: ago(290), finished_at: ago(200) }), step({ id: 'b' })], now);
  assert.equal(quiet.skipQueued, true);
  const busy = leftBehind(ins({ status: 'running', charged_started_at: ago(300), updated_at: ago(300) }), [step({ id: 'a', status: 'done', started_at: ago(290), finished_at: ago(30) }), step({ id: 'b' })], now);
  assert.equal(busy.skipQueued, false);
});

test('a step whose start never finished is abandoned after five minutes, freeing the rest', () => {
  const r = leftBehind(ins({ status: 'running', charged_started_at: ago(400), updated_at: ago(400) }), [step({ id: 'a', status: 'running', started_at: ago(400) }), step({ id: 'b' })], now);
  assert.deepEqual(r.abandon, ['a']);
  assert.equal(r.skipQueued, true);
  assert.deepEqual(leftBehind(ins({ status: 'running', charged_started_at: ago(60) }), [step({ id: 'a', status: 'running', started_at: ago(60) })], now).abandon, []);
});

test('nothing else is touched', () => {
  for (const status of ['awaiting_confirm', 'done', 'proposed']) assert.deepEqual(leftBehind(ins({ status, starts_after: ago(9999) }), [step()], now), { expire: false, abandon: [], skipQueued: false });
});
