import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseQueries, topScoredAreas, applyQueryFeedback, applyCandidateFeedback, confirmedNegatives, cleanReasons, isPickToken, newPickToken, startOfTodayUtc, pickEmail, pickLinks, unsubscribeHeaders, summarisePicks, pickPrice, spreadPick, PER_LISTING_CAP, dealScoreOf, reasonLabel, reasonEffect, feedbackRules, ruleApplied, type HouseAreaCard, type PickFeedback, type PickRow, describeMotivation } from './picks.ts';
import { queriesForGoals, rentPcm, withinQueryPrice, type SourcedListing, type SourcedPick, type AreaRef, type SourcingQuery } from './sourcing.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { purchaseDeal } from './deal.ts';
import { screenPurchase } from './screen.ts';
import { seedTable } from '../credit/costs.ts';

const cards: HouseAreaCard[] = [
  { code: 'NG', name: 'Nottingham', slug: 'nottingham', score: { score: 72 }, confidence: { tier: 'confirmed' } },
  { code: 'M', name: 'Manchester', slug: 'manchester', score: { score: 81 }, confidence: { tier: 'building' } },
  { code: 'AB', name: 'Aberdeen', slug: 'aberdeen', score: { score: 95 }, confidence: { tier: 'early' } },
  { code: 'ZZ', name: 'Nowhere', slug: 'zz', score: null, confidence: { tier: 'confirmed' } },
  { code: 'LS', name: 'Leeds', slug: 'leeds', score: { score: 60 }, confidence: { tier: 'confirmed' } },
];

const listing = (over: Partial<SourcedListing> = {}): SourcedListing => ({
  source: 'onthemarket',
  id: '1',
  canonicalUrl: 'https://www.onthemarket.com/details/1/',
  kind: 'sale',
  title: '2 bed terraced house',
  address: '1 High Street, Nottingham NG1 1AA',
  postcode: 'NG1 1AA',
  outcode: 'NG1',
  postcodeArea: 'NG',
  lat: null,
  lng: null,
  bedrooms: 2,
  bathrooms: 1,
  price: { amount: 180_000, period: 'total' },
  rawType: 'Terraced house',
  photo: 'https://img.example/1.jpg',
  ...over,
});

const feedback = (over: Partial<PickFeedback>): PickFeedback => ({ reaction: 'no', reactionSource: 'form', reasons: [], kind: 'sale', postcodeArea: 'NG', bedrooms: 2, amount: 180_000, rawType: 'Terraced house', ...over });

test('houseQueries takes the best-scored areas with real data, both kinds when there is no filter', () => {
  const qs = houseQueries(cards, null, 2);
  // Aberdeen (early) and Nowhere (no score) are out; Manchester then Nottingham.
  assert.deepEqual(qs.map((q) => `${q.kind}|${q.area}`), ['sale|M', 'rent|M', 'sale|NG', 'rent|NG']);
  assert.equal(qs[0].maxPrice, null);
  assert.equal(qs[0].minBedrooms, null);
});

test('topScoredAreas ranks by score, drops early-tier and unscored areas, and honours the limit', () => {
  assert.deepEqual(topScoredAreas(cards, 10).map((c) => c.code), ['M', 'NG', 'LS']);
  assert.deepEqual(topScoredAreas(cards, 1).map((c) => c.code), ['M']);
  assert.deepEqual(topScoredAreas(cards, 0), []);
});

test('houseQueries honours a member\'s own kind, budget, bedrooms and rent ceiling', () => {
  const goals: MarketGoals = { ...DEFAULT_GOALS, sourcingKind: 'rent', budget: '200-350', bedrooms: 3, maxRentPcm: 1400 };
  const qs = houseQueries(cards, goals, 1);
  assert.deepEqual(qs.map((q) => q.key), ['rent|M||1400|3']);
  const buy = houseQueries(cards, { ...goals, sourcingKind: 'sale' }, 1);
  assert.equal(buy[0].key, 'sale|M|200000|350000|3');
});

