import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeMotivation,
  motivationFromListing,
  motivationFromSnapshot,
  MOTIVATION_SIGNALS,
  motivationLabel,
  isMotivationSignal,
  type MotivationFacts,
  type MotivationSignal,
} from './motivation.ts';
import type { SourcedListing, SourcingKind } from './sourcing.ts';
import type { ListingSnapshot } from './types.ts';

const NOW = new Date('2026-09-24T00:00:00Z');

const facts = (over: Partial<MotivationFacts> = {}): MotivationFacts => ({
  kind: 'sale',
  text: '2 bedroom flat for sale',
  age: null,
  thresholdDays: 150,
  areaMedianDays: null,
  addedOrReduced: null,
  listingUpdate: null,
  reductions: 0,
  backOnMarket: false,
  agentChanged: false,
  yearsRemainingOnLease: null,
  letAvailableDate: null,
  minimumTermInMonths: null,
  hasAgent: null,
  cohorts: [],
  reducedByPct: null,
  now: NOW,
  ...over,
});

const listing = (over: Partial<SourcedListing> = {}): SourcedListing => ({
  source: 'onthemarket', id: '1', canonicalUrl: 'https://www.onthemarket.com/details/1/', kind: 'sale',
  title: '2 bedroom flat for sale', address: null, postcode: null, outcode: null, postcodeArea: null,
  lat: null, lng: null, bedrooms: 2, bathrooms: null, price: { amount: 200_000, period: 'total' },
  rawType: 'Flat', photo: null, features: [],
  ...over,
});

const snapshot = (over: Partial<ListingSnapshot> = {}): ListingSnapshot => ({
  source: 'rightmove', id: '1', canonicalUrl: 'https://www.rightmove.co.uk/properties/1',
  fetchedAt: NOW.toISOString(), parserVersion: 2, kind: 'sale', title: '2 bedroom flat',
  features: [], photos: [], locationConfidence: 'exact',
  ...over,
});

const fired = (f: Partial<MotivationFacts>) => judgeMotivation(facts(f)).fired;

// ── Time on market ──

test('a listing past the threshold is slow, one short of it is not', () => {
  assert.ok(fired({ age: { days: 150, source: 'portal' } }).includes('long_on_market'));
  assert.ok(!fired({ age: { days: 149, source: 'portal' } }).includes('long_on_market'));
});

test('an age from our own sighting counts, but never as firm evidence', () => {
  // We may have started watching months after it went up, so it is a floor.
  const portal = judgeMotivation(facts({ age: { days: 200, source: 'portal' } }));
  const sighting = judgeMotivation(facts({ age: { days: 200, source: 'sighting' } }));
  assert.ok(portal.fired.includes('long_on_market'));
  assert.ok(sighting.fired.includes('long_on_market'));
  assert.equal(portal.score, sighting.score);
  assert.ok(portal.firmScore > 0);
  assert.equal(sighting.firmScore, 0);
});

test('slow for the area needs an area to compare against', () => {
  assert.ok(!fired({ age: { days: 100, source: 'portal' }, areaMedianDays: null }).includes('slower_than_area'));
  assert.ok(fired({ age: { days: 100, source: 'portal' }, areaMedianDays: 60 }).includes('slower_than_area'));
  // 100 days where the area's own median is 90 is an ordinary listing.
  assert.ok(!fired({ age: { days: 100, source: 'portal' }, areaMedianDays: 90 }).includes('slower_than_area'));
});

// ── Price movement ──

test('a reduction is read from the portal, the card or our own record', () => {
  assert.ok(fired({ listingUpdate: { reason: 'reduced', on: '2026-06-03' } }).includes('price_reduced'));
  assert.ok(fired({ addedOrReduced: 'Reduced < 14 days' }).includes('price_reduced'));
  assert.ok(fired({ reductions: 1 }).includes('price_reduced'));
  // "Added" is not a reduction, and neither is a price going up.
  assert.ok(!fired({ addedOrReduced: 'Added > 14 days' }).includes('price_reduced'));
  assert.ok(!fired({ listingUpdate: { reason: 'increased', on: '2026-06-03' } }).includes('price_reduced'));
});

