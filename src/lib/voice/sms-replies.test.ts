import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWhoIsThis, replyKind } from './sms-replies.ts';

test('"who is this?" and close variants', () => {
  for (const t of ['Who is this?', "who's this", 'Whos this??', 'WHO IS THIS', 'who dis', 'Who are you?', 'Hi, who is this please?', 'Sorry who is this?', 'who is calling', 'Who is this number', "what's this number?", 'who texted me', 'Who is Stayful Intelligence?', 'who r u']) {
    assert.equal(isWhoIsThis(t), true, t);
  }
});

test('anything else is passed on', () => {
  for (const t of ['Can you call me tomorrow?', 'who is this deal for, and what is the rent', 'Thanks!', 'I want a refund', '', 'STOP sending me deals about who this is']) {
    assert.equal(isWhoIsThis(t), false, t);
    assert.equal(replyKind(t), 'other');
  }
});
