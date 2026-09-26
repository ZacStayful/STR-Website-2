import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNextStepView, NEXT_MOVE, type ViewInput } from './view.ts';
import { computeOfferRange } from './offer-range.ts';
import { NO_OFFER_RULES, parseOfferRules } from './offer-rules.ts';
import { OFFER_SLOT, withOfferAmount } from './offer-amount.ts';
import { NEXT_STEPS } from './next-steps.ts';
import { factsFromCard, factsFromTracked } from './slot-facts.ts';
import type { DealFacts } from './facts.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const saleFacts: DealFacts = {
  kind: 'sale',
  address: '12 High Street, Leeds',
  town: 'Leeds',
  bedrooms: 2,
  price: { amount: 186000, period: 'total' },
  listedDate: daysAgo(213),
  firstSeenAt: daysAgo(40),
  priceHistory: [],
  motivation: { score: 40, firmScore: 40, fired: ['reduced_repeatedly'] },
  dealStatus: 'live',
  retiredReason: null,
  lastConfirmedAt: daysAgo(1),
  postcodeArea: 'LS',
  marketplace: true,
};
const rentFacts: DealFacts = { ...saleFacts, kind: 'rent', price: { amount: 1100, period: 'pcm' }, listedDate: daysAgo(35), motivation: null };

const input = (over: Partial<ViewInput> = {}): ViewInput => ({
  itemKey: 'd-00000000-0000-0000-0000-000000000001',
  stage: 'watching',
  facts: saleFacts,
  memberName: 'Zac Smith',
  memberEmail: 'zac@example.com',
  ticks: new Set(),
  offer: null,
  finance: { targetYieldPct: 10, targetMarginPcm: 500 },
  now: NOW,
  ...over,
});

test('Kept: contact the agent, with the enquiry filled in, then Contacted', () => {
  const v = buildNextStepView(input())!;
  assert.equal(v.heading, NEXT_STEPS.stages.kept.purchase.heading);
  assert.match(v.message!.body, /12 High Street, Leeds/);
  assert.match(v.message!.body, /listed at £186,000/);
  assert.match(v.message!.body, /Zac Smith$/);
  assert.equal(v.message!.withAmount, null);
  assert.deepEqual(v.move, { label: NEXT_STEPS.moveButtons.kept, to: 'contacted' });
  assert.equal(v.checklist, null);
  assert.equal(v.offer, null);
});

test('rent-to-rent gets rent-to-rent content, purchase gets purchase content', () => {
  const r = buildNextStepView(input({ facts: rentFacts }))!;
  assert.equal(r.kind, 'rent-to-rent');
  assert.match(r.message!.body, /serviced accommodation/);
  assert.match(r.message!.body, /£1,100 a month/);
  assert.doesNotMatch(r.message!.body, /leasehold/);
  const p = buildNextStepView(input())!;
  assert.doesNotMatch(p.message!.body, /serviced accommodation|company let/i);
});

test('the moves: each stage to the next, Secured to nothing, Passed back to Kept', () => {
  assert.deepEqual(NEXT_MOVE, { watching: 'contacted', contacted: 'viewing', viewing: 'offer', offer: 'secured', secured: null, passed: 'watching' });
  for (const stage of ['contacted', 'viewing', 'offer'] as const) assert.equal(buildNextStepView(input({ stage }))!.move?.to, NEXT_MOVE[stage]);
  assert.equal(buildNextStepView(input({ stage: 'secured' }))!.move, null);
});

test('Passed shows only the move back to Kept', () => {
  const v = buildNextStepView(input({ stage: 'passed' }))!;
  assert.equal(v.heading, null);
  assert.equal(v.message, null);
  assert.equal(v.checklist, null);
  assert.equal(v.offer, null);
  assert.equal(v.manage, null);
  assert.deepEqual(v.move, { label: NEXT_STEPS.moveButtons.passed, to: 'watching' });
});