test('repeated cuts are their own signal on top of the first', () => {
  const once = fired({ reductions: 1 });
  const twice = fired({ reductions: 2 });
  assert.ok(!once.includes('reduced_repeatedly'));
  assert.ok(twice.includes('reduced_repeatedly') && twice.includes('price_reduced'));
});

test('a new agent only counts when we knew the old one', () => {
  assert.ok(fired({ agentChanged: true }).includes('relisted_new_agent'));
  // Learning the agent for the first time is not the seller changing it — that
  // is decided by the caller, which is why the fact is a boolean.
  assert.ok(!fired({ agentChanged: false }).includes('relisted_new_agent'));
  const relisted = (previousAgentHash: string | null) =>
    motivationFromListing(listing({ agentHash: 'kEy1.nowAgentDigestAAAAA' }), { thresholdDays: 150, previousAgentHash, now: NOW }).fired.includes(
      'relisted_new_agent',
    );
  assert.equal(relisted(null), false);
  assert.ok(relisted('kEy1.oldAgentDigestAAAAA'));
  // Same agent, same key: nothing has changed.
  assert.equal(relisted('kEy1.nowAgentDigestAAAAA'), false);
  // Different key: the digests cannot be compared, so the signal stays silent
  // rather than firing for every property at once after a key rotation.
  assert.equal(relisted('kEy2.oldAgentDigestAAAAA'), false);
});

test('a page read against the stored agent is what the daily pick actually compares', () => {
  // picks-run.ts scores the fetched page, not the search card, so the snapshot
  // path is the one that has to honour previousAgentHash. It reads the digest
  // off the snapshot and the previous one off the row it is about to overwrite.
  const page = snapshot({ agentHash: 'kEy1.nowAgentDigestAAAAA' });
  const seen = (previousAgentHash: string | null) =>
    motivationFromSnapshot(page, 'sale', { thresholdDays: 150, previousAgentHash, now: NOW }).fired.includes('relisted_new_agent');
  assert.ok(seen('kEy1.oldAgentDigestAAAAA'));
  assert.equal(seen('kEy1.nowAgentDigestAAAAA'), false);
  assert.equal(seen(null), false);
});

// ── Sale wording ──

test('seller wording fires on the real phrases', () => {
  const cases: [string, MotivationSignal][] = [
    ['Chain-free and ready to move into', 'chain_free'],
    ['Offered with no onward chain', 'chain_free'],
    ['Vacant property, available immediately', 'vacant'],
    ['The vendor needs a quick sale', 'urgent_sale'],
    ['Motivated seller, all sensible offers considered', 'urgent_sale'],
    ['Sold as part of a probate estate', 'probate'],
    ['For sale by auction on 3rd October', 'auction'],
    ['Sold via Modern Method of Auction', 'auction'],
    ['Offers over £200,000', 'offers_invited'],
    ['A portfolio of 3 flats sold together', 'portfolio_exit'],
    ['Investment with tenants in situ', 'tenanted'],
  ];
  for (const [text, signal] of cases) {
    assert.ok(fired({ text }).includes(signal), `${signal} should fire on "${text}"`);
  }
});

test('an address is not evidence', () => {
  // picks.ts already learned this: plenty of ordinary homes sit on Auction Close
  // or in The Auction House, and a street name is not a distressed seller.
  for (const text of [
    'The Auction House, Stoney Street, Nottingham, NG1',
    'Flat 6, Auction House, Leeds, LS2',
    '3 bedroom house for sale in Auction Close, Kettering, NN16',
  ]) {
    assert.ok(!fired({ text }).includes('auction'), text);
  }
  for (const text of [
    '3 bedroom house for sale in Probate Lane, York, YO1',
    'Flat 2, Executors Court, Bristol, BS1',
  ]) {
    assert.ok(!fired({ text }).includes('probate'), text);
  }
  // The word still counts when it is describing the sale rather than the street.
  assert.ok(fired({ text: 'Sold as part of a probate estate' }).includes('probate'));
  assert.ok(fired({ text: 'Probate granted, vacant possession' }).includes('probate'));
});

