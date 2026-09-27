import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricingNoticeEmail, planLine, firstRenewalOnOrAfter, type NoticeInput } from './pricing-notice.ts';
import { DEFAULT_DEAL_PRICING } from '../credit/deal-pricing.ts';

const base: NoticeInput = {
  siteUrl: 'https://intelligence.stayful.co.uk',
  firstName: 'Sam',
  date: '2026-10-15',
  pricing: DEFAULT_DEAL_PRICING,
  ladderText: '25p to £1',
  topupRate: 1.3,
  previousTopupRate: 1.5,
  plan: null,
  periodEnd: null,
  teamMember: false,
};

test('the notice says what changes today and from the date, from the settings', () => {
  const m = pricingNoticeEmail(base);
  assert.equal(m.subject, 'Changes to Stayful prices from 15 October 2026');
  assert.match(m.text, /Quick look at a deal: unchanged, 25p to £1/);
  assert.match(m.text, /a flat £4 on a plan/);
  assert.match(m.text, /optional, \+£2/);
  assert.match(m.text, /1\.3× the plan rate, down from 1\.5×/);
  assert.match(m.text, /33p a day, about £10 a month, charged only on days we send them/);
  assert.match(m.text, /\/terms/);
  assert.match(m.text, /\/privacy/);
  assert.match(m.text, /\/account\/usage/);
  assert.match(m.text, /Your top-up credit now goes further\./);
  assert.ok(m.html.includes('Hi Sam,'));
});

test('a Pro subscriber is told the new credit and the renewal it starts from', () => {
  const line = planLine({ ...base, plan: { code: 'pro', name: 'Pro', interval: 'month', monthlyCreditPence: 5000 }, periodEnd: '2026-10-03T10:00:00Z' });
  assert.equal(line, 'Your Pro plan: £39.99 of credit a month, from your renewal on 3 November 2026 (it’s £50 today).');
});

test('Starter does not change', () => {
  assert.equal(planLine({ ...base, plan: { code: 'starter', name: 'Starter', interval: 'month', monthlyCreditPence: 1900 }, periodEnd: '2026-10-20T00:00:00Z' }), 'Your Starter plan: no change, still £19 of credit a month.');
});

test('an annual plan changes at its next annual renewal', () => {
  const line = planLine({ ...base, plan: { code: 'pro_annual', name: 'Pro (annual)', interval: 'year', monthlyCreditPence: 5000 }, periodEnd: '2027-03-01T00:00:00Z' });
  assert.equal(line, 'Your annual Pro plan: £30 of credit a month, from your annual renewal on 1 March 2027 (it’s £50 a month today).');
});

test('a team member is pointed at their owner', () => {
  assert.match(planLine({ ...base, teamMember: true }), /managed by its owner/);
});

test('the first renewal on or after the date', () => {
  assert.equal(firstRenewalOnOrAfter('2026-10-03T10:00:00Z', '2026-10-15', 'month'), '2026-11-03T10:00:00.000Z');
  assert.equal(firstRenewalOnOrAfter('2026-10-20T10:00:00Z', '2026-10-15', 'month'), '2026-10-20T10:00:00.000Z');
  assert.equal(firstRenewalOnOrAfter(null, '2026-10-15', 'month'), null);
});
