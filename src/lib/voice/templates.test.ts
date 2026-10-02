import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyProblemFor } from './templates-check.ts';
import { SMS_REPLY_OTHER, SMS_REPLY_WHO, callText, missedCallEmail, missedCallText } from './templates.ts';

// The longest base URL we expect (a Vercel preview is longer than the live site).
const BASES = ['https://stayful.co.uk', 'https://str-website-2-git-batch-23-stayful.vercel.app'];
const ctx = (base: string) => ({ base, topupAmountPence: 2500, topupThresholdPence: 500 });

test('every text is one GSM-7 segment, signed off, ending with the STOP line', () => {
  const bodies = (base: string) => [
    callText('contact_card', ctx(base)),
    callText('auto_topup_link', ctx(base)),
    missedCallText('intro', ctx(base)),
    missedCallText('low_credit', ctx(base)),
    SMS_REPLY_WHO,
    SMS_REPLY_OTHER,
  ];
  for (const b of bodies(BASES[0])) {
    assert.equal(bodyProblemFor(b), null, JSON.stringify(b));
    assert.match(b, /Stayful Intelligence/);
  }
  // On the live site, link texts also leave room for a 4-figure top-up.
  assert.equal(bodyProblemFor(callText('auto_topup_link', { base: BASES[0], topupAmountPence: 10050, topupThresholdPence: 2050 })), null);
});

test('the texts say what the brief says', () => {
  assert.match(SMS_REPLY_WHO, /^It's Stayful Intelligence, your AI property assistant from Stayful\. Ring me on this number any time\./);
  assert.match(SMS_REPLY_OTHER, /^Thanks, I've passed that on\. You can also ring me on this number\./);
  assert.match(missedCallText('intro', ctx(BASES[0])), /^I tried to call to introduce myself/);
  assert.match(missedCallText('low_credit', ctx(BASES[0])), /^I tried to call you - you're nearly out of credit/);
  assert.match(callText('auto_topup_link', ctx(BASES[0])), /£25 when you drop below £5/);
  assert.match(callText('contact_card', ctx(BASES[0])), /https:\/\/stayful\.co\.uk\/si\/card/);
});

test('the missed-call emails carry the same link as the call', () => {
  assert.equal(missedCallEmail('intro', ctx(''), 'Sam').cta.path, '/si/card');
  assert.equal(missedCallEmail('low_credit', ctx(''), null).cta.path, '/si/topup');
  assert.match(missedCallEmail('low_credit', ctx(''), null).subject, /I tried to call you — you're nearly out of credit/);
  assert.match(missedCallEmail('intro', ctx(''), 'Sam').paragraphs[0], /^Hi Sam,/);
});
