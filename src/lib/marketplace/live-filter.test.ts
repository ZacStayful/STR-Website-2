import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Batch 16, Part B: a deal waiting on the shortlist (status pending_check)
 * must never reach a member. Every member-facing read of marketplace_deals
 * filters on status = 'live'; this pins those filters in the files that
 * hold them, so a later edit cannot quietly widen one.
 */
const here = join(process.cwd(), 'src', 'lib');
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

test('every member-facing marketplace read keeps its status = live filter', () => {
  const queries = read('marketplace/queries.ts');
  assert.ok((queries.match(/\.eq\('status', 'live'\)/g) ?? []).length >= 4, 'queries.ts: the grid, the cards by id, the areas and the public area page');
  assert.ok(/\.eq\('status', 'live'\)/.test(read('notify/daily-server.ts')), 'the daily email reads live deals only');
  assert.ok(/\.eq\("status", "live"\)/.test(read('listing/picks-run.ts')), 'the picks pool reads live deals only');
  assert.ok(/status\.eq\.pending_verify|'live', 'pending_verify'/.test(read('marketplace/recheck-run.ts')), 'the page-read queue takes live and pending_verify, never the shortlist');
  assert.ok(!/pending_check/.test(read('marketplace/queries.ts')), 'queries.ts never names the shortlist status');
});

test('the share view and the open only work on a live deal', () => {
  assert.ok(/status !== 'live'/.test(read('marketplace/share-view.ts')));
  assert.ok(/status !== 'live'/.test(read('marketplace/reactions-server.ts')));
});
