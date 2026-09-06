import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unflatten } from './devalue.ts';

test('unflatten resolves nested objects, arrays, primitives and specials', () => {
  // root {a: 1, b: [2, "x"], c: {a: 1}, u: undefined, n: NaN, d: Date}
  const flat = [
    { a: 1, b: 2, c: 4, u: -1, n: -3, d: 5, s: 6 },
    1,
    [1, 3],
    'x',
    { a: 1 },
    ['Date', '2026-01-02T00:00:00.000Z'],
    ['Set', 1, 3],
  ];
  const v = unflatten(flat) as Record<string, unknown>;
  assert.equal(v.a, 1);
  assert.deepEqual(v.b, [1, 'x']);
  assert.deepEqual(v.c, { a: 1 });
  assert.equal(v.u, undefined);
  assert.ok(Number.isNaN(v.n as number));
  assert.equal((v.d as Date).toISOString(), '2026-01-02T00:00:00.000Z');
  assert.deepEqual([...(v.s as Set<unknown>)], [1, 'x']);
});

test('unflatten tolerates cycles and holes', () => {
  const flat = [{ self: 0, arr: 1 }, [-2, 0]];
  const v = unflatten(flat) as Record<string, unknown>;
  assert.equal(v.self, v);
  const arr = v.arr as unknown[];
  assert.equal(arr.length, 2);
  assert.equal(arr[1], v);
});

test('unflatten returns undefined for empty input', () => {
  assert.equal(unflatten([]), undefined);
});
