import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_TEXT, fullAnalysesFor, packClawbackPence, packCopy, packGrants, packLive, packOffer, publicOffer, returnMessage, snoozeUntil, todayCardShown, type PackFacts, packEmailKey } from './rules.ts';
import { DEFAULT_LIFECYCLE } from '../lifecycle/settings.ts';

const on = { ...DEFAULT_LIFECYCLE, starterPackFrom: '2026-10-01T09:00:00.000Z' };
const fresh: PackFacts = { createdAt: '2026-10-02T10:00:00Z', hadWelcome: false, teamMember: false, bought: false, alreadyHad: false, onPlan: false };
const rates = { welcome: 1, topup: 1.3 };

test('the offer is for new members only, and never twice', () => {
  assert.deepEqual(packOffer(fresh, on), { eligible: true });
  assert.deepEqual(packOffer(fresh, DEFAULT_LIFECYCLE), { eligible: false, reason: 'off' });
  assert.deepEqual(packOffer({ ...fresh, createdAt: '2026-09-30T10:00:00Z' }, on), { eligible: false, reason: 'existing_member' });
  assert.deepEqual(packOffer({ ...fresh, createdAt: null }, on), { eligible: false, reason: 'existing_member' });
  // The cutover moved back after they joined: they had the £20, so never the pack as well.
  assert.deepEqual(packOffer({ ...fresh, hadWelcome: true }, on), { eligible: false, reason: 'existing_member' });
  assert.deepEqual(packOffer({ ...fresh, teamMember: true }, on), { eligible: false, reason: 'team_member' });
  assert.deepEqual(packOffer({ ...fresh, bought: true }, on), { eligible: false, reason: 'bought' });
  assert.deepEqual(packOffer({ ...fresh, alreadyHad: true }, on), { eligible: false, reason: 'already_had' });
  assert.deepEqual(packOffer({ ...fresh, onPlan: true }, on), { eligible: false, reason: 'on_plan' });
});

test('"Not now" hides the Today card for the snooze days, not for ever', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  const until = snoozeUntil(now, 7);
  assert.equal(until, '2026-10-09T10:00:00.000Z');
  assert.equal(todayCardShown({ eligible: true }, until, new Date('2026-10-08T10:00:00Z')), false);
  assert.equal(todayCardShown({ eligible: true }, until, new Date('2026-10-09T10:00:01Z')), true);
  assert.equal(todayCardShown({ eligible: true }, null, now), true);
  assert.equal(todayCardShown({ eligible: false, reason: 'bought' }, null, now), false);
});

test('£10 for £30 lands as a £10 top-up and a £20 bonus, about 7 Full analyses at £4', () => {
  assert.deepEqual(packGrants(on), { topupPence: 1000, bonusPence: 2000 });
  assert.equal(fullAnalysesFor(on, 400, rates), 7);
  assert.equal(fullAnalysesFor(on, 0, rates), 0);
  // A pricier analysis or a dearer top-up rate changes the claim with it.
  assert.equal(fullAnalysesFor(on, 500, rates), 6);
});

test('the copy says what the settings say', () => {
  const c = packCopy(on, 400, rates);
  assert.equal(c.headline, 'Start with £30 of credit for £10');
  assert.equal(c.body, '£10 gets you £30 of credit: about 7 Full analyses, plus daily deals picked for you. It never expires.');
  assert.equal(c.buy, 'Buy for £10');
  assert.equal(c.cardTitle, '£10 gets you £30 of credit');
  assert.equal(c.cardBody, 'About 7 Full analyses, plus daily deals picked for you. One per person.');
  assert.equal(c.cardCta, 'Get £30 for £10');
  assert.equal(c.accountLine, 'New members: £10 gets you £30 of credit.');
  assert.equal(c.deadEnd, "You're out of credit. £10 gets you £30 of credit: about 7 Full analyses.");
  assert.equal(c.consent, CONSENT_TEXT);
  assert.match(c.checkoutText, /14-day right to cancel ends once you use any of it/);
  const odd = packCopy({ starterPackPricePence: 1250, starterPackCreditPence: 3000 }, 400, rates);
  assert.equal(odd.price, '£12.50');
});