test('Viewing: the checklist with saved ticks; rent-to-rent asks for written consent', () => {
  const v = buildNextStepView(input({ stage: 'viewing', ticks: new Set(['parking', 'not-an-item']) }))!;
  assert.equal(v.message, null);
  assert.equal(v.checklist!.find((i) => i.id === 'parking')!.ticked, true);
  assert.equal(v.checklist!.find((i) => i.id === 'access')!.ticked, false);
  assert.ok(!v.checklist!.some((i) => i.id === 'not-an-item'));
  const r = buildNextStepView(input({ stage: 'viewing', facts: rentFacts }))!;
  assert.ok(r.checklist!.some((i) => i.id === 'written-consent'));
});

test('checklist ids never repeat between Viewing and Secured (ticks are saved per deal)', () => {
  for (const kind of ['purchase', 'rentToRent'] as const) {
    const viewing = NEXT_STEPS.stages.viewing[kind].checklist!.map((i) => i.id);
    const secured = NEXT_STEPS.stages.secured[kind].checklist!.map((i) => i.id);
    assert.deepEqual(viewing.filter((id) => secured.includes(id)), [], kind);
  }
});

test('Offer: the range, the working line, the label, and the message with and without an amount', () => {
  const rules = parseOfferRules({ purchase: [{ minMonths: 6, minReductions: 2, discountPct: 8 }] });
  const offer = computeOfferRange({ kind: 'purchase', marketplace: true, asking: 186000, target: 182000, ageDays: 213, reductions: 2, rules });
  const v = buildNextStepView(input({ stage: 'offer', offer }))!;
  assert.equal(v.offer!.figure, '£171,000 to £182,000');
  assert.equal(v.offer!.working, "Hits your 10% target up to £182,000 · on the market 6 months and reduced twice, so we'd open at £171,000");
  assert.equal(v.offer!.disclaimer, NEXT_STEPS.offer.disclaimer);
  assert.equal(v.offer!.initialAmount, 171000);
  assert.match(v.offer!.notes[0], /10% target gross yield/);
  assert.ok(v.offer!.goalsLink);
  assert.ok(v.message!.withAmount!.body.includes(OFFER_SLOT));
  assert.doesNotMatch(v.message!.body, /@@|\{|\[/);
  const typed = withOfferAmount({ withAmount: v.message!.withAmount!.body, without: v.message!.body }, 175000);
  assert.match(typed, /an offer of £175,000 on the property at 12 High Street, Leeds\./);
  assert.match(withOfferAmount({ withAmount: v.message!.withAmount!.body, without: v.message!.body }, null), /make an offer on the property at 12 High Street, Leeds\./);
});

test('Offer at launch (no bands): the target figure only, and no empty note', () => {
  const offer = computeOfferRange({ kind: 'purchase', marketplace: true, asking: 186000, target: 182000, ageDays: 213, reductions: 2, rules: NO_OFFER_RULES });
  const v = buildNextStepView(input({ stage: 'offer', offer }))!;
  assert.equal(v.offer!.figure, 'Up to £182,000');
  assert.equal(v.offer!.working, 'Hits your 10% target up to £182,000');
  assert.ok(v.offer!.notes.every((n) => n.trim() !== ''));
});

test('Offer with no figure: the reason, no label, nothing to pre-fill', () => {
  const offer = computeOfferRange({ kind: 'rent-to-rent', marketplace: true, asking: 1100, target: 0, ageDays: 35, reductions: 0, rules: NO_OFFER_RULES });
  const v = buildNextStepView(input({ stage: 'offer', facts: rentFacts, offer }))!;
  assert.equal(v.offer!.figure, null);
  assert.equal(v.offer!.disclaimer, null);
  assert.equal(v.offer!.initialAmount, null);
  assert.deepEqual(v.offer!.notes, ["At your £500 target monthly margin, this doesn't work at any rent, so we haven't suggested an offer."]);
  const far = computeOfferRange({ kind: 'purchase', marketplace: true, asking: 186000, target: 100000, ageDays: 213, reductions: 0, rules: NO_OFFER_RULES });
  const f = buildNextStepView(input({ stage: 'offer', offer: far }))!;
  assert.match(f.offer!.notes[0], /no more than £100,000/);
});

test('a stale asking figure adds a check-it note at the Offer stage', () => {
  const facts = { ...saleFacts, lastConfirmedAt: daysAgo(12) };
  const offer = computeOfferRange({ kind: 'purchase', marketplace: true, asking: 186000, target: 182000, ageDays: 213, reductions: 0, rules: NO_OFFER_RULES });
  const v = buildNextStepView(input({ stage: 'offer', facts, offer }))!;
  assert.ok(v.offer!.notes.includes(NEXT_STEPS.offer.staleAsking));
});

test('off the market: a warning before an offer, none at Offer or Secured', () => {
  const facts: DealFacts = { ...saleFacts, dealStatus: 'retired', retiredReason: 'under_offer' };
  assert.equal(buildNextStepView(input({ facts }))!.warning, NEXT_STEPS.offMarket.under_offer);
  assert.equal(buildNextStepView(input({ facts, stage: 'viewing' }))!.warning, NEXT_STEPS.offMarket.under_offer);
  assert.equal(buildNextStepView(input({ facts, stage: 'offer' }))!.warning, null);
  assert.equal(buildNextStepView(input({ facts: { ...facts, retiredReason: 'stale_listed' } }))!.warning, null);
});

test('Secured: the checklist, the Talk to us line with the area, no move', () => {
  const v = buildNextStepView(input({ stage: 'secured' }))!;
  assert.ok(v.checklist!.length > 0);
  assert.equal(v.manage!.area, 'LS');
  assert.equal(v.manage!.name, 'Zac Smith');
  assert.equal(v.manage!.email, 'zac@example.com');
  assert.match(v.manage!.message, /2-bedroom property at 12 High Street, Leeds/);
  assert.equal(buildNextStepView(input({ stage: 'secured', facts: { ...saleFacts, postcodeArea: null } }))!.manage, null);
});

test('a kind with no content shows nothing', () => {
  assert.equal(buildNextStepView(input({ facts: { ...saleFacts, kind: 'str' } })), null);
});

test('missing facts drop out cleanly: no blanks, no placeholders', () => {
  const bare: DealFacts = { ...saleFacts, address: null, town: null, bedrooms: null, price: null, listedDate: null, firstSeenAt: null };
  for (const stage of ['watching', 'contacted', 'offer'] as const) {
    const v = buildNextStepView(input({ facts: bare, stage, memberName: null }))!;
    for (const text of [v.message!.subject, v.message!.body]) assert.doesNotMatch(text, /[{}[\]]|undefined|null|NaN| {2}/);
  }
});

test('slot facts never carry the address of an unopened deal', () => {
  const card = { kind: 'sale', town: 'Leeds', bedrooms: 2, price_amount: '186000', price_period: 'total', listed_date: null, first_seen_at: daysAgo(3), status: 'live' as const, postcode_area: 'LS' };
  assert.equal(factsFromCard(card, false, '12 High Street').address, null);
  assert.equal(factsFromCard(card, true, '12 High Street').address, '12 High Street');
  assert.deepEqual(factsFromCard(card, true, null).price, { amount: 186000, period: 'total' });
  const item = { kind: 'sale' as const, opened: false, price: null, area: 'LS', listing: { title: 't', address: '12 High Street', photo: null, bedrooms: 2, source: 'rightmove' as const } };
  assert.equal(factsFromTracked(item, card, '12 High Street').address, null);
  assert.equal(factsFromTracked({ ...item, opened: true }, null, null).address, '12 High Street');
  assert.equal(factsFromTracked({ ...item, opened: true }, null, null).marketplace, false);
});
