import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  houseQueries,
  applyQueryFeedback,
  applyCandidateFeedback,
  confirmedNegatives,
  cleanReasons,
  isPickToken,
  newPickToken,
  startOfTodayUtc,
  pickEmail,
  pickLinks,
  unsubscribeHeaders,
  summarisePicks,
  pickPrice,
  spreadPick,
  PER_LISTING_CAP,
  type HouseAreaCard,
  type PickFeedback,
  type PickRow,
} from './picks.ts';
import { queriesForGoals, rentPcm, withinQueryPrice, type SourcedListing, type SourcedPick, type AreaRef, type SourcingQuery } from './sourcing.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { purchaseDeal } from './deal.ts';
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
  for (const href of [links.yes, links.no, links.save, links.report, links.filter, links.listing, links.unsubscribe]) {
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
