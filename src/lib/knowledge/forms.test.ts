import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentFromForm, slugFrom } from './forms.ts';

test('the admin form becomes content: phrasings one a line, unknown channels and categories dropped', () => {
  const values: Record<string, string> = { question: ' Q? ', variants: 'a\n\n b \na', answer: ' A. ', category: 'deals', showWhen: '' };
  const c = contentFromForm((n) => values[n] ?? null, (n) => (n === 'channels' ? ['chat', 'call', 'sms', 'chat'] : []));
  assert.deepEqual(c, { question: 'Q?', variants: ['a', 'b'], answer: 'A.', category: 'deals', channels: ['chat', 'call'], showWhen: null });
  assert.equal(contentFromForm((n) => (n === 'category' ? 'misc' : null), () => []).category, '');
});

test('slugs from questions', () => {
  assert.equal(slugFrom('Can I pause my plan?'), 'can_i_pause_my_plan');
  assert.equal(slugFrom('What do I get with the {pack_cost} pack?'), 'what_do_i_get_with_the_pack');
  assert.equal(slugFrom('24/7 support?'), 'q_24_7_support');
  assert.equal(slugFrom('???'), null);
});
