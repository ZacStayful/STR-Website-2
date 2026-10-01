import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisOffer, maxSafeDiscountPct, offerLabel, pmiAddonOffer, welcomeApplies, type OfferMember } from './offers.ts';

const settings = { revealAnalysisDiscountPct: 50, revealWelcomeDays: 7, deepFirstRunExtraPence: 100 };
const list = { fullPence: 500, pmiPence: 200 };
const floors = { fullRawPence: 217, deepRawPence: 292, pmiRawPence: 75 };
const now = new Date('2026-10-05T12:00:00Z');
const member: OfferMember = { offerDealIds: ['d1', 'd2', 'd3'], revealViewedAt: '2026-10-01T09:00:00Z', paysForSelf: true, hadDeepReport: false, usedWelcomeOn: [] };
const offer = (o: Partial<Parameters<typeof analysisOffer>[0]> = {}) => analysisOffer({ dealId: 'd1', withPmi: false, list, member, settings, floors, now, ...o });

test('welcome: half price on a revealed deal inside the week', () => {
  const p = offer();
  assert.equal(p.offer, 'welcome');
  assert.equal(p.fullPence, 250);
  assert.equal(p.listTotalPence, 500);
});

test('welcome only on revealed deals, inside the window, for members paying for themselves, once a deal', () => {
  assert.equal(offer({ dealId: 'other' }).offer, null);
  assert.equal(offer({ now: new Date('2026-10-08T09:00:01Z') }).offer, null);
  assert.equal(offer({ member: { ...member, paysForSelf: false } }).offer, null);
  assert.equal(offer({ member: { ...member, usedWelcomeOn: ['d1'] } }).offer, null);
  assert.equal(offer({ member: { ...member, revealViewedAt: null } }).offer, null);
  assert.equal(offer({ member: null }).offer, null);
  assert.equal(welcomeApplies('d1', member, { ...settings, revealAnalysisDiscountPct: 0 }, now), false);
});

test('welcome deep report: (full + PMI) at half, and it is the first deep report', () => {
  const p = offer({ withPmi: true });
  assert.equal(p.offer, 'welcome_deep');
  assert.equal(p.fullPence + p.pmiPence, 350);
  assert.equal(p.firstDeep, true);
});

test('first deep report: full + £1, once per paying account', () => {
  const p = offer({ dealId: 'other', withPmi: true });
  assert.equal(p.offer, 'first_deep');
  assert.equal(p.fullPence + p.pmiPence, 600);
  assert.equal(p.firstDeep, true);
  assert.equal(offer({ dealId: 'other', withPmi: true, member: { ...member, hadDeepReport: true } }).offer, null);
});

test('never below the worst-case raw cost', () => {
  const p = offer({ settings: { ...settings, revealAnalysisDiscountPct: 80 } });
  assert.equal(p.fullPence, 217);
  const d = offer({ withPmi: true, settings: { ...settings, revealAnalysisDiscountPct: 80 } });
  assert.equal(d.fullPence + d.pmiPence, 292);
  // A floor at or above the list price drops the offer.
  assert.equal(offer({ floors: { ...floors, fullRawPence: 600 } }).offer, null);
});

test('PMI added later: + £1 the first time, never welcome-priced', () => {
  assert.deepEqual(pmiAddonOffer({ listPmiPence: 200, hadDeepReport: false, settings, floors }), { pmiPence: 100, offer: 'first_pmi', firstDeep: true });
  assert.deepEqual(pmiAddonOffer({ listPmiPence: 200, hadDeepReport: true, settings, floors }), { pmiPence: 200, offer: null, firstDeep: false });
  assert.equal(pmiAddonOffer({ listPmiPence: 200, hadDeepReport: false, settings, floors: { pmiRawPence: 150 } }).pmiPence, 150);
});

test('labels and the admin limit', () => {
  assert.equal(offerLabel('welcome'), 'welcome price');
  assert.equal(offerLabel('first_deep'), 'first-time price');
  assert.equal(offerLabel(null), null);
  assert.equal(maxSafeDiscountPct(list, floors), 56);
});
