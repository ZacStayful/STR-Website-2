import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealReactionToFeedback, isDealReaction, mergeFeedback, nextReaction, reactionFilter, PASS_REASON_GROUPS, type DealFeedbackFacts, type FeedbackEntry } from './reactions.ts';
import { feedbackRules, applyCandidateFeedback, PICK_REASONS, REASON_GROUPS, type PickFeedback } from '../listing/picks.ts';
import type { SourcedListing } from '../listing/sourcing.ts';

const UID = '11111111-1111-4111-8111-111111111111';

const facts = (over: Partial<DealFeedbackFacts> = {}): DealFeedbackFacts => ({
  kind: 'sale',
  postcode_area: 'YO',
  outcode: 'YO24',
  bedrooms: 3,
  price_amount: '250000',
  price_period: 'total',
  raw_type: 'Terraced',
  screening: { band: 'qualified', kind: 'purchase', upliftPct: 45, surplus: 9000 },
  ...over,
});

const pick = (reaction: 'yes' | 'no', reasons: PickFeedback['reasons'], over: Partial<PickFeedback> = {}): PickFeedback => ({
  reaction,
  reactionSource: 'form',
  reasons,
  kind: 'sale',
  postcodeArea: 'YO',
  bedrooms: 3,
  amount: 250_000,
  rawType: 'Terraced',
  outcode: 'YO24',
  ...over,
});

test('a tap on the active button clears it, a tap on the other switches', () => {
  assert.equal(nextReaction(null, 'keep'), 'keep');
  assert.equal(nextReaction('keep', 'keep'), null);
  assert.equal(nextReaction('keep', 'pass'), 'pass');
  assert.equal(nextReaction('pass', 'pass'), null);
  assert.equal(nextReaction('pass', 'keep'), 'keep');
  assert.ok(isDealReaction('keep') && isDealReaction('pass'));
  assert.ok(!isDealReaction('toggle') && !isDealReaction(null) && !isDealReaction(''));
});

test('every view filter is scoped to the member, and there is none without one', () => {
  assert.equal(reactionFilter('all', null), null);
  assert.equal(reactionFilter('kept', ''), null);
  for (const view of ['all', 'kept', 'passed'] as const) {
    const f = reactionFilter(view, UID)!;
    assert.deepEqual(f.eq[0], ['deal_reactions.user_id', UID], `${view} filters on the member first`);
    assert.ok(f.embed.endsWith('()'), `${view} embeds nothing it returns`);
  }
  assert.deepEqual(reactionFilter('all', UID), { embed: 'deal_reactions()', eq: [['deal_reactions.user_id', UID], ['deal_reactions.reaction', 'pass']], absent: true });
  assert.deepEqual(reactionFilter('kept', UID)!.eq[1], ['deal_reactions.reaction', 'keep']);
  assert.equal(reactionFilter('kept', UID)!.absent, false);
  assert.deepEqual(reactionFilter('passed', UID)!.eq[1], ['deal_reactions.reaction', 'pass']);
  assert.ok(reactionFilter('passed', UID)!.embed.startsWith('deal_reactions!inner'));
});

test('the pass picker offers exactly the existing pick reasons, grouped the same way', () => {
  assert.deepEqual(PASS_REASON_GROUPS.map((g) => g.key), REASON_GROUPS.map((g) => g.key));
  const offered = PASS_REASON_GROUPS.flatMap((g) => g.reasons.map((r) => r.key));
  assert.deepEqual([...offered].sort(), PICK_REASONS.map((r) => r.key).sort());
});

test('a pass becomes the same feedback a "no" on a pick would', () => {
  const fb = dealReactionToFeedback({ reaction: 'pass', reasons: ['too_expensive', 'not_a_reason', 'too_expensive'] }, facts());
  assert.deepEqual(fb, { reaction: 'no', reactionSource: 'form', reasons: ['too_expensive'], kind: 'sale', postcodeArea: 'YO', bedrooms: 3, amount: 250_000, rawType: 'Terraced', outcode: 'YO24', screeningScore: 45 });
  // And it trains the picks: a cap 10% under this price, exactly as a pick answer does.
  assert.equal(feedbackRules([fb]).cap.sale, 225_000);
  const rent = dealReactionToFeedback({ reaction: 'pass', reasons: ['too_expensive'] }, facts({ kind: 'rent', price_amount: 1200, price_period: 'pcm', screening: { band: 'qualified', kind: 'rent-to-rent', annualProfit: 11000 } }));
  assert.equal(rent.amount, 1200);
  assert.equal(rent.screeningScore, 11000);
  assert.equal(feedbackRules([rent]).cap.rent, 1080);
});

