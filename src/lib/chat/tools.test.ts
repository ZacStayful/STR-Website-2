import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_TOOLS, parseToolInput, TOOL_NAMES } from './tools.ts';

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
