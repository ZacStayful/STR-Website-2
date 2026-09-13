import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanItTotal, planItUrl, planningWindows } from './planit.ts';

test('windows are the last 12 months and the 12 before, back to back', () => {
  const w = planningWindows(new Date('2026-09-13T10:00:00Z'));
  assert.deepEqual(w.recent, { start: '2025-09-13', end: '2026-09-13' });
  assert.deepEqual(w.prior, { start: '2024-09-13', end: '2025-09-13' });
});

test('the request asks for one large application page in a radius and window', () => {
  const u = new URL(planItUrl(53.4084, -2.9916, 8, { start: '2025-09-13', end: '2026-09-13' }));
  assert.equal(u.hostname, 'www.planit.org.uk');
  assert.equal(u.searchParams.get('krad'), '8');
  assert.equal(u.searchParams.get('app_size'), 'Large');
  assert.equal(u.searchParams.get('pg_sz'), '1');
  assert.equal(u.searchParams.get('start_date'), '2025-09-13');
});

test('only a non-negative numeric total is read', () => {
  assert.equal(parsePlanItTotal({ total: 16, records: [] }), 16);
  assert.equal(parsePlanItTotal({ total: 0 }), 0);
  assert.equal(parsePlanItTotal({ total: null, records: [] }), 0);
  assert.equal(parsePlanItTotal({ total: null, records: [{}] }), null);
  assert.equal(parsePlanItTotal({ total: '16' }), null);
  assert.equal(parsePlanItTotal({ records: [] }), null);
  assert.equal(parsePlanItTotal(null), null);
});
