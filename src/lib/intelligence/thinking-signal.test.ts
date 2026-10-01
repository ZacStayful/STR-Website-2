import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuronAt, neuronCount, NEURONS } from './thinking-signal.ts';

test('the count grows only with real answers, towards the next level', () => {
  const s = { level: 1 as const, realAnswers: 3, nextAt: 13, levelAt: 3 };
  assert.equal(neuronCount(s, false), NEURONS[1].desktop);
  assert.equal(neuronCount({ ...s, realAnswers: 8 }, false), Math.round(40 + (75 - 40) * 0.5));
  assert.equal(neuronCount({ ...s, realAnswers: 13 }, false), 75);
  assert.equal(neuronCount({ ...s, realAnswers: 99 }, false), 75);
  assert.equal(neuronCount({ level: 3, realAnswers: 30, nextAt: null, levelAt: 18 }, true), NEURONS[3].phone);
});

test('the layout is fixed: the same neuron is always in the same place, inside the page', () => {
  assert.deepEqual(neuronAt(7), neuronAt(7));
  for (let i = 0; i < 200; i++) {
    const p = neuronAt(i);
    assert.ok(p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1);
  }
});
