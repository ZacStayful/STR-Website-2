import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePath, lowCreditCopy, lowCreditDue, lowCreditMayGoAlone, lowCreditMessage, lowCreditSection, lowUnderRule, type LowCreditNotice } from './low-credit.ts';
import { buildDaily } from '../notify/message.ts';
import { renderEmail } from '../notify/render-email.ts';

const NOW = new Date('2026-10-05T09:00:00Z');
const SITE = 'https://intelligence.stayful.co.uk';
const due = (over: Partial<Parameters<typeof lowCreditDue>[0]> = {}) =>
  lowCreditDue({ noPlan: true, balancePence: 460, spendableBasePence: 460, lowCreditPence: 500, lastToldAt: null, alertsOn: true, hasEmail: true, admin: false, now: NOW, ...over });
const notice = (over: Partial<LowCreditNotice> = {}): LowCreditNotice => ({
  balancePence: 460,
  kind: 'decision',
  starter: { code: 'starter', name: 'Starter', pricePence: 1900, creditPence: 1900 },
  topupPence: 1000,
  card: null,
  pack: null,
  ...over,
});

test('the notice is due at £5 or less with something left, with no plan, once a cycle', () => {
  assert.equal(due(), true);
  assert.equal(due({ balancePence: 500, spendableBasePence: 500 }), true, 'exactly £5');
  assert.equal(due({ balancePence: 501, spendableBasePence: 501 }), false);
  assert.equal(due({ balancePence: 0, spendableBasePence: 0 }), false, 'out is the out-of-credit email, unchanged');
  assert.equal(due({ noPlan: false }), false, 'a plan keeps the 80% rule');
  assert.equal(due({ alertsOn: false }), false, 'the "Picks paused / out of credit" switch');
  assert.equal(due({ hasEmail: false }), false);
  assert.equal(due({ admin: true }), false);
  assert.equal(due({ lastToldAt: '2026-09-20T09:00:00Z' }), false, 'told 15 days ago');
  assert.equal(due({ lastToldAt: '2026-09-04T09:00:00Z' }), true, 'told 31 days ago');
  assert.equal(lowUnderRule({ balancePence: 300, spendableBasePence: 230.8, lowCreditPence: 0 }), false, 'a zero setting switches the rule off');
});

test('the decision: Starter or a £10 top-up, each through the confirm page, never a charge from the email', () => {
  const c = lowCreditCopy(notice(), SITE);
  assert.equal(c.subject, 'You have £4.60 of Stayful credit left');
  assert.equal(c.heading, 'You’re nearly out of credit');
  assert.deepEqual(c.lines, [
    'You have £4.60 of credit left. When it runs out, reports, Quick looks and your daily pick pause.',
    'Starter: £19 a month gets you £19 of credit every month, and plan credit goes further than top-ups. Cancel any time.',
    'Or top up £10: credit that never expires.',
  ]);
  assert.deepEqual(c.buttons.map((b) => [b.label, b.url]), [
    ['Start Starter', `${SITE}/account/billing/choose?pick=starter`],
    ['Top up £10', `${SITE}/account/billing/choose?pick=topup`],
  ]);
  assert.equal(choosePath('topup'), '/account/billing/choose?pick=topup');
  const card = lowCreditCopy(notice({ card: { brand: 'visa', last4: '4242' } }), SITE);
  assert.equal(card.lines.at(-1), 'Either goes on your card ending 4242, once you confirm.');
  const noStarter = lowCreditCopy(notice({ starter: null }), SITE);
  assert.deepEqual(noStarter.buttons.map((b) => b.label), ['Top up £10']);
  assert.equal(noStarter.lines[1], 'Top up £10: credit that never expires.');
});

test('a member who can still buy the starter pack is offered the pack instead', () => {
  const c = lowCreditCopy(notice({ kind: 'pack', pack: { body: '£10 gets you £30 of credit: about 7 Full analyses, plus daily deals picked for you. It never expires.', cta: 'Get £30 for £10' } }), SITE);
  assert.equal(c.lines[1], '£10 gets you £30 of credit: about 7 Full analyses, plus daily deals picked for you. It never expires.');
  assert.deepEqual(c.buttons.map((b) => [b.label, b.url]), [['Get £30 for £10', `${SITE}/today?offer=pack`]]);
  assert.ok(!c.lines.join(' ').includes('Starter'));
});

test('it rides at the top of the daily email, and alone it is a capped email with the manage link', () => {
  const card = { id: 'd1', kind: 'sale', town: 'Leeds', postcode_area: 'LS', price_amount: 150000, price_period: 'total', annual_profit: 9000, uplift_pct: 40, bedrooms: 2, property_type: 'flat', live_since: '2026-10-01T00:00:00Z' } as never;
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [card], changes: [], freeCutoffIso: null, unsubscribe: null, lowCredit: lowCreditSection(notice(), SITE) })!;
  assert.equal(built.message.sections[0].key, 'notice');
  assert.ok(renderEmail(built.message).text.indexOf('nearly out of credit') < renderEmail(built.message).text.indexOf('Leeds'));
  // Never an email on its own through buildDaily: with nothing else it stays null.
  assert.equal(buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [], freeCutoffIso: null, unsubscribe: null, lowCredit: lowCreditSection(notice(), SITE) }), null);
  const alone = renderEmail(lowCreditMessage(notice(), SITE, { label: 'Stop these emails', url: `${SITE}/api/notify/unsubscribe/t`, oneClickUrl: `${SITE}/api/notify/unsubscribe/t` }));
  assert.equal(alone.subject, 'You have £4.60 of Stayful credit left');
  assert.ok(alone.text.includes(`Start Starter: ${SITE}/account/billing/choose?pick=starter`));
  assert.ok(alone.headers['List-Unsubscribe']);
  assert.ok(alone.text.includes('Manage notifications') || alone.html.includes('Manage notifications'));
});

test("alone from a debit only once the day's daily emails have gone, so it never takes that morning's deals' slot", () => {
  assert.equal(lowCreditMayGoAlone(new Date('2026-10-05T06:59:00Z')), false);
  assert.equal(lowCreditMayGoAlone(new Date('2026-10-05T07:30:00Z')), false);
  assert.equal(lowCreditMayGoAlone(new Date('2026-10-05T08:29:59Z')), false);
  assert.equal(lowCreditMayGoAlone(new Date('2026-10-05T08:30:00Z')), true);
  assert.equal(lowCreditMayGoAlone(new Date('2026-10-05T23:59:00Z')), true);
  assert.equal(lowCreditMayGoAlone(new Date('2026-10-06T00:10:00Z')), false);
});
