import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseSlots, DEFAULT_TODAY_MIX, fillMix, mixSlots, parseTodayMix } from './mix.ts';
import { cardToDrop, displayOrder } from './day.ts';
import type { DealType } from '../profile/deal-types.ts';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

test('the starting mix: All 2 / 2 / 1; two types 3 / 2 to the stronger best match; one type all 5', () => {
  assert.deepEqual(baseSlots(['buy_let', 'brrr', 'r2r']), { buy_let: 2, brrr: 1, r2r: 2 });
  assert.deepEqual(baseSlots(['buy_let', 'r2r'], { buy_let: 60, r2r: 80 }), { r2r: 3, buy_let: 2 });
  assert.deepEqual(baseSlots(['buy_let', 'r2r'], { buy_let: 80, r2r: 60 }), { buy_let: 3, r2r: 2 });
  assert.deepEqual(baseSlots(['brrr', 'r2r'], {}), { brrr: 3, r2r: 2 }, 'a tie goes to the question’s order');
  assert.deepEqual(baseSlots(['brrr']), { brrr: 5 });
  assert.deepEqual(baseSlots([]), {});
});

test('the shift toward kept types keeps at least 1 of each (Q28: 14 days, 3 Keeps a slot)', () => {
  const all: DealType[] = ['buy_let', 'brrr', 'r2r'];
  assert.deepEqual(mixSlots(all, {}), { buy_let: 2, brrr: 1, r2r: 2 }, 'no Keeps yet: the starting mix');
  assert.deepEqual(mixSlots(all, { r2r: 6 }), { buy_let: 1, brrr: 1, r2r: 3 }, 'the plan’s example: weights 2 / 4 / 1');
  assert.deepEqual(mixSlots(all, { r2r: 60 }), { buy_let: 1, brrr: 1, r2r: 3 }, 'however many Keeps, the floor holds');
  assert.deepEqual(mixSlots(all, { brrr: 9 }), { buy_let: 1, brrr: 3, r2r: 1 });
  assert.deepEqual(mixSlots(['buy_let', 'r2r'], { r2r: 3 }, { buy_let: 90, r2r: 10 }), { buy_let: 3, r2r: 2 }, 'weights 3 / 3: the tie goes to the heavier remainder, then the stronger match');
  assert.deepEqual(mixSlots(['buy_let', 'r2r'], { r2r: 12 }, { buy_let: 90, r2r: 10 }), { buy_let: 2, r2r: 3 });
  assert.deepEqual(mixSlots(['r2r'], { r2r: 30 }), { r2r: 5 });
  for (const keeps of [{}, { buy_let: 7 }, { brrr: 2, r2r: 11 }, { buy_let: 40, brrr: 40, r2r: 40 }]) {
    const s = mixSlots(all, keeps);
    assert.equal((s.buy_let ?? 0) + (s.brrr ?? 0) + (s.r2r ?? 0), 5, JSON.stringify(keeps));
    for (const t of all) assert.ok((s[t] ?? 0) >= 1, `${t} floor, ${JSON.stringify(keeps)}`);
  }
});

test('filling: each type up to its slots, dealt round the types, strongest first', () => {
  const lists = { buy_let: ids('b', 5), brrr: ids('p', 5), r2r: ids('r', 5) };
  const out = fillMix(['buy_let', 'brrr', 'r2r'], { buy_let: 2, brrr: 1, r2r: 2 }, lists, { r2r: 90, buy_let: 80, brrr: 70 });
  assert.deepEqual(out, ['r1', 'b1', 'p1', 'r2', 'b2']);
});

test('an empty slot goes only to another chosen type, strongest best match first', () => {
  const out = fillMix(['buy_let', 'brrr', 'r2r'], { buy_let: 2, brrr: 1, r2r: 2 }, { buy_let: ids('b', 5), brrr: [], r2r: ids('r', 5) }, { buy_let: 80, r2r: 90 });
  assert.equal(out.length, 5);
  assert.deepEqual(out.filter((id) => id.startsWith('r')), ['r1', 'r2', 'r3'], 'the stronger type takes the spare slot');
  const unchosen = fillMix(['buy_let'], { buy_let: 5 }, { buy_let: ids('b', 2), r2r: ids('r', 5), brrr: ids('p', 5) });
  assert.deepEqual(unchosen, ['b1', 'b2'], 'Buy and let only: never a rental or a Project deal, even on a short day');
});

test('a deal is never on the list twice', () => {
  const out = fillMix(['buy_let', 'r2r'], { buy_let: 3, r2r: 2 }, { buy_let: ['x', 'b2', 'b3'], r2r: ['x', 'r2', 'r3'] });
  assert.equal(new Set(out).size, out.length);
  assert.equal(out.length, 5);
});

test('nothing chosen, nothing to show: an empty list, not a crash', () => {
  assert.deepEqual(fillMix([], {}, { buy_let: ids('b', 5) }), []);
  assert.deepEqual(fillMix(['r2r'], { r2r: 5 }, {}), []);
});

test('the pick’s room comes from the most represented type, never an answered card', () => {
  const typeOf = (id: string): DealType => (id.startsWith('b') ? 'buy_let' : id.startsWith('p') ? 'brrr' : 'r2r');
  // The pick (r9) went first: two rent-to-rent, two buy-and-let, one BRRR, and the pick make six.
  const list = ['r9', 'b1', 'r1', 'p1', 'b2', 'r2'];
  assert.equal(cardToDrop(list, new Set(), typeOf, 'r9'), 'r2', 'rent-to-rent has three with the pick: its lowest goes');
  assert.equal(cardToDrop(list, new Set(['r2', 'r1']), typeOf, 'r9'), 'b2', 'answered cards stay');
  assert.equal(cardToDrop(['r9', 'p1'], new Set(['p1']), typeOf, 'r9'), null);
  // Through displayOrder: the stored mix 2 / 2 / 1 and a rent-to-rent pick.
  assert.deepEqual(displayOrder(['b1', 'r1', 'p1', 'b2', 'r2'], 'r9', new Set(), 5, typeOf), ['r9', 'b1', 'r1', 'p1', 'b2'], 'the lowest rent-to-rent card makes room: BRRR keeps its one');
  assert.deepEqual(displayOrder(['b1', 'r1', 'p1', 'b2', 'r2'], 'r9', new Set(), 5), ['r9', 'b1', 'r1', 'p1', 'b2'], 'without types, the lowest card, as before');
  assert.deepEqual(displayOrder(['b1', 'r1', 'b2', 'r2', 'p1'], 'r9', new Set(), 5, typeOf), ['r9', 'b1', 'r1', 'b2', 'p1'], 'never the only BRRR, even at the bottom');
});

test('the settings row: each mix must fill the day, anything else keeps the default', () => {
  assert.deepEqual(parseTodayMix(null), DEFAULT_TODAY_MIX);
  assert.deepEqual(parseTodayMix({ all: { buy_let: 1, brrr: 2, r2r: 2 } }).all, { buy_let: 1, brrr: 2, r2r: 2 });
  assert.deepEqual(parseTodayMix({ all: { buy_let: 3, brrr: 2, r2r: 2 } }).all, DEFAULT_TODAY_MIX.all);
  assert.deepEqual(parseTodayMix({ two: [4, 1] }).two, [4, 1]);
  assert.deepEqual(parseTodayMix({ two: [2, 3] }).two, [3, 2], 'the stronger type never gets fewer');
  assert.equal(parseTodayMix(JSON.stringify({ windowDays: 7, keepsPerSlot: 2 })).windowDays, 7);
});
