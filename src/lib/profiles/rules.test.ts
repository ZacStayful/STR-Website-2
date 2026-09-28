import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GOALS } from '../market/goals.ts';
import { chargeOrder, checkName, criteriaForNewProfile, isRunning, labelsShown, limitReached, maxProfilesFor, parseProfileRow, profileLabel, profilePriceLine, SHARED_QUESTION_IDS } from './rules.ts';

const p = (over: Partial<{ id: string; name: string; isActive: boolean; createdAt: string; pausedAt: string | null; deletedAt: string | null }> = {}) => ({
  id: over.id ?? 'a',
  name: over.name ?? 'My deals',
  isActive: over.isActive ?? false,
  createdAt: over.createdAt ?? '2026-09-01T00:00:00Z',
  pausedAt: over.pausedAt ?? null,
  deletedAt: over.deletedAt ?? null,
});

test('names: trimmed, required, 40 characters, unique among live profiles ignoring case', () => {
  assert.deepEqual(checkName('  Client:   JS ', []), { ok: true, name: 'Client: JS' });
  assert.equal(checkName('', []).ok, false);
  assert.equal(checkName('x'.repeat(41), []).ok, false);
  const others = [p({ id: 'a', name: 'Client: JS' }), p({ id: 'b', name: 'Old', deletedAt: '2026-09-02T00:00:00Z' })];
  assert.equal(checkName('client: js', others).ok, false);
  assert.equal(checkName('Client: JS', others, 'a').ok, true, 'renaming a profile to its own name is fine');
  assert.equal(checkName('old', others).ok, true, 'a deleted profile frees its name');
});

test('limit: five for a member, one for a team member', () => {
  assert.equal(maxProfilesFor(false, 5), 5);
  assert.equal(maxProfilesFor(true, 5), 1);
  assert.equal(limitReached(4, 5), false);
  assert.equal(limitReached(5, 5), true);
});

test('running = neither paused nor deleted', () => {
  assert.equal(isRunning(p()), true);
  assert.equal(isRunning(p({ pausedAt: '2026-09-02T00:00:00Z' })), false);
  assert.equal(isRunning(p({ deletedAt: '2026-09-02T00:00:00Z' })), false);
});

test('charge order: the active profile first, then oldest first; paused and deleted left out', () => {
  const list = [
    p({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
    p({ id: 'paused', createdAt: '2026-01-02T00:00:00Z', pausedAt: '2026-09-01T00:00:00Z' }),
    p({ id: 'active', createdAt: '2026-06-01T00:00:00Z', isActive: true }),
    p({ id: 'new', createdAt: '2026-08-01T00:00:00Z' }),
    p({ id: 'gone', createdAt: '2026-01-03T00:00:00Z', deletedAt: '2026-09-01T00:00:00Z' }),
  ];
  assert.deepEqual(chargeOrder(list).map((x) => x.id), ['active', 'old', 'new']);
});

test('labels show from two live profiles, or once one was deleted', () => {
  assert.equal(labelsShown([p()]), false);
  assert.equal(labelsShown([p(), p({ id: 'b' })]), true);
  assert.equal(labelsShown([p(), p({ id: 'b', deletedAt: '2026-09-01T00:00:00Z' })]), true);
  assert.equal(profileLabel({ name: 'Client: JS', deletedAt: null }), 'Client: JS');
  assert.equal(profileLabel({ name: 'Client: JS', deletedAt: '2026-09-01T00:00:00Z' }), 'Client: JS (deleted profile)');
});

test('a new profile copies the criteria and points them at the chosen path', () => {
  const buy = { ...DEFAULT_GOALS, path: 'buy' as const, sourcingKind: 'sale' as const, budget: '200-350' as const };
  assert.equal(criteriaForNewProfile(buy, 'buy'), buy);
  const r2r = criteriaForNewProfile(buy, 'r2r')!;
  assert.equal(r2r.path, 'r2r');
  assert.equal(r2r.sourcingKind, 'rent');
  assert.equal(r2r.budget, '200-350', 'everything else is copied');
  assert.equal(criteriaForNewProfile(null, 'buy'), null);
});

test('the price line names the profile and keeps the member’s own price', () => {
  assert.equal(profilePriceLine('Daily deals: 43p a day (33p on a plan), about £13 a month, charged only on days we send them'), 'Daily deals for this profile: 43p a day (33p on a plan), about £13 a month, charged only on days we send them');
  assert.equal(profilePriceLine(null), null);
});

test('rows parse tolerantly and never carry a malformed profile', () => {
  assert.equal(parseProfileRow(null), null);
  assert.equal(parseProfileRow({ id: 'x' }), null);
  const row = parseProfileRow({ id: 'x', user_id: 'u', name: 'My deals', criteria: null, areas: ['m', 7], answered: { where: { at: '2026-09-01T00:00:00Z', notSure: false }, junk: 1 }, is_active: true, created_at: '2026-09-01T00:00:00Z' })!;
  assert.deepEqual(row.areas, ['M']);
  assert.equal(row.goals, null);
  assert.deepEqual(Object.keys(row.answered), ['where']);
  assert.equal(row.isActive, true);
});

test('the shared (About you) questions are only about you', () => {
  for (const id of ['where', 'budget', 'max_rent', 'min_profit']) assert.equal(SHARED_QUESTION_IDS.includes(id as never), false, id);
});