test('a short lease is only short when it is stated and short', () => {
  assert.ok(fired({ yearsRemainingOnLease: 62 }).includes('short_lease'));
  assert.ok(!fired({ yearsRemainingOnLease: 120 }).includes('short_lease'));
  // Rightmove writes 0 for "not stated", which is not a lease about to expire.
  assert.ok(!fired({ yearsRemainingOnLease: 0 }).includes('short_lease'));
  assert.ok(!fired({ yearsRemainingOnLease: null }).includes('short_lease'));
});

// ── Landlord wording ──

const rentFired = (f: Partial<MotivationFacts>) => fired({ kind: 'rent', ...f });

test('a let date already past is a void running now', () => {
  assert.ok(rentFired({ letAvailableDate: '2026-08-01' }).includes('void_now'));
  assert.ok(rentFired({ letAvailableDate: '2026-09-24' }).includes('void_now'));
  // Available next month is a landlord giving notice, not one losing money.
  assert.ok(!rentFired({ letAvailableDate: '2026-10-30' }).includes('void_now'));
});

test('a short minimum term is the landlord already bending', () => {
  assert.ok(rentFired({ minimumTermInMonths: 1 }).includes('short_min_term'));
  assert.ok(rentFired({ minimumTermInMonths: 3 }).includes('short_min_term'));
  assert.ok(!rentFired({ minimumTermInMonths: 12 }).includes('short_min_term'));
  assert.ok(!rentFired({ minimumTermInMonths: 0 }).includes('short_min_term'));
});

test('landlord wording fires on the real phrases', () => {
  const cases: [string, MotivationSignal][] = [
    ['Company lets considered', 'company_let'],
    ['Suitable for a corporate let', 'company_let'],
    ['Landlord is flexible on term', 'flexible_terms'],
    ['All enquiries considered', 'flexible_terms'],
    ['Two weeks rent-free period offered', 'incentive'],
    ['No deposit option available', 'incentive'],
    ['Advertised by a private landlord', 'private_landlord'],
  ];
  for (const [text, signal] of cases) {
    assert.ok(rentFired({ text }).includes(signal), `${signal} should fire on "${text}"`);
  }
  // A listing naming no agent is a landlord advertising directly.
  assert.ok(rentFired({ hasAgent: false }).includes('private_landlord'));
  assert.ok(!rentFired({ hasAgent: true }).includes('private_landlord'));
  assert.ok(!rentFired({ hasAgent: null }).includes('private_landlord'));
});

// ── The two vocabularies stay apart ──

test('a seller signal never fires on a rental, or the reverse', () => {
  assert.ok(!rentFired({ text: 'Chain-free with no onward chain' }).includes('chain_free'));
  assert.ok(!rentFired({ yearsRemainingOnLease: 50 }).includes('short_lease'));
  assert.ok(!fired({ text: 'Company lets considered' }).includes('company_let'));
  assert.ok(!fired({ letAvailableDate: '2026-01-01' }).includes('void_now'));
  assert.ok(!fired({ minimumTermInMonths: 1 }).includes('short_min_term'));
});

// ── Scoring ──

test('score and firmScore are bounded and firm is a subset', () => {
  const everything = judgeMotivation(facts({
    age: { days: 400, source: 'portal' },
    areaMedianDays: 40,
    reductions: 3,
    backOnMarket: true,
    agentChanged: true,
    yearsRemainingOnLease: 55,
    text: 'Chain-free probate sale, vendor needs a quick sale, offers invited, for sale by auction',
  }));
  assert.equal(everything.score, 100);
  assert.ok(everything.firmScore <= everything.score);
  assert.ok(everything.firmScore > 0);
});

test('wording alone scores but proves nothing', () => {
  // The hard filter leans on firmScore precisely so marketing copy cannot
  // qualify a listing on its own.
  const m = judgeMotivation(facts({ text: 'Chain-free, motivated seller, offers invited' }));
  assert.ok(m.score > 0);
  assert.equal(m.firmScore, 0);
});

