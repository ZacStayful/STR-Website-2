import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftMessages, groupingMessage, parseDraft, parseGrouping, redactQuestion } from './prompts.ts';

test('contact details never reach a model', () => {
  const r = redactQuestion('Call me on 07700 900123 or sam@example.com about LS6 2AB, see https://x.co/a');
  assert.doesNotMatch(r, /07700|sam@|LS6 2AB|https/);
  assert.match(r, /\[number\].*\[email\].*\[postcode\].*\[link\]/);
});

test('grouping: keys map back; unknown keys, slugs and repeats are dropped; nothing is lost', () => {
  const m = groupingMessage({
    questions: [{ id: 'uuid-a', text: 'Can I pause my plan?', channel: 'call' }, { id: 'uuid-b', text: 'how do i pause', channel: 'call' }, { id: 'uuid-c', text: 'hello?', channel: 'sms' }],
    gaps: [{ id: 'gap-1', label: 'Can I pause my plan?' }],
    entries: [{ slug: 'what_it_costs', question: 'What does it cost?', status: 'approved' }],
  });
  assert.match(m.text, /q1 \[call\]: "Can I pause my plan\?"/);
  const parsed = parseGrouping(
    JSON.stringify({ groups: [{ label: 'Can I pause my plan?', existing_gap: 'g1', entry: 'made_up', questions: ['q1', 'q2', 'q9', 'q1'] }, { label: 'dup', existing_gap: null, entry: 'what_it_costs', questions: ['q2'] }], not_questions: ['q3'] }),
    m,
    new Set(['what_it_costs']),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.groups, [{ label: 'Can I pause my plan?', gapId: 'gap-1', entrySlug: null, questionIds: ['uuid-a', 'uuid-b'] }]);
  assert.deepEqual(parsed.ungrouped, ['uuid-c']);
  assert.equal(parseGrouping('not json', m, new Set()), null);
});

test('drafting: the cached part is the same for every gap; replies are parsed strictly', () => {
  const a = draftMessages({ facts: 'F', knowledge: 'K', catalogue: 'C', label: 'Can I pause?', samples: ['pause plan?'] });
  const b = draftMessages({ facts: 'F', knowledge: 'K', catalogue: 'C', label: 'Other?', samples: [] });
  assert.equal(a.system, b.system);
  assert.notEqual(a.user, b.user);
  assert.deepEqual(parseDraft({ covered: true, question: 'Can I pause my plan?', answer: 'Yes: pause it in Account.', category: 'account', missing: '' }), { covered: true, question: 'Can I pause my plan?', answer: 'Yes: pause it in Account.', category: 'account' });
  assert.deepEqual(parseDraft({ covered: false, question: 'Do you do commercial?', answer: '', category: 'deals', missing: 'Commercial property is not covered.' }), { covered: false, question: 'Do you do commercial?', category: 'deals', missing: 'Commercial property is not covered.' });
  assert.equal(parseDraft({ covered: true, question: 'Q', answer: '', category: 'deals', missing: '' }), null);
  assert.equal(parseDraft('nope'), null);
});

// Review R3 (R3-66, R3-57): the grouping model sees the decided gaps (marked) and each answer's channels.
test('the grouping message marks decided gaps and lists an answer\'s channels', async () => {
  const { groupingMessage } = await import('./prompts.ts');
  const m = groupingMessage({
    questions: [{ id: 'q-1', text: 'Can I bring my dog?', channel: 'call' }],
    gaps: [{ id: 'gap-open', label: 'Changing my email' }, { id: 'gap-rej', label: 'Bringing a dog to a viewing', status: 'rejected' }, { id: 'gap-drafted', label: 'Parking', status: 'drafted' }],
    entries: [{ slug: 'credits', question: 'How does credit work?', status: 'approved', channels: ['view', 'chat'] }, { slug: 'old', question: 'Old one', status: 'rejected' }],
  });
  assert.match(m.text, /g1: Changing my email/);
  assert.match(m.text, /g2 \[rejected\]: Bringing a dog to a viewing/);
  assert.match(m.text, /g3: Parking/);
  assert.match(m.text, /credits \(approved; view\/chat\): How does credit work\?/);
  assert.match(m.text, /old \(rejected\): Old one/);
  assert.equal(m.gapKeys.get('g2'), 'gap-rej');
});
