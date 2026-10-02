import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealIdsInSend, emailedDates, emailedLabel } from './emailed.ts';

const summary = { pickDealId: 'p', teasers: ['a', 'b'], parts: [{ profile: 'x', teasers: ['c'] }] };

test('a send carries its teasers, its parts\' teasers and the pick', () => {
  assert.deepEqual(dealIdsInSend(summary).sort(), ['a', 'b', 'c', 'p']);
  assert.deepEqual(dealIdsInSend(null), []);
  assert.deepEqual(dealIdsInSend({ teasers: 'nope' }), []);
});

test('"Emailed" only for a send that went: claimed, sending and failed ones do not count', () => {
  const sends = [
    { id: 's1', status: 'sent', sentAt: '2026-10-01T07:05:00Z', day: '2026-10-01', summary },
    { id: 's2', status: 'failed', sentAt: null, day: '2026-10-02', summary: { teasers: ['z'] } },
    { id: 's3', status: 'claimed', sentAt: null, day: '2026-10-02', summary: { teasers: ['y'] } },
    { id: 's4', status: 'sending', sentAt: null, day: '2026-10-02', summary: { teasers: ['w'] } },
  ];
  const got = emailedDates(['a', 'z', 'y', 'w', 'nope'], sends, []);
  assert.deepEqual([...got.keys()], ['a']);
  assert.equal(emailedLabel(got.get('a')!), 'Emailed 1 Oct');
});

test('the latest send wins, and an alert email counts only when its send went', () => {
  const sends = [
    { id: 's1', status: 'sent', sentAt: '2026-09-28T07:05:00Z', day: '2026-09-28', summary: { teasers: ['a'] } },
    { id: 's2', status: 'sent', sentAt: '2026-10-01T07:05:00Z', day: '2026-10-01', summary: { teasers: ['a'] } },
    { id: 's3', status: 'failed', sentAt: null, day: '2026-10-02', summary: {} },
  ];
  const alerts = [
    { dealId: 'k', sendId: 's2', notifiedAt: '2026-10-01T07:05:00Z' },
    { dealId: 'm', sendId: 's3', notifiedAt: '2026-10-02T07:05:00Z' },
    { dealId: 'n', sendId: null, notifiedAt: '2026-10-02T07:05:00Z' },
  ];
  const got = emailedDates(['a', 'k', 'm', 'n'], sends, alerts);
  assert.equal(got.get('a'), '2026-10-01T07:05:00Z');
  assert.equal(got.get('k'), '2026-10-01T07:05:00Z');
  assert.equal(got.has('m'), false);
  assert.equal(got.has('n'), false);
});
