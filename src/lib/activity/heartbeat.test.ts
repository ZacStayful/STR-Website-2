import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_MS, IDLE_MS, beatDue, hideWorthSending, isIdle, parsePing, pingBody, viaFrom, viewFor, withoutVia } from './heartbeat.ts';

const ID = '9b2f3c1e-0000-4000-8000-00000000abcd';

test('Today, deal pages and saved reports are views; nothing else is', () => {
  assert.deepEqual(viewFor('/today'), { type: 'today' });
  assert.deepEqual(viewFor('/today/'), { type: 'today' });
  assert.deepEqual(viewFor(`/deals/${ID}`), { type: 'deal', id: ID });
  assert.deepEqual(viewFor(`/reports/${ID.toUpperCase()}`), { type: 'report', id: ID });
  assert.equal(viewFor('/deals'), null);
  assert.equal(viewFor('/deals/not-an-id'), null);
  assert.equal(viewFor(`/deals/${ID}/extra`), null);
  assert.equal(viewFor('/my-deals'), null);
  assert.equal(viewFor(null), null);
});

test('the email or text marker is read and taken off the address', () => {
  assert.equal(viaFrom('?via=email'), 'email');
  assert.equal(viaFrom('focus=d-1&via=sms'), 'sms');
  assert.equal(viaFrom('?via=pigeon'), null);
  assert.equal(viaFrom(''), null);
  assert.equal(withoutVia('https://intelligence.stayful.co.uk/my-deals?focus=d-1&via=email#x'), '/my-deals?focus=d-1#x');
  assert.equal(withoutVia('https://intelligence.stayful.co.uk/today?via=email'), '/today');
  assert.equal(withoutVia('https://intelligence.stayful.co.uk/today'), null);
  assert.equal(withoutVia('not a url'), null);
});

test('beats only while the tab is shown and in use, once a minute', () => {
  const now = 10 * IDLE_MS;
  assert.equal(beatDue({ visible: true, lastInteraction: now - 1_000, lastSent: now - BEAT_MS }, now), true);
  assert.equal(beatDue({ visible: false, lastInteraction: now - 1_000, lastSent: now - BEAT_MS }, now), false);
  assert.equal(beatDue({ visible: true, lastInteraction: now - IDLE_MS, lastSent: now - BEAT_MS }, now), false);
  assert.equal(beatDue({ visible: true, lastInteraction: now - 1_000, lastSent: now - 10_000 }, now), false);
  assert.equal(isIdle(now - IDLE_MS + 1, now), false);
  assert.equal(hideWorthSending(now - 1_000, now), true);
  assert.equal(hideWorthSending(now - IDLE_MS, now), false);
});

test('a ping carries only what it needs', () => {
  assert.deepEqual(pingBody('beat'), { kind: 'beat' });
  assert.deepEqual(pingBody('beat', { pages: 0 }), { kind: 'beat' });
  assert.deepEqual(pingBody('load', { pages: 2, via: 'email', view: { type: 'today' } }), { kind: 'load', pages: 2, via: 'email', view: { type: 'today' } });
  assert.deepEqual(pingBody('page', { pages: 500 }), { kind: 'page', pages: 50 });
});

test('the server reads only a well-formed ping', () => {
  assert.deepEqual(parsePing({ kind: 'load', via: 'sms', view: { type: 'deal', id: ID }, pages: 3.7 }), { kind: 'load', via: 'sms', view: { type: 'deal', id: ID }, pages: 3 });
  assert.deepEqual(parsePing({ kind: 'beat', via: 'fax', view: { type: 'deal', id: 'x' }, pages: -1, path: '/secret' }), { kind: 'beat' });
  assert.equal(parsePing({ kind: 'dance' }), null);
  assert.equal(parsePing(null), null);
  assert.equal(parsePing([1]), null);
  assert.equal(parsePing('beat'), null);
});
