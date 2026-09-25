import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDecision, retiredReasonFor, hasRecentLiveCheck, RETIRING_STATUSES } from './status.ts';

const NOW = new Date('2026-09-25T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

test('statuses that retire a deal, and the reason they record', () => {
  assert.ok(RETIRING_STATUSES.has('under_offer'), 'unlike picks, the marketplace retires under offer');
  assert.equal(retiredReasonFor('sold'), 'sold');
  assert.equal(retiredReasonFor('let_agreed'), 'let_agreed');
  assert.equal(retiredReasonFor('available'), null);
  assert.equal(retiredReasonFor(null), null);
});

test('open decision: every row of the matrix', () => {
  const base = { fetchable: true, lastCheckedLiveAt: null, lastConfirmedAt: ago(1), now: NOW };
  assert.deepEqual(openDecision({ ...base, fetch: 'ok_live' }), { kind: 'charge', verifiedVia: 'live' });
  assert.deepEqual(openDecision({ ...base, fetch: 'ok_gone', status: 'under_offer' }), { kind: 'just_gone', reason: 'under_offer' });
  assert.deepEqual(openDecision({ ...base, fetch: 'ok_gone', status: 'let_agreed' }), { kind: 'just_gone', reason: 'let_agreed' });
  assert.deepEqual(openDecision({ ...base, fetch: 'not_found' }), { kind: 'just_gone', reason: 'removed' });
  // Fetch could not run: fall back to recent evidence.
  assert.deepEqual(openDecision({ ...base, fetch: 'unavailable', lastCheckedLiveAt: ago(2) }), { kind: 'charge', verifiedVia: 'recent_live' });
  assert.deepEqual(openDecision({ ...base, fetch: 'unavailable', lastCheckedLiveAt: ago(7), lastConfirmedAt: ago(23) }), { kind: 'charge', verifiedVia: 'recent_confirm' });
  assert.deepEqual(openDecision({ ...base, fetch: 'unavailable', lastCheckedLiveAt: ago(7), lastConfirmedAt: ago(25) }), { kind: 'checking' });
  // Zoopla: never fetched, same fallbacks.
  assert.deepEqual(openDecision({ fetchable: false, fetch: null, lastCheckedLiveAt: null, lastConfirmedAt: ago(12), now: NOW }), { kind: 'charge', verifiedVia: 'recent_confirm' });
  assert.deepEqual(openDecision({ fetchable: false, fetch: null, lastCheckedLiveAt: null, lastConfirmedAt: ago(48), now: NOW }), { kind: 'checking' });
  assert.deepEqual(openDecision({ fetchable: false, fetch: null, lastCheckedLiveAt: null, lastConfirmedAt: null, now: NOW }), { kind: 'checking' });
  // A live check reused instead of fetching again.
  assert.deepEqual(openDecision({ ...base, fetch: null, lastCheckedLiveAt: ago(5) }), { kind: 'charge', verifiedVia: 'recent_live' });
  assert.ok(hasRecentLiveCheck(ago(6), NOW));
  assert.ok(!hasRecentLiveCheck(ago(6.01), NOW));
  assert.ok(!hasRecentLiveCheck(null, NOW));
});
