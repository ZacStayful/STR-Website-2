import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followUpChannels } from './fallback.ts';

const member = { callsOn: true, numberOk: true, phone: '+447700900123', email: 'm@example.com' };

test('R3-82: calls switched off between the dial and the miss: no text, no email', () => {
  assert.deepEqual(followUpChannels({ ...member, callsOn: false }), { text: false, email: false });
});

test('the text needs a number that can take one; the email needs an address', () => {
  assert.deepEqual(followUpChannels(member), { text: true, email: true });
  assert.deepEqual(followUpChannels({ ...member, numberOk: false }), { text: false, email: true });
  assert.deepEqual(followUpChannels({ ...member, phone: null }), { text: false, email: true });
  assert.deepEqual(followUpChannels({ ...member, email: null }), { text: true, email: false });
});
