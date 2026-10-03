import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContent, contentHash, draftContent, draftJson, renderEntry, SAMPLE_MEMBER, staleReason, type EntryContent } from './render.ts';
import { schemaSnapshot } from './test-fixtures.ts';

const entry = (o: Partial<EntryContent>): EntryContent => ({ question: 'What does a Full analysis cost?', variants: [], answer: '{full_analysis_cost}, from your credit.', category: 'reports', channels: ['view', 'chat'], showWhen: null, ...o });

test('renders live figures', () => {
  assert.deepEqual(renderEntry(entry({}), schemaSnapshot(), null), { kind: 'ok', question: 'What does a Full analysis cost?', answer: '£4, from your credit.' });
  assert.deepEqual(renderEntry(entry({}), schemaSnapshot({ settings: { full_analysis_pence: 500 } }), null), { kind: 'ok', question: 'What does a Full analysis cost?', answer: '£5, from your credit.' });
});

test('a missing setting makes the entry stale; a read failure only hides it', () => {
  const r = renderEntry(entry({}), schemaSnapshot({ drop: ['full_analysis_pence'] }), null);
  assert.equal(r.kind, 'stale');
  assert.deepEqual(renderEntry(entry({}), null, null), { kind: 'unavailable' });
  assert.match(staleReason(entry({}), schemaSnapshot({ drop: ['full_analysis_pence'] })) ?? '', /full_analysis_cost/);
  assert.equal(staleReason(entry({}), schemaSnapshot()), null);
});

test('an unknown placeholder is stale, never shown as literal text', () => {
  const r = renderEntry(entry({ answer: '{full_analysis_price}, from your credit.' }), schemaSnapshot(), null);
  assert.equal(r.kind, 'stale');
});

test('a missing member value skips the entry for that member only', () => {
  const e = entry({ answer: 'I ranked {checked_count} live deals for you.' });
  assert.equal(renderEntry(e, schemaSnapshot(), null).kind, 'skip');
  assert.equal(renderEntry(e, schemaSnapshot(), { ...SAMPLE_MEMBER, checked: null }).kind, 'skip');
  assert.deepEqual(renderEntry(e, schemaSnapshot(), SAMPLE_MEMBER), { kind: 'ok', question: 'What does a Full analysis cost?', answer: 'I ranked 1,284 live deals for you.' });
  assert.equal(staleReason(e, schemaSnapshot()), null);
});

test('show_when hides an entry that does not apply', () => {
  const e = entry({ showWhen: 'pack_available', question: 'What do I get with the {pack_cost} pack?', answer: '{pack_credit} of credit for {pack_cost}, once.' });
  assert.equal(renderEntry(e, schemaSnapshot(), { ...SAMPLE_MEMBER, packAvailable: false }).kind, 'hidden');
  assert.deepEqual(renderEntry(e, schemaSnapshot(), SAMPLE_MEMBER), { kind: 'ok', question: 'What do I get with the £10 pack?', answer: '£30 of credit for £10, once.' });
});

test('approval checks: typed figures, unknown names, call rules, resolving now', () => {
  const g = schemaSnapshot();
  assert.deepEqual(checkContent(entry({}), g).errors, []);
  assert.ok(checkContent(entry({ answer: '£4, from your credit.' }), g).errors.some((e) => /currency/.test(e)));
  assert.ok(checkContent(entry({ answer: '{nope}.' }), g).errors.some((e) => /Unknown placeholder/.test(e)));
  assert.ok(checkContent(entry({ channels: ['call'], answer: 'You have {balance}.' }), g).errors.some((e) => /member/.test(e)));
  assert.ok(checkContent(entry({ channels: ['call'], answer: '{full_analysis_cost}{#calls_live} now{/calls_live}.' }), g).errors.some((e) => /sections/.test(e)));
  assert.ok(checkContent(entry({}), schemaSnapshot({ drop: ['full_analysis_pence'] })).errors.some((e) => /don't resolve/.test(e)));
  assert.ok(checkContent(entry({ category: 'misc' }), g).errors.length > 0);
  assert.ok(checkContent(entry({ channels: [] }), g).errors.length > 0);
  assert.ok(checkContent(entry({ variants: ['how much is {x}'] }), g).errors.length > 0);
});

test('length is checked in every combination of sections', () => {
  const long = entry({ answer: '{full_analysis_cost}. It opens the deal.{#welcome_offer} Your welcome price is {welcome_cost} until {welcome_until}.{/welcome_offer}' });
  const c = checkContent(long, schemaSnapshot());
  assert.deepEqual(c.errors, []);
  assert.equal(c.previews.length, 2);
  assert.ok(c.warnings.some((w) => /sentences \(welcome_offer\)/.test(w)));
});

test('the draft round-trips and hashes stably', () => {
  const e = entry({ variants: [' how much ', ''], showWhen: null });
  const back = draftContent(draftJson(e));
  assert.deepEqual(back, { ...e, variants: ['how much'] });
  assert.equal(contentHash(e), contentHash({ ...e, channels: ['chat', 'view'] }));
  assert.notEqual(contentHash(e), contentHash({ ...e, answer: 'other' }));
  assert.equal(draftContent(null), null);
});
