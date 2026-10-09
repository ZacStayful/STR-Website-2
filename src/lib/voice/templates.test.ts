import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyProblemFor } from './templates-check.ts';
import { SMS_REPLY_OTHER, SMS_REPLY_WHO, belowFloorText, callText, dealEmail, missedCallEmail, missedCallTemplate, missedCallText } from './templates.ts';

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

// Batch 25: the deal texts and emails.
const deal = (short: string) => ({ short, headline: `a 2-bed flat to rent in ${short.replace(/^the 2-bed in /, '')} that could make around £1,100–£1,300 a month`, token: 'ab12cd34ef' });
const dctx = (base: string, short = 'the 2-bed in Harrogate') => ({ ...ctx(base), deal: deal(short) });
const LONG_TOWN = 'the 2-bed in Bishop Auckland and Shildon Village Outskirts';

test('Batch 25: every deal text is one GSM-7 segment, links to the app only, and fits even a long town name', () => {
  for (const base of BASES) {
    for (const short of ['the 2-bed in Harrogate', LONG_TOWN]) {
      for (const b of [callText('deal_link', dctx(base, short)), missedCallText('deal', dctx(base, short)), belowFloorText(dctx(base, short))]) {
        assert.equal(bodyProblemFor(b), null, JSON.stringify(b));
        assert.ok(b.includes(`${base}/si/deal/ab12cd34ef`), b);
        // Never a listing, a postcode or an exact figure.
        assert.doesNotMatch(b, /rightmove|zoopla|onthemarket|£\d/i);
      }
    }
  }
  assert.match(callText('deal_link', dctx(BASES[0])), /^Here's the 2-bed in Harrogate I just rang about\. It's in your deals: https:\/\/stayful\.co\.uk\/si\/deal\/ab12cd34ef/);
  assert.match(missedCallText('deal', dctx(BASES[0])), /^I tried to call you about the 2-bed in Harrogate\. It's in your deals:/);
  assert.match(belowFloorText(dctx(BASES[0])), /^A 2-bed in Harrogate that fits you is in your deals: .* Top up to get calls\./);
  assert.equal(missedCallTemplate('deal'), 'deal_link');
  // With no deal facts, the texts point to My deals.
  assert.match(missedCallText('deal', ctx(BASES[0])), /\/my-deals/);
});

test('Batch 25: the deal emails link to the deal in the app and say what the brief says', () => {
  const missed = missedCallEmail('deal', { ...dctx(''), callsPerMonth: 2 }, 'Sam');
  assert.equal(missed.cta.path, '/si/deal/ab12cd34ef?via=email');
  assert.equal(missed.subject, 'I tried to call you about a 2-bed in Harrogate');
  assert.match(missed.paragraphs[0], /^Hi Sam, I tried to ring you just now\. A deal has come up that matches what you're looking for better than anything I've found so far: a 2-bed flat to rent in Harrogate/);
  assert.match(missed.paragraphs.join(' '), /opening it is free/);
  assert.match(missed.paragraphs.join(' '), /at most twice a month/);
  const below = dealEmail('below_floor', deal('the 2-bed in Harrogate'), null, null);
  assert.match(below.paragraphs.join(' '), /Top up to get a call from me next time/);
  assert.doesNotMatch(below.paragraphs.join(' '), /tried to ring/);
});
