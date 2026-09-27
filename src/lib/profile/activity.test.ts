import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActivityKind, isCounted, isQualifying } from '../activity/kinds.ts';
import { buildActivityCall } from '../activity/event.ts';
import { QUESTIONS, SECTION_TOKENS } from './questions.ts';

const USER = '11111111-2222-4333-8444-555555555555';
const prod = { now: new Date('2026-09-28T09:00:00Z'), env: 'production', background: false };

test('the quiz’s events are registered: the member’s actions count, the reminder shown and the email click only record', () => {
  for (const k of ['profile_started', 'profile_answered', 'profile_not_sure', 'profile_finish_later', 'profile_resumed', 'profile_completed', 'profile_viewed', 'profile_edited', 'profile_reminder_collapsed', 'profile_reminder_tapped']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), true, k);
    assert.equal(isCounted(k), true, k);
  }
  for (const k of ['profile_reminder_shown', 'profile_email_click']) {
    assert.equal(isActivityKind(k), true, k);
    assert.equal(isQualifying(k), false, k);
    assert.equal(isCounted(k), false, k);
  }
});

test('every question id is a token the log accepts, so the question (never the answer) can be recorded', () => {
  for (const q of QUESTIONS) {
    const call = buildActivityCall(USER, 'profile_answered', { extras: { question: q.id, section: SECTION_TOKENS[q.section] } }, prod);
    assert.ok(call, q.id);
    assert.equal(call.extras.question, q.id, `${q.id} was dropped by the log's filter`);
    assert.equal(call.extras.section, SECTION_TOKENS[q.section], `${q.section} was dropped by the log's filter`);
  }
});
