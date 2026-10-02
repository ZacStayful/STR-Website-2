import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRACKETS, bracketLabel, bracketOf, budgetPanel, cheapCounts, dealsInBracket, previousWeek, type PanelMember } from './budget-panel.ts';

test('Batch 22c, Part F: a member’s bracket is their short-let budget, else their project budget, else none', () => {
  assert.deepEqual([...BRACKETS], ['u100', '100-200', 'u200', '200-350', '350-500', '500+', 'none']);
  assert.equal(bracketOf({ budget: 'u100', brrr: { budget: '500+' } }), 'u100');
  assert.equal(bracketOf({ budget: null, brrr: { budget: 'u200' } }), 'u200');
  assert.equal(bracketOf(null), 'none');
  assert.equal(bracketLabel('u200'), 'Under £200k (before Batch 22c)');
  assert.equal(bracketLabel('100-200'), '£100k–£200k');
  assert.equal(bracketLabel('none'), 'No budget');
});

test('live deals in a bracket use the same bounds as Today (budgetBounds)', () => {
  const prices = [52_000, 99_999, 100_000, 150_000, 200_000, 250_000, 600_000];
  assert.equal(dealsInBracket(prices, 'u100'), 3, 'up to and including £100,000');
  assert.equal(dealsInBracket(prices, '100-200'), 3);
  assert.equal(dealsInBracket(prices, 'u200'), 5);
  assert.equal(dealsInBracket(prices, '500+'), 1);
  assert.equal(dealsInBracket(prices, 'none'), 7);
});

test('per bracket: members, shown and kept per member and weekly active, this week and last, counting a member only once joined', () => {
  const thisWeek = '2026-09-28';
  assert.equal(previousWeek(thisWeek), '2026-09-21');
  const m = (id: string, bracket: PanelMember['bracket'], active: [boolean, boolean], joined = '2026-09-01T00:00:00Z'): PanelMember => ({ id, joined, bracket, active: new Map([['2026-09-21', active[0]], [thisWeek, active[1]]]) });
  const rows = budgetPanel({
    members: [m('a', 'u100', [true, true]), m('b', 'u100', [false, true]), m('c', 'u100', [false, true], '2026-09-29T09:00:00Z'), m('d', '200-350', [true, false])],
    today: [
      { u: 'a', w: '2026-09-21', shown: 10, kept: 2 },
      { u: 'a', w: '2026-09-28', shown: 5, kept: 1 },
      { u: 'c', w: '2026-09-28', shown: 5, kept: 0 },
    ],
    prices: [90_000, 300_000],
    thisWeek,
  });
  const u100 = rows.find((r) => r.bracket === 'u100')!;
  assert.equal(u100.members, 3);
  assert.equal(u100.liveDeals, 1);
  assert.deepEqual(u100.lastWeek, { base: 2, active: 1, shownPerMember: 5, keptPerMember: 1 }, 'c joined this week: not in last week');
  assert.deepEqual(u100.thisWeek, { base: 3, active: 3, shownPerMember: 3.3, keptPerMember: 0.3 });
  assert.equal(rows.find((r) => r.bracket === '200-350')!.thisWeek.active, 0);
  assert.equal(rows.some((r) => r.bracket === 'u200'), false, 'the legacy row only when someone has it');
  assert.ok(rows.some((r) => r.bracket === '500+'), 'every offered bracket is listed, empty or not');
});

test('cheap deals: live now, and gone live in the last 7 days against the 7 before', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const c = cheapCounts(
    [
      { status: 'live', price: 120_000, liveSince: '2026-10-01T00:00:00Z' },
      { status: 'retired', price: 140_000, liveSince: '2026-09-30T00:00:00Z' },
      { status: 'live', price: 149_000, liveSince: '2026-09-22T00:00:00Z' },
      { status: 'live', price: 160_000, liveSince: '2026-10-01T00:00:00Z' },
      { status: 'live', price: null, liveSince: '2026-10-01T00:00:00Z' },
    ],
    150_000,
    now,
  );
  assert.deepEqual(c, { liveNow: 2, wentLiveThisWeek: 2, wentLiveLastWeek: 1 });
});