test('nothing to go on is a zero, not a guess', () => {
  const m = judgeMotivation(facts());
  assert.deepEqual(m, { score: 0, firmScore: 0, fired: [] });
});

test('the strongest reason is reported first', () => {
  const m = judgeMotivation(facts({ text: 'Chain-free, vendor needs a quick sale' }));
  assert.deepEqual(m.fired, ['urgent_sale', 'chain_free']);
  assert.ok(MOTIVATION_SIGNALS.urgent_sale.weight > MOTIVATION_SIGNALS.chain_free.weight);
});

// ── Entry points ──

test('a search card is judged on what the card carries', () => {
  const m = motivationFromListing(
    listing({ features: ['Chain-free', 'No Chain'], priceQualifier: 'Offers over', addedOrReduced: 'Reduced > 14 days', listedDate: '2026-01-01' }),
    { thresholdDays: 150, now: NOW },
  );
  assert.ok(m.fired.includes('chain_free'));
  assert.ok(m.fired.includes('offers_invited'));
  assert.ok(m.fired.includes('price_reduced'));
  assert.ok(m.fired.includes('long_on_market'));
});

test('the page adds what the card cannot know', () => {
  const m = motivationFromSnapshot(
    snapshot({ kind: 'rent', letAvailableDate: '2026-07-01', minimumTermInMonths: 1, listingUpdate: { reason: 'reduced', on: '2026-08-02' } }),
    'rent',
    { thresholdDays: 56, now: NOW },
  );
  assert.ok(m.fired.includes('void_now'));
  assert.ok(m.fired.includes('short_min_term'));
  assert.ok(m.fired.includes('price_reduced'));
});

test('every signal has a label and is recognised', () => {
  for (const key of Object.keys(MOTIVATION_SIGNALS) as MotivationSignal[]) {
    assert.ok(isMotivationSignal(key));
    assert.ok(motivationLabel(key).length > 0);
  }
  assert.ok(!isMotivationSignal('not_a_signal'));
});

test('an unknown kind fires nothing rather than everything', () => {
  const m = judgeMotivation(facts({ kind: 'str' as unknown as SourcingKind, text: 'Chain-free quick sale', age: { days: 900, source: 'portal' } }));
  assert.deepEqual(m.fired, []);
});

// ── The bar for "only" ──

import { meetsMotivationBar, MOTIVATION_MIN_FIRM } from './motivation.ts';

const bar = (over: Partial<Parameters<typeof meetsMotivationBar>[1]> = {}) =>
  ({ mode: 'only' as const, areaRelative: false, areaMedianKnown: false, ...over });

test('off and prefer never exclude anything', () => {
  const nothing = judgeMotivation(facts());
  assert.ok(meetsMotivationBar(nothing, bar({ mode: 'off' })));
  assert.ok(meetsMotivationBar(nothing, bar({ mode: 'prefer' })));
});

test('only needs firm evidence, never wording alone', () => {
  const wordingOnly = judgeMotivation(facts({ text: 'Chain-free, motivated seller, offers invited, probate sale' }));
  assert.ok(wordingOnly.score >= MOTIVATION_MIN_FIRM);
  assert.equal(wordingOnly.firmScore, 0);
  assert.ok(!meetsMotivationBar(wordingOnly, bar()));

  const dated = judgeMotivation(facts({ age: { days: 200, source: 'portal' } }));
  assert.ok(meetsMotivationBar(dated, bar()));
});

test('an age we inferred ourselves is not firm evidence for only', () => {
  // We may have started watching late, so this must not satisfy a hard filter.
  const sighting = judgeMotivation(facts({ age: { days: 200, source: 'sighting' } }));
  assert.ok(!meetsMotivationBar(sighting, bar()));
});

