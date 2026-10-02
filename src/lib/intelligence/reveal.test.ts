import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPctOf, revealDeals, revealIntro, revealNext, revealStale, revealTone } from './reveal.ts';

test('match % from the card line', () => {
  assert.equal(matchPctOf('83% match · 5 of 6'), 83);
  assert.equal(matchPctOf(null), null);
  assert.equal(matchPctOf('match'), null);
});

test('tone: a near miss or a low tailored match is "the closest"; no % never counts as low', () => {
  assert.equal(revealTone({ cards: 3, nearMiss: false, topMatchPct: 92, lowMatchPct: 70 }), 'match');
  assert.equal(revealTone({ cards: 3, nearMiss: false, topMatchPct: 60, lowMatchPct: 70 }), 'closest');
  assert.equal(revealTone({ cards: 1, nearMiss: true, topMatchPct: null, lowMatchPct: 70 }), 'closest');
  assert.equal(revealTone({ cards: 2, nearMiss: false, topMatchPct: null, lowMatchPct: 70 }), 'match');
  assert.equal(revealTone({ cards: 0, nearMiss: false, topMatchPct: null, lowMatchPct: 70 }), 'none');
});

test('the best match and two alternatives, in Today’s order', () => {
  assert.deepEqual(revealDeals(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c']);
  assert.deepEqual(revealDeals(['a']), ['a']);
  assert.match(revealIntro(3), /2 close alternatives/);
  assert.match(revealIntro(2), /1 close alternative\./);
  assert.equal(revealIntro(1), 'Here’s your best match right now.');
});

test('next paths and staleness', () => {
  assert.equal(revealNext('/deals?x=1'), '/deals?x=1');
  assert.equal(revealNext('//evil.example'), '/home', 'Batch 22e: the fallback is Home');
  assert.equal(revealNext('/welcome/reveal'), '/home', 'Batch 22e: the fallback is Home');
  assert.equal(revealNext(undefined), '/home', 'Batch 22e: the fallback is Home');
  assert.equal(revealStale('2026-10-01', '2026-10-02'), true);
  assert.equal(revealStale('2026-10-02', '2026-10-02'), false);
  assert.equal(revealStale(null, '2026-10-02'), false);
});
