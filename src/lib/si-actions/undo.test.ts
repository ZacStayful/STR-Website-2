import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameValue, stageRestore, stageUnchanged, undoLine, undoOpen, undoUntil, type StageState } from './undo.ts';

const now = new Date('2026-10-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

test('Undo is open for 24 hours on a done, undoable step, once', () => {
  assert.equal(undoOpen({ kind: 'pass', status: 'done', finishedAt: hoursAgo(23), undoneAt: null }, now, 24), true);
  assert.equal(undoOpen({ kind: 'pass', status: 'done', finishedAt: hoursAgo(25), undoneAt: null }, now, 24), false);
  assert.equal(undoOpen({ kind: 'pass', status: 'done', finishedAt: hoursAgo(1), undoneAt: hoursAgo(0.5) }, now, 24), false);
  assert.equal(undoOpen({ kind: 'pass', status: 'failed', finishedAt: hoursAgo(1), undoneAt: null }, now, 24), false);
});

test('a charge is never undone: analyses, searches and link checks have no Undo', () => {
  for (const kind of ['full_analysis', 'deep_report', 'deep_search', 'check_link'] as const) {
    assert.equal(undoOpen({ kind, status: 'done', finishedAt: hoursAgo(1), undoneAt: null }, now, 24), false, kind);
  }
});

test('the window runs from the last step to finish', () => {
  assert.equal(undoUntil([hoursAgo(3), null, hoursAgo(1)], 24), new Date(now.getTime() + 23 * 3_600_000).toISOString());
  assert.equal(undoUntil([null], 24), null);
});

const s = (stage: StageState['stage'], reaction: StageState['reaction'], row: string | null = null): StageState => ({ stage, reaction, checkedListingId: row });

test('a stage step is put back only if it is still as the step left it', () => {
  assert.equal(stageUnchanged(s('passed', 'pass'), s('passed', 'pass')), true);
  assert.equal(stageUnchanged(s('watching', 'keep'), s('passed', 'pass')), false);
});

test('how a stage step is put back', () => {
  assert.equal(stageRestore(s('watching', 'keep'), s('passed', 'pass')), 'stage');
  assert.equal(stageRestore(s(null, null), s('watching', 'keep')), 'clear');
  assert.equal(stageRestore(s(null, null), s('contacted', 'keep', 'row-1')), 'clear_and_row');
});

test('answers compare by value, whatever the key order', () => {
  assert.equal(sameValue({ mode: 'areas', areas: ['LS', 'BD'] }, { areas: ['LS', 'BD'], mode: 'areas' }), true);
  assert.equal(sameValue(['brrr', 'r2r'], ['r2r', 'brrr']), false);
  assert.equal(sameValue(2, '2'), false);
  assert.equal(sameValue(undefined, null), true);
});

test('what Undo says', () => {
  assert.equal(undoLine({ undone: 4, changed: 0, failed: 0 }), 'Done — put all 4 back.');
  assert.equal(undoLine({ undone: 1, changed: 0, failed: 0 }), 'Done — put back.');
  assert.equal(undoLine({ undone: 3, changed: 1, failed: 0 }), 'Put back 3 of 4. 1 had changed since, so I left it.');
  assert.equal(undoLine({ undone: 0, changed: 2, failed: 0 }), 'Nothing put back: it has changed since, so I left it.');
});
