import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVED_DEALS_READ, analysesFigure, pickedCounts, savedStageCounts, settle, spentPence, stageTotal, timeSavedFigure, todayFigure } from './figures.ts';
import { hiddenNow } from '../profiles/reset.ts';

test('a tile that fails reads as { ok: false }, and the others still render', async () => {
  const [a, b] = await Promise.all([settle(async () => 3), settle(async () => { throw new Error('down'); })]);
  assert.deepEqual(a, { ok: true, value: 3 });
  assert.deepEqual(b, { ok: false });
  assert.deepEqual(timeSavedFigure(b as never, { ok: true, value: { full: 1, quick: 0 } }), { ok: false }, 'time saved needs both parts');
});

test("Today's 5: count waiting and Keep / Pass progress, the pick first; nothing yet before the list exists", () => {
  const answers = new Map<string, 'keep' | 'pass'>([['a', 'keep'], ['b', 'pass']]);
  const f = todayFigure({ day: '2026-10-02', stored: ['a', 'b', 'c', 'd', 'e'], pickDealId: null, answers, paused: false, profileName: null });
  assert.deepEqual({ size: f.size, waiting: f.waiting, kept: f.kept, passed: f.passed, done: f.done, ready: f.ready }, { size: 5, waiting: 3, kept: 1, passed: 1, done: false, ready: true });
  const before = todayFigure({ day: '2026-10-02', stored: null, pickDealId: null, answers: new Map(), paused: false, profileName: null });
  assert.equal(before.ready, false);
  assert.equal(before.size, 0);
  const all = new Map<string, 'keep' | 'pass'>(['a', 'b', 'c', 'd', 'e'].map((id) => [id, 'keep']));
  assert.equal(todayFigure({ day: 'd', stored: ['a', 'b', 'c', 'd', 'e'], pickDealId: null, answers: all, paused: false, profileName: null }).done, true);
  const paused = todayFigure({ day: 'd', stored: ['a'], pickDealId: null, answers: new Map(), paused: true, profileName: 'Leeds' });
  assert.equal(paused.size, 0);
  assert.equal(paused.paused, true);
});

test('deals picked: distinct across lists and the reveal; the active profile counts from its latest Start again', () => {
  const lists = [
    { profileId: 'p1', at: '2026-09-28T07:00:00Z', dealIds: ['a', 'b'] },
    { profileId: 'p1', at: '2026-09-30T07:00:00Z', dealIds: ['b', 'c'] },
    { profileId: null, at: '2026-09-01T07:00:00Z', dealIds: ['a', 'z'] },
    { profileId: 'p2', at: '2026-09-30T07:00:00Z', dealIds: ['y'] },
  ];
  assert.deepEqual(pickedCounts(lists, 'p1', null), { active: 3, all: 5 });
  assert.deepEqual(pickedCounts(lists, 'p1', '2026-09-29T00:00:00Z'), { active: 2, all: 5 }, 'Start again restarts the active profile only');
  assert.deepEqual(pickedCounts([], null, null), { active: null, all: 0 });
});

test('saved deals: Kept → Secured counts, Passed left out, per profile by its tags', () => {
  const view = [
    { key: 'd-1', stage: 'watching' as const },
    { key: 'd-2', stage: 'watching' as const },
    { key: 'd-3', stage: 'viewing' as const },
    { key: 'd-4', stage: 'passed' as const },
  ];
  const counts = savedStageCounts(view);
  assert.deepEqual(counts, { watching: 2, contacted: 0, viewing: 1, offer: 0, secured: 0 });
  assert.equal(stageTotal(counts), 3);
  const tags = new Map([['d-1', 'p1'], ['d-3', 'p2']]);
  assert.equal(stageTotal(savedStageCounts(view, tags, 'p1')), 1);
});

test('saved deals: a deal Start again (22d) hid drops the tile by one', () => {
  // Home reads My deals with the hidden entries excluded, as My deals does.
  assert.deepEqual(SAVED_DEALS_READ, { scope: 'own', hidden: 'exclude' });
  const view = [
    { key: 'd-1', stage: 'watching' as const, lastChangedAt: '2026-09-20T10:00:00Z' },
    { key: 'd-2', stage: 'contacted' as const, lastChangedAt: '2026-09-20T10:00:00Z' },
  ];
  const hidden = new Map([['d-2', { itemKey: 'd-2', hiddenAt: '2026-09-25T10:00:00Z', restoredAt: null }]]);
  const visible = view.filter((v) => !hiddenNow(v, hidden.get(v.key)));
  assert.equal(stageTotal(savedStageCounts(view)) - stageTotal(savedStageCounts(visible)), 1);
});

test('analyses: full = reports + full deal analyses; quick separately; never NaN', () => {
  assert.deepEqual(analysesFigure({ reports: 3, deepAnalyses: 1, quickLooks: 2 }), { full: 4, quick: 2 });
  assert.deepEqual(analysesFigure({ reports: Number.NaN, deepAnalyses: -1, quickLooks: 0 }), { full: 0, quick: 0 });
  const t = timeSavedFigure({ ok: true, value: { total: 120, baseline: 0, newSince: 120, joinDay: 'd', countedFrom: null, areas: 'all' } }, { ok: true, value: { full: 1, quick: 9 } });
  assert.deepEqual(t, { ok: true, value: { minutes: 60 + 30, scanned: 120, fullAnalyses: 1 } }, 'quick looks add no time');
});

test('total spent: debits less refunds, never below zero', () => {
  assert.equal(spentPence([{ kind: 'debit', facePence: 120 }, { kind: 'debit', facePence: 30.4 }, { kind: 'refund', facePence: 50 }]), 100);
  assert.equal(spentPence([{ kind: 'refund', facePence: 50 }]), 0);
  assert.equal(spentPence([]), 0);
});
