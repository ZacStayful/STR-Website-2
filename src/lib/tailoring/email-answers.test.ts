import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmailAnswer, sendParts, teaserAnswerUrl, teaserInSend } from './email-answers.ts';

const DEAL = '0b7c2b1e-5a1f-4c7e-9d7a-2f1e3c4b5a6d';
const OTHER = '1c8d3c2f-6b2a-4d8f-8e8b-3a2f4d5c6b7e';
const PROFILE = '2d9e4d3a-7c3b-4e9a-9f9c-4b3a5e6d7c8f';

test('a teaser link carries only the send token and the deal id', () => {
  const url = teaserAnswerUrl('https://stayful.co.uk/', 'tok_abc-123', DEAL, 'yes');
  assert.equal(url, `https://stayful.co.uk/p/d/tok_abc-123/${DEAL}?a=yes`);
  assert.ok(isEmailAnswer('no') && !isEmailAnswer('maybe'));
});

test('an answer counts only for a deal that send carried, and lands on its part’s profile', () => {
  const summary = { teasers: [DEAL, OTHER], parts: sendParts([PROFILE, null], [[DEAL], [OTHER]]) };
  assert.deepEqual(teaserInSend(summary, DEAL), { profileId: PROFILE });
  assert.deepEqual(teaserInSend(summary, OTHER), { profileId: null });
  assert.equal(teaserInSend(summary, '3e0f5e4b-8d4c-4f0b-8a0d-5c4b6f7e8d9a'), null, 'not in the email: nothing to answer');
  assert.deepEqual(teaserInSend({ teasers: [DEAL] }, DEAL), { profileId: null }, 'a send from before the parts were recorded');
  assert.equal(teaserInSend(null, DEAL), null);
  assert.equal(teaserInSend({ teasers: 'nope' }, DEAL), null);
  assert.deepEqual(teaserInSend({ teasers: [DEAL], parts: [{ profile: 'not-a-uuid', teasers: [DEAL] }] }, DEAL), { profileId: null });
});