test('rent ceiling threads from goals into rent queries and the price filter handles pw', () => {
  const areas: AreaRef[] = [{ code: 'NG', name: 'Nottingham', slug: 'nottingham', centroid: { lat: 52.95, lng: -1.15 }, fit: 70 }];
  const [q] = queriesForGoals({ ...DEFAULT_GOALS, sourcingKind: 'rent', maxRentPcm: 1200 }, ['NG'], areas);
  assert.equal(q.key, 'rent|NG||1200|');
  assert.equal(rentPcm({ amount: 300, period: 'pw' }), 1300);
  assert.equal(withinQueryPrice(listing({ kind: 'rent', price: { amount: 300, period: 'pw' } }), q), false);
  assert.equal(withinQueryPrice(listing({ kind: 'rent', price: { amount: 1150, period: 'pcm' } }), q), true);
  assert.equal(withinQueryPrice(listing({ kind: 'rent', price: null }), q), true);
  const sale: SourcingQuery = { ...q, kind: 'sale', minPrice: 200_000, maxPrice: 350_000 };
  assert.equal(withinQueryPrice(listing(), sale), false);
  assert.equal(withinQueryPrice(listing({ price: { amount: 250_000, period: 'total' } }), sale), true);
});

test('only confirmed negatives count; a bare link click never changes the queries', () => {
  const link = feedback({ reactionSource: 'link', reasons: ['wrong_area'] });
  const bare = feedback({ reactionSource: 'link', reasons: [] });
  const yes = feedback({ reaction: 'yes', reasons: ['wrong_area'] });
  assert.equal(confirmedNegatives([bare, yes]).length, 0);
  assert.equal(confirmedNegatives([link]).length, 1); // reasons given, so it counts
  const qs = houseQueries(cards, null, 2);
  assert.deepEqual(applyQueryFeedback(qs, [bare]), qs);
});

test('applyQueryFeedback drops rejected areas and flips the kind', () => {
  const qs = houseQueries(cards, { ...DEFAULT_GOALS, budget: '200-350' }, 2); // sale only, M + NG
  const out = applyQueryFeedback(qs, [feedback({ reasons: ['wrong_area'], postcodeArea: 'NG' }), feedback({ reasons: ['want_r2r'] })]);
  assert.deepEqual(out.map((q) => q.key), ['rent|M|||']);
  // Contradictory wishes cancel out.
  const both = applyQueryFeedback(qs, [feedback({ reasons: ['want_r2r'] }), feedback({ reasons: ['want_buy'] })]);
  assert.deepEqual(both.map((q) => q.kind), ['sale', 'sale']);
});

test('applyCandidateFeedback caps price at 90% of a rejected pick and drops rejected sizes and types', () => {
  const cands = [
    { listing: listing({ id: 'a', price: { amount: 170_000, period: 'total' } }) },
    { listing: listing({ id: 'b', price: { amount: 150_000, period: 'total' }, bedrooms: 3, rawType: 'Flat' }) },
    { listing: listing({ id: 'c', price: { amount: 150_000, period: 'total' }, bedrooms: 3, rawType: 'Detached house' }) },
    { listing: listing({ id: 'd', kind: 'rent', price: { amount: 900, period: 'pcm' }, bedrooms: 1, rawType: 'Flat' }) },
  ];
  const out = applyCandidateFeedback(cands, [feedback({ reasons: ['too_expensive'], amount: 180_000 }), feedback({ reasons: ['wrong_type'], rawType: 'flat' }), feedback({ reasons: ['wrong_size'], bedrooms: 3 })]);
  assert.deepEqual(out.map((c) => c.listing.id), []); // a too dear, b/c wrong size, d flat
  const out2 = applyCandidateFeedback(cands, [feedback({ reasons: ['too_expensive'], amount: 200_000 })]);
  assert.deepEqual(out2.map((c) => c.listing.id), ['a', 'b', 'c', 'd']);
});

