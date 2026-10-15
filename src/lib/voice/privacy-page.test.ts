/**
 * Review R3 (R3-9, R3-129): what the privacy page promises lives in how the
 * page is put together, so it is pinned by reading the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/(marketing)/privacy/page.tsx', import.meta.url), 'utf8');

test('R3-129: the privacy page prints the live retention settings, not the code defaults', () => {
  assert.match(src, /getBillingSettings\(\)/);
  assert.match(src, /readKnowledgeSettings\(\)/);
  assert.match(src, /export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(src, /\{DEFAULT_VOICE\.transcriptRetentionDays\}/);
  assert.doesNotMatch(src, /\{DEFAULT_KNOWLEDGE_SETTINGS\.questionRetentionMonths\}/);
});

test('R3-9: the policy names the chat, the spoken question, and what goes to Anthropic and ElevenLabs', () => {
  assert.match(src, /Chat with Stayful Intelligence/);
  assert.match(src, /spoken question/);
  assert.match(src, /delete your chat history/);
  assert.doesNotMatch(src, /property details only/);
});
