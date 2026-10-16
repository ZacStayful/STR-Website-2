import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALL_STATUS_LABELS, MEMBER_CALL_STATUS, MEMBER_REASONS, STANDOUT_REASONS, callStatusLabel, memberCallStatusLabel, memberReasonLabel, reasonLabel } from './reasons.ts';

// Review R3 (R3-98): the chat reads the member's own words for a reason and a call's status, never the admin page's.
test('every reason and call status has words for the member, in the second person, apart from the admin words', () => {
  for (const code of Object.keys(STANDOUT_REASONS)) {
    const words = memberReasonLabel(code);
    assert.ok(words.length > 0 && words !== code, code);
    assert.doesNotMatch(words, /Primary profile|\/admin|thresholds skipped|\bthey\b|\btheir\b/, code);
  }
  for (const code of Object.keys(CALL_STATUS_LABELS)) {
    const words = memberCallStatusLabel(code);
    assert.ok(words.length > 0 && words !== code, code);
    assert.doesNotMatch(words, /\bthey\b|\btheir\b/, code);
  }
  assert.equal(Object.keys(MEMBER_REASONS).length, Object.keys(STANDOUT_REASONS).length);
  assert.equal(Object.keys(MEMBER_CALL_STATUS).length, Object.keys(CALL_STATUS_LABELS).length);
  assert.match(memberReasonLabel('must_have_missed'), /your must-haves/);
  assert.match(memberCallStatusLabel('deal_acted'), /you opened it/);
});

test('an unknown code reads as itself for both; the admin words stay as they were', () => {
  assert.equal(memberReasonLabel('later_batch_reason'), 'later batch reason');
  assert.equal(memberCallStatusLabel('blocked:no_consent'), 'Not placed: no consent');
  assert.equal(memberCallStatusLabel(null), '—');
  assert.equal(reasonLabel('must_have_missed'), 'Misses a must-have');
  assert.equal(callStatusLabel('deal_acted'), 'No call: they opened it or said Not for me first');
});