test('the v2 reasons each steer the candidate pool', () => {
  const cands = [
    { listing: listing({ id: 'flat2', bedrooms: 2, rawType: 'Flat', outcode: 'NG1', price: { amount: 150_000, period: 'total' } }), deal: purchaseDeal(150_000, { grossRevenue: 24_000, adr: 110, bedrooms: 2 }) },
    { listing: listing({ id: 'house3', bedrooms: 3, rawType: 'Terraced house', outcode: 'NG2', price: { amount: 200_000, period: 'total' } }), deal: purchaseDeal(200_000, { grossRevenue: 24_000, adr: 110, bedrooms: 3 }) },
    { listing: listing({ id: 'house4', bedrooms: 4, rawType: 'Detached house', outcode: 'NG3', price: { amount: 300_000, period: 'total' }, features: ['In need of full renovation'] }), deal: purchaseDeal(300_000, { grossRevenue: 40_000, adr: 150, bedrooms: 4 }) },
  ];
  const ids = (out: typeof cands) => out.map((c) => c.listing.id);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['no_flats'] })])), ['house3', 'house4']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['no_houses'] })])), ['flat2']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['no_flats'] }), feedback({ reasons: ['no_houses'] })])), ['flat2', 'house3', 'house4']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['too_small'], bedrooms: 2 })])), ['house3', 'house4']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['too_big'], bedrooms: 4 })])), ['flat2', 'house3']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['too_cheap'], amount: 150_000 })])), ['house3', 'house4']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['poor_location'], outcode: 'ng2' })])), ['flat2', 'house4']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['needs_work'] })])), ['flat2', 'house3']);
  assert.equal(dealScoreOf(cands[0].deal), 16);
  assert.equal(reasonLabel('wrong_size'), 'Wrong size');
  assert.ok(reasonEffect('too_expensive'));
  assert.deepEqual(cleanReasons(['too_small', 'wrong_size', 'bogus']), ['too_small', 'wrong_size']);
});

test('"return too low" raises the floor on the screening, in the screening\'s own units', () => {
  // Uplift % against a long-term let, which is what the member was shown.
  const screened = (id: string, upliftPct: number) => ({
    listing: listing({ id, bedrooms: 2, price: { amount: 150_000, period: 'total' as const } }),
    deal: purchaseDeal(150_000, { grossRevenue: 24_000, adr: 110, bedrooms: 2 }),
    screening: screenPurchase({ bedrooms: 2, grossRevenue: { value: 24_000, source: 'estimated', confidence: 'medium' }, marketRent: { value: 700, source: 'estimated', confidence: 'medium' } }),
    upliftPct,
  });
  const cands = [
    { ...screened('weak', 0), screening: { ...screened('weak', 0).screening, upliftPct: 5 } },
    { ...screened('mid', 0), screening: { ...screened('mid', 0).screening, upliftPct: 30 } },
    { ...screened('strong', 0), screening: { ...screened('strong', 0).screening, upliftPct: 60 } },
  ];
  const ids = (out: typeof cands) => out.map((c) => c.listing.id);

  // Said no to a 30% uplift: only better than that survives. The floor is
  // strictly greater, so the rejected figure itself is excluded.
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['poor_return'], screeningScore: 30 })])), ['strong']);
  assert.deepEqual(ids(applyCandidateFeedback(cands, [feedback({ reasons: ['poor_return'], screeningScore: 4 })])), ['weak', 'mid', 'strong']);
});

test('a return floor never comes from, or applies to, something with no screening', () => {
  const withScreening = {
    listing: listing({ id: 'screened', bedrooms: 2, price: { amount: 150_000, period: 'total' as const } }),
    deal: purchaseDeal(150_000, { grossRevenue: 24_000, adr: 110, bedrooms: 2 }),
    screening: screenPurchase({ bedrooms: 2, grossRevenue: { value: 24_000, source: 'estimated', confidence: 'medium' }, marketRent: { value: 2_000, source: 'estimated', confidence: 'medium' } }),
  };
  const unscreened = { listing: listing({ id: 'bare', bedrooms: 2, price: { amount: 150_000, period: 'total' as const } }), deal: purchaseDeal(150_000, { grossRevenue: 24_000, adr: 110, bedrooms: 2 }) };

  // Feedback from before the screening existed sets no floor at all: its stored
  // figure was a gross yield, and comparing that against an uplift would
  // mis-filter silently. Such rows age out of the 60-day window instead.
  const legacy = feedbackRules([feedback({ reasons: ['poor_return'] })]);
  assert.deepEqual(legacy.minReturn, {}, 'no screening on the row, so no floor');
  assert.ok(legacy.inert.includes('poor_return'), 'and the member is told it changed nothing');

  // A candidate we could not screen is not dropped by a floor either — there is
  // nothing to compare it against, and going silent costs the member their pick.
  const kept = applyCandidateFeedback([withScreening, unscreened], [feedback({ reasons: ['poor_return'], screeningScore: 500 })]);
  assert.ok(kept.some((c) => c.listing.id === 'bare'), 'an unscreened candidate survives any floor');
});