test('a refund takes back the same share of the credit as of the payment', () => {
  assert.equal(packClawbackPence({ creditPence: 3000, chargedPence: 1000, refundedPence: 1000 }), 3000);
  assert.equal(packClawbackPence({ creditPence: 3000, chargedPence: 1000, refundedPence: 500 }), 1500);
  assert.equal(packClawbackPence({ creditPence: 3000, chargedPence: 1200, refundedPence: 1200 }), 3000);
  assert.equal(packClawbackPence({ creditPence: 3000, chargedPence: 1000, refundedPence: 5000 }), 3000);
  assert.equal(packClawbackPence({ creditPence: 3000, chargedPence: 0, refundedPence: 500 }), 0);
});

test('the return page says what happened', () => {
  assert.equal(returnMessage('granted', null, '£30')?.tone, 'ok');
  assert.match(returnMessage('blocked', 'card', '£30')!.text, /^This card has already had a starter pack .* we didn't take your payment/);
  assert.match(returnMessage('blocked', 'account', '£30')!.text, /^You have already had/);
  assert.equal(returnMessage(null, null, '£30'), null);
});

test('the public pages promise the welcome credit until the cutover, and the starter pack from it', () => {
  const s = { ...DEFAULT_LIFECYCLE, starterPackFrom: '2026-10-01T00:00:00.000Z' };
  assert.equal(packLive(s, new Date('2026-09-30T23:59:59Z')), false);
  assert.equal(packLive(s, new Date('2026-10-01T00:00:00Z')), true);
  assert.equal(packLive(DEFAULT_LIFECYCLE, new Date()), false, 'no cutover: never');
  const copy = packCopy(s, 400, { welcome: 1, topup: 1.3 });
  const before = publicOffer(copy, false, 2000);
  assert.equal(before.signupHeadline, 'Start with £20 of free credit');
  assert.equal(before.costLead, null);
  assert.match(before.checkEmailLine, /get your £20 of free credit\.$/);
  const after = publicOffer(copy, true, 2000);
  assert.equal(after.signupHeadline, 'Start with £30 of credit for £10');
  assert.equal(after.loginLink, '£10 gets you £30 of credit');
  assert.equal(after.checkEmailLine, 'Click it to activate your account.');
  assert.equal(after.costLead, 'New members can start with a £10 starter pack: £30 of credit, about 7 Full analyses of deals. It never expires.');
  for (const v of Object.values(after)) if (typeof v === 'string') assert.ok(!v.includes('£20'), `no £20 once the pack is live: ${v}`);
});

test('the claim\'s email key folds plus-tags and Gmail dots (Batch 21, B21)', () => {
  assert.equal(packEmailKey(' Jane.Doe+promo@Gmail.com '), 'janedoe@gmail.com');
  assert.equal(packEmailKey('jane.doe@googlemail.com'), 'janedoe@gmail.com');
  assert.equal(packEmailKey('jane.doe+x@example.co.uk'), 'jane.doe@example.co.uk');
  assert.equal(packEmailKey('+tag@example.com'), '+tag@example.com');
  assert.equal(packEmailKey(''), null);
  assert.equal(packEmailKey(null), null);
  assert.equal(packEmailKey('nobody'), null);
});

test('a Checkout started moments ago hides the offer until the webhook settles it (Batch 21, B47)', () => {
  const s = { starterPackFrom: '2026-10-01T00:00:00.000Z' };
  const facts = { createdAt: '2026-10-02T00:00:00Z', hadWelcome: false, teamMember: false, bought: false, alreadyHad: false, onPlan: false };
  assert.deepEqual(packOffer({ ...facts, checkoutPending: true }, s), { eligible: false, reason: 'pending' });
  assert.deepEqual(packOffer({ ...facts, checkoutPending: false }, s), { eligible: true });
  assert.deepEqual(packOffer({ ...facts, bought: true, checkoutPending: true }, s), { eligible: false, reason: 'bought' });
});
