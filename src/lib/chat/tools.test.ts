import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_EXTRAS, CHAT_TOOLS, parseToolInput, statusFor, TOOL_NAMES, TOOL_STATUS } from './tools.ts';

test('no look-up takes a member, a user or an account', () => {
  for (const t of CHAT_TOOLS) {
    const props = Object.keys((t.input_schema as { properties?: Record<string, unknown> }).properties ?? {});
    for (const p of props) assert.doesNotMatch(p, /user|member|account|email|owner/i, `${t.name}.${p}`);
    assert.equal(t.strict, true, t.name);
    assert.equal((t.input_schema as { additionalProperties?: boolean }).additionalProperties, false, t.name);
  }
});

test('the tool list is fixed (part of the cached prefix)', () => {
  assert.deepEqual(CHAT_TOOLS.map((t) => t.name), [...TOOL_NAMES]);
});

test('inputs are checked again: a bad id, stage or date is refused', () => {
  assert.equal(parseToolInput('deal_facts', { deal_id: "1; drop table" }), null);
  assert.deepEqual(parseToolInput('deal_facts', { deal_id: '0b6a3c3e-1111-4222-8333-444455556666' }), { tool: 'deal_facts', dealId: '0b6a3c3e-1111-4222-8333-444455556666' });
  assert.equal(parseToolInput('my_deals', { stage: 'everyone' }), null);
  assert.deepEqual(parseToolInput('my_deals', { stage: null }), { tool: 'my_deals', stage: null });
  assert.equal(parseToolInput('why_called', { date: 'yesterday' }), null);
  assert.deepEqual(parseToolInput('why_called', { date: '2026-10-08' }), { tool: 'why_called', date: '2026-10-08' });
  assert.equal(parseToolInput('run_sql', {}), null);
  assert.equal(parseToolInput('search_knowledge', { question: '  ' }), null);
});

test('every look-up has a progress line, and a round shows its real look-up first', () => {
  for (const name of TOOL_NAMES) assert.ok(TOOL_STATUS[name], name);
  assert.equal(statusFor(['offer_action', 'todays_picks']), 'Looking at today’s picks…');
  assert.equal(statusFor(['offer_action']), 'Getting that ready…');
  assert.equal(statusFor(['run_sql']), null);
});

test('only buttons, facts and tap choices are answer extras (they never cost another round)', () => {
  assert.deepEqual([...ANSWER_EXTRAS].sort(), ['ask_which', 'offer_action', 'propose_fact']);
  for (const name of TOOL_NAMES) if (!ANSWER_EXTRAS.has(name)) assert.ok(!['offer_action', 'propose_fact', 'ask_which'].includes(name));
});

test('Batch 27: a plan is parsed step by step; nothing in it can name a member', () => {
  const r = parseToolInput('propose_actions', { steps: [{ action: 'pass', deal_id: '0b6a3c3e-1111-4222-8333-444455556666', stage: null, url: null, question: null, value: null }, { action: 'top_up', deal_id: null, stage: null, url: null, question: null, value: '50' }] });
  assert.deepEqual(r, {
    tool: 'propose_actions',
    steps: [
      { action: 'pass', dealId: '0b6a3c3e-1111-4222-8333-444455556666', stage: null, url: null, question: null, value: null },
      // An unknown action is kept here and dropped by the plan's own check (src/lib/si-actions/validate.ts), with its reason.
      { action: 'top_up', dealId: null, stage: null, url: null, question: null, value: '50' },
    ],
  });
  assert.equal(parseToolInput('propose_actions', { steps: [] }), null);
  const steps = (CHAT_TOOLS.find((t) => t.name === 'propose_actions')!.input_schema as { properties: { steps: { items: { properties: Record<string, unknown> } } } }).properties.steps.items.properties;
  for (const p of Object.keys(steps)) assert.doesNotMatch(p, /user|member|account|email|owner/i, p);
});

test('Batch 27: drafts, reports and tap choices are checked again', () => {
  assert.deepEqual(parseToolInput('draft_message', { deal_id: '0b6a3c3e-1111-4222-8333-444455556666', message: 'offer', offer_amount: '£140k' }), { tool: 'draft_message', dealId: '0b6a3c3e-1111-4222-8333-444455556666', message: 'offer', offerAmount: 140000 });
  assert.equal(parseToolInput('draft_message', { deal_id: '0b6a3c3e-1111-4222-8333-444455556666', message: 'send_it', offer_amount: null }), null);
  assert.equal(parseToolInput('report_issue', { kind: 'refund', summary: 'x', their_words: 'y' }), null);
  assert.deepEqual(parseToolInput('report_issue', { kind: 'bug', summary: 'Wrong price', their_words: 'It says £165k' }), { tool: 'report_issue', kind: 'bug', summary: 'Wrong price', theirWords: 'It says £165k' });
  assert.equal(parseToolInput('ask_which', { options: ['Only one'] }), null);
  assert.deepEqual(parseToolInput('ask_which', { options: ['The 2 bed in LS6', 'The 3 bed in LS11', 'The 2 bed in LS6'] }), { tool: 'ask_which', options: ['The 2 bed in LS6', 'The 3 bed in LS11'] });
});