test('reasons are cleaned to the known set and tokens are guarded', () => {
  assert.deepEqual(cleanReasons(['wrong_area', 'nope', 'wrong_area', ' too_expensive ']), ['wrong_area', 'too_expensive']);
  assert.deepEqual(cleanReasons('want_r2r,seen_it'), ['want_r2r', 'seen_it']);
  const t = newPickToken();
  assert.ok(isPickToken(t));
  assert.equal(isPickToken('short'), false);
  assert.equal(isPickToken("x'; drop table --"), false);
  assert.equal(startOfTodayUtc(new Date('2026-09-18T23:59:00Z')).toISOString(), '2026-09-18T00:00:00.000Z');
});

test('a pick costs 10p base at the seed table (2p × 5)', () => {
  assert.equal(pickPrice(seedTable()).basePence, 10);
});

test('pickEmail carries every button, the unsubscribe headers and the first-ever explanation', () => {
  const l = listing();
  const deal = purchaseDeal(180_000, { grossRevenue: 24_000, adr: 110, bedrooms: 2 });
  const pick: SourcedPick = { listing: l, deal, areaFit: 70, areaName: 'Nottingham', fit: 74 };
  const token = newPickToken();
  const m = pickEmail({ pick, siteUrl: 'https://intelligence.stayful.co.uk/', id: 'pick-1', token, basis: 'house', goalsChips: [], firstEver: true, chargedBasePence: 10 });
  const links = pickLinks('https://intelligence.stayful.co.uk', 'pick-1', token, l.canonicalUrl);
  assert.match(m.subject, /^Today's pick to buy: 2-bed in Nottingham · 13\.3% yield$/);
  assert.equal(links.notifications, 'https://intelligence.stayful.co.uk/account/notifications');
  assert.equal(links.today, 'https://intelligence.stayful.co.uk/today');
  for (const href of [links.yes, links.no, links.save, links.report, links.filter, links.listing, links.unsubscribe, links.notifications, links.today]) {
    assert.ok(m.html.includes(`href="${href}"`), `html has ${href}`);
    assert.ok(m.text.includes(href), `text has ${href}`);
  }
  assert.match(m.text, /one property a day/);
  assert.match(m.text, /10p of your credit/);
  assert.match(m.html, /house pick/);
  assert.match(m.html, /Set my filter/);
  assert.deepEqual(m.headers, unsubscribeHeaders(links));
  assert.match(m.headers['List-Unsubscribe'], /\/api\/picks\/unsubscribe\//);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // With a filter and not the first pick: no intro, "Edit my filter", chips shown.
  const m2 = pickEmail({ pick, siteUrl: 'https://x.test', id: 'p2', token, basis: 'goals', goalsChips: ['≤50 mi of NG2', '2-bed'], firstEver: false, chargedBasePence: 0 });
  assert.doesNotMatch(m2.text, /one property a day/);
  assert.match(m2.html, /Edit my filter/);
  assert.match(m2.html, /2-bed/);
  assert.doesNotMatch(m2.text, /of your credit/);
  // Rent-to-rent picks read as such.
  const r2r = pickEmail({ pick: { ...pick, listing: listing({ kind: 'rent', price: { amount: 950, period: 'pcm' } }), deal: null }, siteUrl: 'https://x.test', id: 'p3', token, basis: 'goals', goalsChips: [], firstEver: false, chargedBasePence: 10 });
  assert.match(r2r.subject, /rent-to-rent/);
  assert.match(r2r.text, /£950 pcm/);
});

test('summarisePicks counts sent picks, responses, saves, reasons and areas', () => {
  const rows: PickRow[] = [
    { status: 'sent', kind: 'sale', basis: 'goals', postcodeArea: 'NG', reaction: 'yes', reactionSource: 'link', reasons: [], savedAt: '2026-09-18T09:00:00Z', sentAt: '2026-09-18T07:00:00Z' },
    { status: 'sent', kind: 'rent', basis: 'house', postcodeArea: 'NG', reaction: 'no', reactionSource: 'form', reasons: ['wrong_area', 'too_expensive'], savedAt: null, sentAt: '2026-09-17T07:00:00Z' },
    { status: 'sent', kind: 'sale', basis: 'house', postcodeArea: 'M', reaction: null, reactionSource: null, reasons: [], savedAt: null, sentAt: '2026-09-16T07:00:00Z' },
    { status: 'failed', kind: 'sale', basis: 'goals', postcodeArea: 'M', reaction: null, reactionSource: null, reasons: [], savedAt: null, sentAt: '2026-09-16T07:00:00Z' },
    { status: 'pending', kind: 'sale', basis: 'goals', postcodeArea: 'M', reaction: null, reactionSource: null, reasons: [], savedAt: null, sentAt: '2026-09-16T07:00:00Z' },
  ];
  const s = summarisePicks(rows);
  assert.equal(s.sent, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.responded, 2);
  assert.equal(s.yes, 1);
  assert.equal(s.no, 1);
  assert.equal(s.saved, 1);
  assert.deepEqual(s.byKind.rent, { sent: 1, yes: 0, no: 1, saved: 0 });
  assert.deepEqual(s.byBasis.house, { sent: 2, yes: 0, no: 1, saved: 0 });
  assert.deepEqual(s.reasons, [{ key: 'wrong_area', count: 1 }, { key: 'too_expensive', count: 1 }]);
  assert.deepEqual(s.areas[0], { area: 'NG', sent: 2, yes: 1, no: 1 });
});

test('spreadPick hands the same listing to at most the cap, then moves down the ranking', () => {
  const ranked = [{ listing: { canonicalUrl: 'https://x/a' }, fit: 90 }, { listing: { canonicalUrl: 'https://x/b' }, fit: 80 }];
  const assigned = new Map<string, number>();
  const got = Array.from({ length: PER_LISTING_CAP + 1 }, () => spreadPick(ranked, assigned)!.listing.canonicalUrl);
  assert.deepEqual(got, [...Array(PER_LISTING_CAP).fill('https://x/a'), 'https://x/b']);
  assert.equal(assigned.get('https://x/a'), PER_LISTING_CAP);
  assert.equal(assigned.get('https://x/b'), 1);
});

test('spreadPick falls back to the top candidate when everything is capped, and returns null for no candidates', () => {
  const ranked = [{ listing: { canonicalUrl: 'https://x/a' } }];
  const assigned = new Map<string, number>([['https://x/a', 5]]);
  assert.equal(spreadPick(ranked, assigned, 1)?.listing.canonicalUrl, 'https://x/a');
  assert.equal(assigned.get('https://x/a'), 6);
  assert.equal(spreadPick([], assigned), null);
});

// ── Contradictions must cancel, never empty the pool ──
// Every case below is an input a reviewer ran against the real module and got
// an empty result from: a member who answers honestly must never be starved of
// the daily pick they pay for.

const pool = () => [
  { listing: listing({ id: '140k', price: { amount: 140_000, period: 'total' as const }, bedrooms: 2 }) },
  { listing: listing({ id: '180k', price: { amount: 180_000, period: 'total' as const }, bedrooms: 3 }) },
  { listing: listing({ id: '200k', price: { amount: 200_000, period: 'total' as const }, bedrooms: 3 }) },
  { listing: listing({ id: '260k', price: { amount: 260_000, period: 'total' as const }, bedrooms: 4 }) },
];

test('an inverted price band cancels instead of dropping every priced candidate', () => {
  // too_expensive @200k caps at 180k; too_cheap @180k floors at 198k.
  const fb = [feedback({ reasons: ['too_expensive'], amount: 200_000, kind: 'sale' }), feedback({ reasons: ['too_cheap'], amount: 180_000, kind: 'sale' })];
  const rules = feedbackRules(fb);
  assert.equal(rules.cap.sale, undefined);
  assert.equal(rules.floor.sale, undefined);
  assert.deepEqual(rules.cancelled.sort(), ['too_cheap', 'too_expensive']);
  assert.equal(applyCandidateFeedback(pool(), fb).length, 4);
  // Both ticked on one pick does the same.
  const one = [feedback({ reasons: ['too_expensive', 'too_cheap'], amount: 180_000, kind: 'sale' })];
  assert.equal(applyCandidateFeedback(pool(), one).length, 4);
  // A band that is merely tight still applies.
  const fine = [feedback({ reasons: ['too_expensive'], amount: 260_000, kind: 'sale' }), feedback({ reasons: ['too_cheap'], amount: 140_000, kind: 'sale' })];
  assert.deepEqual(applyCandidateFeedback(pool(), fine).map((c) => c.listing.id), ['180k', '200k']);
  // Each kind is its own band: a rent answer never cancels a sale one.
  const mixed = feedbackRules([feedback({ reasons: ['too_expensive'], amount: 200_000, kind: 'sale' }), feedback({ reasons: ['too_cheap'], amount: 900, kind: 'rent' })]);
  assert.equal(mixed.cap.sale, 180_000);
  assert.equal(mixed.floor.rent, 990);
  assert.deepEqual(mixed.cancelled, []);
});

test('a bedroom band fully excluded by a legacy wrong_size cancels', () => {
  // too_small@2 → min 3, too_big@4 → max 3, wrong_size@3 leaves no open size.
  const fb = [feedback({ reasons: ['too_small'], bedrooms: 2 }), feedback({ reasons: ['too_big'], bedrooms: 4 }), feedback({ reasons: ['wrong_size'], bedrooms: 3 })];
  const rules = feedbackRules(fb);
  assert.equal(rules.minBeds, null);
  assert.equal(rules.maxBeds, null);
  assert.ok(rules.cancelled.includes('wrong_size'));
  const kept = applyCandidateFeedback(pool(), fb).map((c) => c.listing.id);
  assert.deepEqual(kept, ['140k', '260k']); // only the 3-beds are excluded
  // Directly contradictory sizes cancel too.
  const both = feedbackRules([feedback({ reasons: ['too_small'], bedrooms: 4 }), feedback({ reasons: ['too_big'], bedrooms: 3 })]);
  assert.equal(both.minBeds, null);
  assert.deepEqual(both.cancelled.sort(), ['too_big', 'too_small']);
});

test('no_flats and no_houses treat an unknown type as unknown, on both sides', () => {
  const cands = [
    { listing: listing({ id: 'flat', rawType: 'Flat', title: '2 bedroom flat for sale' }) },
    { listing: listing({ id: 'house', rawType: 'Detached bungalow', title: '3 bedroom bungalow for sale' }) },
    { listing: listing({ id: 'unknown', rawType: null, title: '2 bedroom property for sale in Leicester' }) },
  ];
  // "Houses only" must not send an untyped listing that may be a flat.
  assert.deepEqual(applyCandidateFeedback(cands, [feedback({ reasons: ['no_flats'] })]).map((c) => c.listing.id), ['house']);
  // "Flats only" is the mirror image, not stricter and not looser.
  assert.deepEqual(applyCandidateFeedback(cands, [feedback({ reasons: ['no_houses'] })]).map((c) => c.listing.id), ['flat']);
  assert.equal(applyCandidateFeedback(cands, [feedback({ reasons: ['no_flats'] }), feedback({ reasons: ['no_houses'] })]).length, 3);
});

test('needs_work keeps listings whose address merely contains the word auction', () => {
  const fb = [feedback({ reasons: ['needs_work'] })];
  const keep = [
    'The Auction House, Stoney Street, Nottingham, NG1',
    'Flat 6, Auction House, Leeds, LS2',
    '3 bedroom house for sale in Auction Close, Kettering, NN16',
  ];
  for (const title of keep) {
    assert.equal(applyCandidateFeedback([{ listing: listing({ title }) }], fb).length, 1, title);
  }
  const drop = [
    ['For sale by auction, 12 Mill Lane', undefined],
    ['Sold via Modern Method of Auction, 3 The Row', undefined],
    ['2 bedroom house for sale', 'Auction Guide Price'],
    ['3 bedroom house in need of full modernisation', undefined],
  ] as const;
  for (const [title, qualifier] of drop) {
    assert.equal(applyCandidateFeedback([{ listing: listing({ title, priceQualifier: qualifier ?? null }) }], fb).length, 0, title);
  }
});

test('feedbackRules reports which answers changed nothing, so nothing is over-promised', () => {
  // poor_location with no outcode on the stored listing cannot arm.
  const noOutcode = feedbackRules([feedback({ reasons: ['poor_location'], outcode: null })]);
  assert.equal(noOutcode.badOutcodes.size, 0);
  assert.equal(ruleApplied(noOutcode, 'poor_location'), false);
  const withOutcode = feedbackRules([feedback({ reasons: ['poor_location'], outcode: 'le2' })]);
  assert.ok(withOutcode.badOutcodes.has('LE2'));
  assert.equal(ruleApplied(withOutcode, 'poor_location'), true);
  // "Too big" on a one-bed has nowhere to go.
  assert.equal(ruleApplied(feedbackRules([feedback({ reasons: ['too_big'], bedrooms: 1 })]), 'too_big'), false);
  // seen_it never changes a search.
  assert.equal(ruleApplied(feedbackRules([feedback({ reasons: ['seen_it'] })]), 'seen_it'), false);
  // not_str_suitable now does something: it demands a listing that already passes.
  assert.equal(feedbackRules([feedback({ reasons: ['not_str_suitable'] })]).strictSuitability, true);
  assert.equal(ruleApplied(feedbackRules([feedback({ reasons: ['not_str_suitable'] })]), 'not_str_suitable'), true);
  // A link-only click still changes nothing at all.
  assert.deepEqual(feedbackRules([feedback({ reactionSource: 'link', reasons: [] })]).cancelled, []);
  assert.equal(feedbackRules([feedback({ reactionSource: 'link', reasons: [] })]).noWork, false);
});

test('applyQueryFeedback reads the same rule set, so contradictory kinds cancel once', () => {
  const qs = houseQueries(cards, { ...DEFAULT_GOALS, budget: '200-350' }, 2);
  const rules = feedbackRules([feedback({ reasons: ['want_r2r'] }), feedback({ reasons: ['want_buy'] })]);
  assert.equal(rules.wantKind, null);
  assert.deepEqual(rules.cancelled.sort(), ['want_buy', 'want_r2r']);
  assert.deepEqual(applyQueryFeedback(qs, [], rules).map((q) => q.kind), ['sale', 'sale']);
});

// ── Telling the member why ──

test('the reasons line is built only from signals that fired', () => {
  assert.equal(describeMotivation(null), null);
  assert.equal(describeMotivation({ score: 0, firmScore: 0, fired: [] }), null);
  assert.equal(
    describeMotivation({ score: 55, firmScore: 30, fired: ['long_on_market', 'chain_free'] }),
    'Why this one: On the market a long time · Chain free.',
  );
});

test('the reasons line does not turn into a sales pitch', () => {
  const many = describeMotivation({
    score: 100,
    firmScore: 70,
    fired: ['long_on_market', 'urgent_sale', 'price_reduced', 'chain_free', 'probate', 'auction'],
  })!;
  assert.equal(many.split(' · ').length, 3);
});

test('the email only says why when there is a why to give', () => {
  const l = listing({});
  const base = { listing: l, deal: null, areaFit: 70, areaName: 'Nottingham', fit: 74 };
  const send = (pick: SourcedPick) =>
    pickEmail({ pick, siteUrl: 'https://x.test', id: 'p1', token: newPickToken(), basis: 'goals', goalsChips: [], firstEver: false, chargedBasePence: 10 });

  const quiet = send({ ...base, motivation: null });
  assert.ok(!quiet.text.includes('Why this one'));
  assert.ok(!quiet.html.includes('Why this one'));

  const loud = send({ ...base, motivation: { score: 55, firmScore: 30, fired: ['long_on_market', 'price_reduced'] } });
  assert.ok(loud.text.includes('Why this one: On the market a long time · Price reduced.'));
  assert.ok(loud.html.includes('Why this one:'));
  assert.ok(loud.html.includes('On the market a long time'));
});

// ── When nothing matched ──

test('a near miss says so before it says anything else', () => {
  const l = listing({});
  const pick: SourcedPick = { listing: l, deal: null, areaFit: 70, areaName: 'Nottingham', fit: 60 };
  const send = (over: Partial<Parameters<typeof pickEmail>[0]>) =>
    pickEmail({ pick, siteUrl: 'https://x.test', id: 'p1', token: newPickToken(), basis: 'goals', goalsChips: [], firstEver: false, chargedBasePence: 10, ...over });

  const plain = send({});
  assert.ok(!plain.text.includes('Nothing matched'));

  const near = send({ nearMiss: true, relaxation: 'Your tightest filter is how long it must have been on the market — currently 5 months. Change it to 3 months and 4 more would have qualified.' });
  assert.ok(near.text.includes('Nothing matched your filter exactly today'));
  assert.ok(near.html.includes('Nothing matched your filter exactly today'));
  // The honest line comes before the property, not buried under it.
  assert.ok(near.text.indexOf('Nothing matched') < near.text.indexOf('Fit '));
  assert.ok(near.text.includes('Change it to 3 months'));
  assert.ok(near.html.includes('4 more would have qualified'));
});

test('the advice is never shown on a pick that did match', () => {
  const l = listing({});
  const pick: SourcedPick = { listing: l, deal: null, areaFit: 70, areaName: 'Nottingham', fit: 60 };
  const mail = pickEmail({ pick, siteUrl: 'https://x.test', id: 'p1', token: newPickToken(), basis: 'goals', goalsChips: [], firstEver: false, chargedBasePence: 10, nearMiss: false, relaxation: 'Change your budget.' });
  assert.ok(!mail.text.includes('Change your budget'));
  assert.ok(!mail.html.includes('Change your budget'));
});

test('a pick drawn from the marketplace pool links to its deal sheet and to more like it', () => {
  const l = listing({ postcodeArea: 'NG', bedrooms: 4 });
  const links = pickLinks('https://x.test', 'p1', 'tok', l.canonicalUrl, { dealId: 'deal-1', kind: 'sale', area: 'NG', bedrooms: 4 });
  assert.equal(links.deal, 'https://x.test/deals/deal-1');
  assert.equal(links.more, 'https://x.test/deals?kind=sale&areas=NG&beds=4%2B');
  assert.equal(pickLinks('https://x.test', 'p1', 'tok', l.canonicalUrl).deal, null);
  const pick = { listing: l, deal: null, areaFit: 60, areaName: 'Nottingham', fit: 70 };
  const withDeal = pickEmail({ pick, siteUrl: 'https://x.test', id: 'p1', token: newPickToken(), basis: 'goals', goalsChips: [], firstEver: false, chargedBasePence: 40, dealId: 'deal-1' });
  assert.ok(withDeal.html.includes('https://x.test/deals/deal-1'));
  assert.ok(withDeal.text.includes('Open the deal sheet: https://x.test/deals/deal-1'));
  assert.ok(withDeal.text.includes('More deals like this: https://x.test/deals?kind=sale&areas=NG&beds=4%2B'));
  const without = pickEmail({ pick, siteUrl: 'https://x.test', id: 'p1', token: newPickToken(), basis: 'goals', goalsChips: [], firstEver: false, chargedBasePence: 10 });
  assert.ok(!without.html.includes('/deals/'));
  assert.ok(!without.text.includes('Open the deal sheet'));
});
