import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshList } from './refresh.ts';

const run = (o: Partial<Parameters<typeof refreshList>[0]> = {}) =>
  refreshList({ current: ['a', 'b', 'c', 'd', 'e'], pinned: new Set(['a', 'b', 'c']), ranking: ['f1', 'a', 'b', 'c', 'd', 'e', 'f2'], finds: new Set(['f1', 'f2']), max: 5, ...o });

test('a better find replaces the worst unanswered, un-revealed card', () => {
  const r = run();
  assert.deepEqual(r.dealIds, ['a', 'b', 'c', 'd', 'f1']);
  assert.deepEqual(r.replaced, ['e']);
  assert.deepEqual(r.added, ['f1']);
});

test('pinned cards never go, and a find that ranks worse adds nothing', () => {
  const r = run({ pinned: new Set(['a', 'b', 'c', 'd', 'e']) });
  assert.equal(r.changed, false);
  assert.deepEqual(r.dealIds, ['a', 'b', 'c', 'd', 'e']);
});

test('never more than max; a short list is topped up', () => {
  const r = run({ current: ['a', 'b'], pinned: new Set(['a', 'b']) });
  assert.deepEqual(r.dealIds, ['a', 'b', 'f1', 'f2']);
  assert.equal(r.replaced.length, 0);
  assert.ok(run({ current: ['a', 'b', 'c', 'd'], pinned: new Set() }).dealIds.length <= 5);
});

test('idempotent: running it again on its result changes nothing', () => {
  const once = run();
  const twice = run({ current: once.dealIds });
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.dealIds, once.dealIds);
});