test('slow for the area is required only when the area is knowable', () => {
  const slow = judgeMotivation(facts({ age: { days: 200, source: 'portal' }, areaMedianDays: 180 }));
  assert.ok(!slow.fired.includes('slower_than_area'));
  // Asked for area-relative and we have an area to compare: it has to clear it.
  assert.ok(!meetsMotivationBar(slow, bar({ areaRelative: true, areaMedianKnown: true })));
  // Same listing, but the area was too thin to have a median. Skipping the test
  // beats returning nothing and looking broken.
  assert.ok(meetsMotivationBar(slow, bar({ areaRelative: true, areaMedianKnown: false })));

  const reallySlow = judgeMotivation(facts({ age: { days: 200, source: 'portal' }, areaMedianDays: 60 }));
  assert.ok(meetsMotivationBar(reallySlow, bar({ areaRelative: true, areaMedianKnown: true })));
});

// ── Reading a stored verdict back ──

import { parseMotivation } from './motivation.ts';

test('a stored verdict survives the round trip', () => {
  const m = judgeMotivation(facts({ age: { days: 200, source: 'portal' }, text: 'Chain-free' }));
  assert.deepEqual(parseMotivation(JSON.parse(JSON.stringify(m))), m);
});

test('a verdict with nothing in it is not shown at all', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { fired: [] }, { fired: ['not_a_signal'] }]) {
    assert.equal(parseMotivation(bad), null, JSON.stringify(bad));
  }
});

test('signals we no longer recognise are dropped, not rendered raw', () => {
  const m = parseMotivation({ score: 50, firmScore: 30, fired: ['long_on_market', 'retired_signal'] })!;
  assert.deepEqual(m.fired, ['long_on_market']);
  // A score out of range cannot leak into the UI either.
  assert.equal(parseMotivation({ score: 9999, firmScore: -5, fired: ['chain_free'] })!.score, 100);
  assert.equal(parseMotivation({ score: 9999, firmScore: -5, fired: ['chain_free'] })!.firmScore, 0);
});

// ── What the cohort feed adds ──

test('a measured cohort is firm evidence, unlike the same claim in wording', () => {
  // "Repossessed" in an advert is the agent talking; in the feed it is a
  // provider stating a fact, so it can carry a hard filter on its own.
  const fromFeed = judgeMotivation(facts({ cohorts: ['repossessed'] }));
  assert.ok(fromFeed.fired.includes('repossessed'));
  assert.ok(fromFeed.firmScore > 0);

  const fromWording = judgeMotivation(facts({ text: 'Repossessed property, priced to sell' }));
  assert.equal(fromWording.firmScore, 0);
});

test('the feed answers the things we could otherwise only infer', () => {
  const m = judgeMotivation(facts({ cohorts: ['price_reduced', 'back_on_market', 'quick_sale'] }));
  assert.ok(m.fired.includes('price_reduced'));
  assert.ok(m.fired.includes('back_on_market'));
  assert.ok(m.fired.includes('needs_quick_sale'));
});

test('a deep cut is read as more than one reduction', () => {
  // Their price-reduced list starts at 15% off the first asking price, so past
  // double that the seller has plainly chased the market down more than once.
  assert.ok(!judgeMotivation(facts({ cohorts: ['price_reduced'], reducedByPct: 18 })).fired.includes('reduced_repeatedly'));
  assert.ok(judgeMotivation(facts({ cohorts: ['price_reduced'], reducedByPct: 34 })).fired.includes('reduced_repeatedly'));
});

test('a cohort claim still respects which kind it applies to', () => {
  const rent = judgeMotivation(facts({ kind: 'rent', cohorts: ['repossessed', 'chain_free', 'tenanted'] }));
  assert.deepEqual(rent.fired, []);
});

test('a measured months-on-market beats anything we inferred', () => {
  const member = {
    uprn: '1', postcode: 'OX3 9DW', address: '12 High St', url: null, price: null, bedrooms: null,
    propertyType: null, cohorts: ['slow_to_sell' as const], monthsOnMarket: 14, reducedByPct: null, yearsRemaining: null,
  };
  // We first saw it three days ago; the feed says fourteen months. Ours is a
  // floor and theirs is a measurement, so theirs wins and counts as firm.
  const m = motivationFromListing(listing({}), { thresholdDays: 150, firstSeenAt: '2026-09-21T00:00:00Z', cohort: member, now: NOW });
  assert.ok(m.fired.includes('long_on_market'));
  assert.ok(m.firmScore > 0);
});
