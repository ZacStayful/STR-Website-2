import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffListing, parseHistory, describeChange } from './recheck.ts';

const at = '2026-09-07T06:00:00.000Z';

test('diffListing returns null when nothing changed', () => {
  assert.equal(diffListing({ price: { amount: 220_000, period: 'total' }, status: 'available' }, { price: { amount: 220_000, period: 'total' }, status: 'available' }, at), null);
  // A missing status on the fresh snapshot is not a change.
  assert.equal(diffListing({ price: { amount: 220_000, period: 'total' }, status: 'available' }, { price: { amount: 220_000, period: 'total' } }, at), null);
});

test('diffListing records a price drop', () => {
  const e = diffListing({ price: { amount: 220_000, period: 'total' } }, { price: { amount: 210_000, period: 'total' } }, at);
  assert.ok(e);
  assert.equal(e.previousAmount, 220_000);
  assert.equal(e.amount, 210_000);
  assert.equal(e.status, null);
  assert.equal(e.notified, false);
  assert.match(describeChange(e), /down from £220,000 to £210,000 \(-4\.5%\)/);
});

test('diffListing records a status change without a price', () => {
  const e = diffListing({ price: { amount: 1195, period: 'pcm' }, status: 'available' }, { price: { amount: 1195, period: 'pcm' }, status: 'let_agreed' }, at);
  assert.ok(e);
  assert.equal(e.previousAmount, null);
  assert.equal(e.status, 'let_agreed');
  assert.equal(e.previousStatus, 'available');
  assert.equal(describeChange(e), 'now let agreed');
});

test('history parsing is tolerant and keeps the legacy notified flag', () => {
  const h = parseHistory([{ at, amount: 1, period: 'total', notified: true }, { junk: true }, 'x', { at, amount: 2, period: 'total' }]);
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((e) => e.notified), [true, false]);
  assert.deepEqual(parseHistory(null), []);
});