test('a keep is a yes with no reasons, and missing facts stay missing', () => {
  const keep = dealReactionToFeedback({ reaction: 'keep', reasons: ['too_expensive'] }, facts());
  assert.equal(keep.reaction, 'yes');
  assert.deepEqual(keep.reasons, []);
  const bare = dealReactionToFeedback({ reaction: 'pass', reasons: null }, facts({ kind: 'weird', price_amount: null, price_period: null, bedrooms: null, raw_type: null, outcode: null, postcode_area: null, screening: null }));
  assert.equal(bare.kind, null);
  assert.equal(bare.amount, null);
  assert.equal(bare.screeningScore, null);
  assert.deepEqual(bare.reasons, []);
  // A pass with no reasons changes no rule: it only hides that one deal.
  const rules = feedbackRules([bare]);
  assert.equal(rules.inert.length + rules.cancelled.length, 0);
  assert.deepEqual(rules.cap, {});
  // A price in the wrong units is not used as one.
  assert.equal(dealReactionToFeedback({ reaction: 'pass', reasons: [] }, facts({ price_period: 'pcm' })).amount, null);
});

test('one answer per listing, the latest wins, and nothing is double counted', () => {
  const url = 'https://www.rightmove.co.uk/properties/1';
  const pickNo: FeedbackEntry = { url, at: '2026-09-20T10:00:00Z', feedback: pick('no', ['too_expensive']) };
  const gridKeep: FeedbackEntry = { url, at: '2026-09-25T10:00:00Z', feedback: pick('yes', []) };
  // A later Keep overrides an earlier pick "no": the member changed their mind.
  assert.deepEqual(mergeFeedback([pickNo], [gridKeep]), [gridKeep.feedback]);
  // A later pick answer overrides an earlier grid pass.
  const gridPass: FeedbackEntry = { url, at: '2026-09-18T10:00:00Z', feedback: pick('no', ['wrong_area']) };
  assert.deepEqual(mergeFeedback([pickNo], [gridPass]), [pickNo.feedback]);
  // Picked and passed on the same listing: one entry, not two.
  const merged = mergeFeedback([pickNo], [{ ...gridPass, at: '2026-09-22T10:00:00Z' }]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].reasons, ['wrong_area']);
  // A tie goes to the grid; an unknown time loses to a known one.
  assert.deepEqual(mergeFeedback([{ ...pickNo, at: gridPass.at }], [gridPass]), [gridPass.feedback]);
  assert.deepEqual(mergeFeedback([{ ...pickNo, at: null }], [gridPass]), [gridPass.feedback]);
  // Different listings are all kept, in first-seen order.
  const other: FeedbackEntry = { url: `${url}-2`, at: '2026-09-01T00:00:00Z', feedback: pick('no', ['no_flats']) };
  assert.deepEqual(mergeFeedback([pickNo, other], [gridKeep]), [gridKeep.feedback, other.feedback]);
  assert.deepEqual(mergeFeedback([], []), []);
});

test('a merged pass actually changes which candidates survive', () => {
  const listing = (price: number): { listing: SourcedListing } => ({ listing: { source: 'rightmove', id: String(price), canonicalUrl: `u${price}`, kind: 'sale', title: 'x', address: null, postcode: null, outcode: 'YO1', postcodeArea: 'YO', lat: null, lng: null, bedrooms: 3, bathrooms: null, price: { amount: price, period: 'total' }, rawType: 'Terraced', photo: null } });
  const feedback = mergeFeedback([], [{ url: 'deal', at: '2026-09-25T00:00:00Z', feedback: dealReactionToFeedback({ reaction: 'pass', reasons: ['too_expensive'] }, facts()) }]);
  const kept = applyCandidateFeedback([listing(200_000), listing(240_000)], feedback);
  assert.deepEqual(kept.map((c) => c.listing.price!.amount), [200_000]);
});
