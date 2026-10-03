import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryStatus, isLive, liveContent, liveFromRow, type KnowledgeRow } from './rows.ts';

const row = (o: Partial<KnowledgeRow>): KnowledgeRow => ({
  id: 'x', slug: 's', question: null, variants: [], answer: null, category: null, channels: [], show_when: null,
  draft: { question: 'Q?', answer: 'A.', variants: [], category: 'deals', channels: ['chat'], show_when: '' }, draft_state: 'pending', draft_hash: 'h', draft_source: 'seed', draft_note: null, draft_at: null,
  version: 1, approved_at: null, approved_by: null, stale_reason: null, stale_at: null, retired_at: null, source: 'seed', seed_hash: null, created_at: '', updated_at: '', ...o,
});

test('status: a draft is never live; stale and retired are not live', () => {
  assert.equal(entryStatus(row({})), 'draft');
  assert.equal(isLive(row({})), false);
  assert.equal(entryStatus(row({ draft_state: 'rejected' })), 'rejected');
  const live = { question: 'Q?', answer: 'A.', category: 'deals' };
  assert.equal(entryStatus(row({ ...live })), 'approved');
  assert.equal(entryStatus(row({ ...live, stale_reason: 'x' })), 'stale');
  assert.equal(entryStatus(row({ ...live, retired_at: 'now' })), 'retired');
  assert.equal(liveContent(row({})), null);
});

test('a live row maps; a malformed one is dropped', () => {
  assert.deepEqual(liveFromRow({ id: 'i', slug: 's', version: 3, question: 'Q', answer: 'A', category: 'deals', variants: ['v'], channels: ['chat'], show_when: null }), { id: 'i', slug: 's', version: 3, question: 'Q', answer: 'A', category: 'deals', variants: ['v'], channels: ['chat'], showWhen: null });
  assert.equal(liveFromRow({ id: 'i', slug: 's', version: 3, question: 'Q', answer: null, category: 'deals' }), null);
});
