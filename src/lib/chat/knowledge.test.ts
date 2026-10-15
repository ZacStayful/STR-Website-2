import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAnswer } from './knowledge.ts';
import type { MatchResult } from '../knowledge/match.ts';
import type { RenderResult } from '../knowledge/render.ts';

const entries = [
  { id: 'a', slug: 'pack' },
  { id: 'b', slug: 'what_it_costs' },
  { id: 'c', slug: 'credits' },
];
const matched = (...pairs: [string, number][]): MatchResult => ({
  outcome: 'answered',
  matches: pairs.map(([entryId, confidence]) => ({ entryId, slug: entries.find((e) => e.id === entryId)!.slug, version: 1, confidence, phrasing: 'q' })),
});
const render = (by: Record<string, RenderResult>) => (e: { id: string }) => by[e.id] ?? { kind: 'unavailable' };
const ok = (slug: string): RenderResult => ({ kind: 'ok', question: `Q ${slug}`, answer: `A ${slug}` });

// Review R3 (R3-33): a covered question is answered from the next entry that applies, or said to be not for this member.
test('the top entry answers when it renders; otherwise the next match above the threshold does', () => {
  const r1 = chooseAnswer(matched(['a', 0.8], ['b', 0.6]), entries, 0.55, render({ a: ok('pack'), b: ok('what_it_costs') }));
  assert.equal(r1.outcome, 'answered');
  assert.deepEqual(r1.answers.map((a) => a.slug), ['pack']);
  assert.equal(r1.hidden, null);
  const r2 = chooseAnswer(matched(['a', 0.8], ['b', 0.6]), entries, 0.55, render({ a: { kind: 'hidden' }, b: ok('what_it_costs') }));
  assert.deepEqual(r2.answers.map((a) => [a.slug, a.confidence]), [['what_it_costs', 0.6]], 'a hidden top entry falls through');
  assert.equal(r2.topConfidence, 0.8);
});

test('covered but not for this member: answered, with the entry as hidden and nothing to say', () => {
  const r = chooseAnswer(matched(['a', 0.8], ['b', 0.5]), entries, 0.55, render({ a: { kind: 'skip', missing: ['pack_cost'] }, b: ok('what_it_costs') }));
  assert.equal(r.outcome, 'answered', 'the question is covered, so it is never a gap');
  assert.deepEqual(r.answers, []);
  assert.equal(r.hidden, 'pack', 'the second match is below the threshold, so it is not tried');
});

test('a stale or unreadable entry is passed over; with nothing left it is low confidence', () => {
  const r = chooseAnswer(matched(['a', 0.8], ['b', 0.7]), entries, 0.55, render({ a: { kind: 'stale', reason: 'x', missing: [] }, b: ok('what_it_costs') }));
  assert.deepEqual(r.answers.map((a) => a.slug), ['what_it_costs']);
  const none = chooseAnswer(matched(['a', 0.8]), entries, 0.55, render({ a: { kind: 'unavailable' } }));
  assert.deepEqual(none, { outcome: 'low_confidence', answers: [], topConfidence: 0.8, hidden: null });
});

test("the matcher's own verdict stands below the threshold", () => {
  const r = chooseAnswer({ outcome: 'low_confidence', matches: [{ entryId: 'a', slug: 'pack', version: 1, confidence: 0.4, phrasing: 'q' }] }, entries, 0.55, render({ a: ok('pack') }));
  assert.deepEqual(r, { outcome: 'low_confidence', answers: [], topConfidence: 0.4, hidden: null });
});
