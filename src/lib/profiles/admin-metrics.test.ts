import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldAt, profileMetrics, type ProfileFact } from './admin-metrics.ts';

const f = (userId: string, createdAt: string, over: Partial<ProfileFact> = {}): ProfileFact => ({ userId, createdAt, pausedAt: null, deletedAt: null, ...over });
const W1 = '2026-09-14';
const W2 = '2026-09-21';
const weekEnd = (w: string) => Date.parse(`${w}T00:00:00Z`) + 7 * 24 * 60 * 60 * 1000;

test('held at a time: created by then, not deleted by then, at least one', () => {
  const facts = [f('u', '2026-09-01T00:00:00Z'), f('u', '2026-09-22T00:00:00Z', { deletedAt: '2026-09-25T00:00:00Z' })];
  assert.equal(heldAt(facts, Date.parse('2026-09-20T00:00:00Z')), 1);
  assert.equal(heldAt(facts, Date.parse('2026-09-23T00:00:00Z')), 2);
  assert.equal(heldAt(facts, Date.parse('2026-09-26T00:00:00Z')), 1);
  assert.equal(heldAt([], 0), 1, 'no row yet counts as one');
});

test('profiles per member, running per member, share with two or more, weekly active 1 vs 2+', () => {
  const members = [
    { id: 'solo', joined: '2026-01-01T00:00:00Z', weeks: [{ week: W1, active: true, visits: 0, actions: 0 }, { week: W2, active: false, visits: 0, actions: 0 }] },
    { id: 'multi', joined: '2026-01-01T00:00:00Z', weeks: [{ week: W1, active: true, visits: 0, actions: 0 }, { week: W2, active: true, visits: 0, actions: 0 }] },
    { id: 'new', joined: '2026-09-22T00:00:00Z', weeks: [{ week: W1, active: false, visits: 0, actions: 0 }, { week: W2, active: true, visits: 0, actions: 0 }] },
  ];
  const facts = [
    f('solo', '2026-01-01T00:00:00Z'),
    f('multi', '2026-01-01T00:00:00Z'),
    f('multi', '2026-09-22T00:00:00Z', { pausedAt: '2026-09-23T00:00:00Z' }),
    f('multi', '2026-09-22T00:00:00Z'),
  ];
  const m = profileMetrics(members, facts, { now: new Date('2026-09-28T00:00:00Z'), weekEnd, weekLabel: (w) => w });
  assert.deepEqual(m.byCount, [0, 2, 0, 1, 0, 0]);
  assert.deepEqual(m.byRunning, [0, 2, 1, 0, 0, 0]);
  assert.deepEqual(m.twoPlus, { base: 3, active: 1 });
  assert.deepEqual(m.weeks[0], { week: W1, label: W1, one: { base: 2, active: 2 }, many: { base: 0, active: 0 } }, 'multi had one profile in week 1; new had not joined');
  assert.deepEqual(m.weeks[1], { week: W2, label: W2, one: { base: 2, active: 1 }, many: { base: 1, active: 1 } });
});
