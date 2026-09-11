import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffListing, parseHistory, pendingEntries, markNotified, describeChange, recheckEmail, hasPriceDrop } from './recheck.ts';

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

test('history parsing is tolerant and pending/notified round-trip', () => {
  const h = parseHistory([{ at, amount: 1, period: 'total', notified: true }, { junk: true }, 'x', { at, amount: 2, period: 'total' }]);
  assert.equal(h.length, 2);
  assert.equal(pendingEntries(h).length, 1);
  assert.equal(pendingEntries(markNotified(h)).length, 0);
  assert.deepEqual(parseHistory(null), []);
});

test('recheck email lists every item with a deep link and escapes html', () => {
  const e = diffListing({ price: { amount: 220_000, period: 'total' } }, { price: { amount: 200_000, period: 'total' } }, at)!;
  const items = [{ id: 'abc', title: 'Flat <1>', address: '1 High St & Co', canonicalUrl: 'https://www.rightmove.co.uk/properties/1', entries: [e] }];
  assert.ok(hasPriceDrop(items));
  const mail = recheckEmail(items, 'https://intelligence.stayful.co.uk');
  assert.match(mail.subject, /^Price drop on a listing/);
  assert.match(mail.text, /1 High St & Co: price down/);
  assert.match(mail.text, /\/markets\?pane=listings&listing=abc/);
  assert.ok(mail.html.includes('1 High St &amp; Co'));
  assert.ok(!mail.html.includes('<1>'));
});
