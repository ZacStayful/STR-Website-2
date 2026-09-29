import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectHoldFor, type HoldInput } from './hold.ts';
import { DEFAULT_PROJECT_SETTINGS } from './config.ts';
import { needsWorkFrom } from './needs-work.ts';

const flagged = needsWorkFrom('A three bedroom end terrace in need of modernisation throughout');
const house = { bedrooms: 3, bathrooms: 1, propertyKind: 'house' as const, floorAreaSqft: null };

const input = (over: Partial<HoldInput> = {}): HoldInput => ({
  kind: 'sale',
  needsWork: flagged,
  auction: false,
  fetchable: true,
  texts: ['Three bedroom end terrace', 'In need of modernisation'],
  price: 70_000,
  facts: house,
  ...over,
});

test('a cheap house whose own words say it needs work waits for its Project check', () => {
  assert.equal(flagged.flag, true);
  assert.deepEqual(projectHoldFor(input(), DEFAULT_PROJECT_SETTINGS), { kind: 'hold' });
});

test('not flagged, a rental, or an auction lot: the ordinary flow', () => {
  assert.deepEqual(projectHoldFor(input({ needsWork: needsWorkFrom('Beautifully presented throughout') }), DEFAULT_PROJECT_SETTINGS), { kind: 'none' });
  assert.deepEqual(projectHoldFor(input({ needsWork: null }), DEFAULT_PROJECT_SETTINGS), { kind: 'none' });
  assert.deepEqual(projectHoldFor(input({ kind: 'rent' }), DEFAULT_PROJECT_SETTINGS), { kind: 'none' });
  assert.deepEqual(projectHoldFor(input({ auction: true }), DEFAULT_PROJECT_SETTINGS), { kind: 'none' }, 'Q10: auction lots stay Batch 16 auction deals');
});

test('an exclusion in its own words is retired before anything is spent', () => {
  assert.deepEqual(projectHoldFor(input({ texts: ['BISF construction', 'In need of modernisation'] }), DEFAULT_PROJECT_SETTINGS), { kind: 'retire', reason: 'project_excluded', detail: 'non_standard' });
  assert.deepEqual(projectHoldFor(input({ yearsRemainingOnLease: 62 }), DEFAULT_PROJECT_SETTINGS), { kind: 'retire', reason: 'project_excluded', detail: 'short_lease' });
  assert.deepEqual(projectHoldFor(input({ pageExclusion: 'conservation' }), DEFAULT_PROJECT_SETTINGS), { kind: 'retire', reason: 'project_excluded', detail: 'conservation' }, 'the page’s own reading, once read');
  assert.deepEqual(projectHoldFor(input({ pageExclusion: null }), DEFAULT_PROJECT_SETTINGS), { kind: 'hold' }, 'read and nothing found');
});

test('a page that can never be read can never be photo-checked', () => {
  assert.deepEqual(projectHoldFor(input({ fetchable: false }), DEFAULT_PROJECT_SETTINGS), { kind: 'retire', reason: 'project_uncheckable', detail: 'its page cannot be read' });
});

test('the free best case: a dear house cannot reach 10% of its value, and is never shown', () => {
  assert.deepEqual(projectHoldFor(input({ price: 450_000 }), DEFAULT_PROJECT_SETTINGS), { kind: 'retire', reason: 'not_project', detail: 'best case' });
  assert.deepEqual(projectHoldFor(input({ facts: null }), DEFAULT_PROJECT_SETTINGS), { kind: 'hold' }, 'bedrooms unknown: the page decides');
  assert.deepEqual(projectHoldFor(input({ price: null }), DEFAULT_PROJECT_SETTINGS), { kind: 'hold' });
});
