import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  areasForGoals,
  queriesForGoals,
  onTheMarketSearchUrl,
  parseOnTheMarketSearch,
  fromPmiListings,
  dealForSourced,
  rankPicks,
  MOTIVATION_LIFT,
  listingAge,
  medianAgeDays,
  sourcingEmail,
  budgetBounds,
  type AreaRef,
  type SourcedListing,
} from './sourcing.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, '__fixtures__', name), 'utf8');

const areas: AreaRef[] = [
  { code: 'NG', name: 'Nottingham', slug: 'nottingham', centroid: { lat: 52.95, lng: -1.15 }, fit: 70 },
  { code: 'DE', name: 'Derby', slug: 'derby', centroid: { lat: 52.92, lng: -1.48 }, fit: 60 },
  { code: 'M', name: 'Manchester', slug: 'manchester', centroid: { lat: 53.48, lng: -2.24 }, fit: 80 },
  { code: 'AB', name: 'Aberdeen', slug: 'aberdeen', centroid: { lat: 57.15, lng: -2.1 }, fit: 90 },
  { code: 'ZZ', name: 'ZZ postcode area', slug: 'zz', centroid: null, fit: null },
];

const goals: MarketGoals = { ...DEFAULT_GOALS, home: { postcode: 'NG1 1AA', lat: 52.95, lng: -1.15 }, maxDistanceMiles: 25, budget: '200-350', bedrooms: 2 };

test('areasForGoals = saved ∪ within-radius, best fit first, capped', () => {
  const picked = areasForGoals(goals, ['zz'], areas);
  assert.deepEqual(
    picked.map((a) => a.code),
    ['NG', 'DE', 'ZZ'],
  );
  const capped = areasForGoals({ ...goals, maxDistanceMiles: 100 }, [], areas, 2);
  assert.deepEqual(
    capped.map((a) => a.code),
    ['M', 'NG'],
  );
  // No home and nothing saved → nothing to search.
  assert.deepEqual(areasForGoals({ ...goals, home: null }, [], areas), []);
});

test('queriesForGoals carries budget on sale queries only and both kinds when asked', () => {
  const qs = queriesForGoals({ ...goals, sourcingKind: 'both' }, [], areas);
  const ng = qs.filter((q) => q.area === 'NG');
  assert.equal(ng.length, 2);
  const sale = ng.find((q) => q.kind === 'sale')!;
  const rent = ng.find((q) => q.kind === 'rent')!;
  assert.equal(sale.key, 'sale|NG|200000|350000|2');
  assert.equal(rent.key, 'rent|NG|||2');
  assert.deepEqual(budgetBounds('500+'), { min: 500_000, max: null });
});

test('onTheMarketSearchUrl builds the city search and refuses generated slugs', () => {
  const [q] = queriesForGoals(goals, [], areas);
  assert.equal(onTheMarketSearchUrl(q), 'https://www.onthemarket.com/for-sale/property/nottingham/?max-price=350000&min-price=200000&min-bedrooms=2&radius=5');
  assert.equal(onTheMarketSearchUrl({ ...q, area: 'ZZ', areaSlug: 'zz' }), null);
});

test('parseOnTheMarketSearch reads sale and rent cards', () => {
  const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale');
  assert.equal(sale.length, 6);
  const first = sale[0];
  assert.equal(first.id, '19782017');
  assert.equal(first.canonicalUrl, 'https://www.onthemarket.com/details/19782017/');
  assert.deepEqual(first.price, { amount: 120_000, period: 'total' });
  assert.equal(first.bedrooms, 2);
  assert.equal(first.outcode, 'NG1');
  assert.equal(first.postcodeArea, 'NG');
  assert.ok(first.lat && first.lng);
  assert.ok(first.photo?.startsWith('https://'));
  assert.ok(first.features?.some((f) => /^Tenure: Leasehold/.test(f)));
  assert.equal(typeof (first.priceQualifier ?? ''), 'string');
  // No agent details survive.
  assert.ok(!JSON.stringify(sale).includes('telephone'));

  const rent = parseOnTheMarketSearch(fixture('onthemarket-search-rent.html'), 'rent');
  assert.equal(rent.length, 6);
  assert.deepEqual(rent[0].price, { amount: 1450, period: 'pcm' });
  assert.equal(parseOnTheMarketSearch('<html></html>', 'sale').length, 0);
  // Staleness evidence the card already carries, which used to be dropped.
  assert.equal(sale[0].addedOrReduced, 'Added > 14 days');
  assert.equal(rent[1].addedOrReduced, 'Added < 14 days');
});

test('the agent is reduced to a digest, never stored by name', () => {
  const had = process.env.AGENT_HASH_KEY;
  process.env.AGENT_HASH_KEY = 'test-key';
  try {
    const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale');
    assert.match(sale[0].agentHash!, /^[A-Za-z0-9_-]{4}\.[A-Za-z0-9_-]{22}$/);
    // Two listings from the same branch must match, or a relist looks like a new agent.
    assert.equal(sale[0].agentHash, sale[1].agentHash);
    assert.ok(!JSON.stringify(sale).toLowerCase().includes('example agent'));
  } finally {
    if (had === undefined) delete process.env.AGENT_HASH_KEY;
    else process.env.AGENT_HASH_KEY = had;
  }
});

test('fromPmiListings keeps only listings with a recognisable portal URL', () => {
  const out = fromPmiListings(
    {
      listings: [
        { address: '1 High St, Nottingham', postcode: 'NG1 1AA', price: 250_000, bedrooms: 2, property_type: 'flat', tenure: 'Leasehold', tags: ['Chain free', 42 as unknown as string], listed_date: '2026-04-24', uprn: '100031234567', url: 'https://www.rightmove.co.uk/properties/123#/?channel=RES_BUY' },
        { address: '2 Low St', price: 300_000, url: 'https://example.com/x' },
        { address: '3 Mid St', price: 1200, bedrooms: 3, url: 'https://www.zoopla.co.uk/to-rent/details/456/' },
      ],
    },
    'sale',
  );
  // Zoopla is recognised but not fetchable by us, so the digest must not link to it.
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'rightmove');
  assert.equal(out[0].canonicalUrl, 'https://www.rightmove.co.uk/properties/123');
  assert.equal(out[0].postcode, 'NG1 1AA');
  assert.equal(out[0].postcodeArea, 'NG');
  assert.equal(out[0].tenure, 'Leasehold');
  assert.deepEqual(out[0].features, ['Chain free']);
  // The portal's listing date and the property id: both returned by PMI on every
  // listing, both previously thrown away.
  assert.equal(out[0].listedDate, '2026-04-24');
  assert.equal(out[0].uprn, '100031234567');
  assert.deepEqual(fromPmiListings(null, 'sale'), []);
});

test('dealForSourced uses per-bedroom figures and rankPicks drops losing deals', () => {
  const figures = { byBedrooms: [{ bedrooms: 2, grossRevenue: 30_000, adr: 140 }], headline: { grossRevenue: 24_000, adr: 120 } };
  const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale');
  const deal = dealForSourced(sale[0], figures, null)!;
  assert.equal(deal.kind, 'purchase');
  assert.equal(deal.grossRevenue, 30_000);
  // £120k at £30k gross = 25% gross yield.
  assert.ok(deal.kind === 'purchase' && deal.grossYieldPct > 20);

  const rent = parseOnTheMarketSearch(fixture('onthemarket-search-rent.html'), 'rent');
  const r2r = dealForSourced(rent[0], { byBedrooms: [], headline: { grossRevenue: 12_000, adr: 80 } }, null)!;
  assert.equal(r2r.kind, 'rent-to-rent');
  assert.ok(r2r.kind === 'rent-to-rent' && r2r.monthlyMargin < 0);

  const picks = rankPicks([
    { listing: sale[0], deal, areaFit: 70, areaName: 'Nottingham' },
    { listing: rent[0], deal: r2r, areaFit: 70, areaName: 'Nottingham' },
    { listing: sale[1], deal: null, areaFit: 70, areaName: 'Nottingham' },
  ]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].listing.id, '19782017');
  assert.ok(picks[0].fit > 70);
  assert.equal(dealForSourced(sale[0], null, null), null);
});

test('sourcing email links to the analyser and the explorer check flow', () => {
  const figures = { byBedrooms: [], headline: { grossRevenue: 30_000, adr: 140 } };
  const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale').slice(0, 2);
  const picks = rankPicks(sale.map((l) => ({ listing: l, deal: dealForSourced(l, figures, null), areaFit: 65, areaName: 'Nottingham' })));
  const mail = sourcingEmail(picks, 'https://intelligence.stayful.co.uk');
  assert.equal(mail.subject, '2 new listings that fit your goals');
  assert.ok(mail.text.includes('/estimate?listing=https%3A%2F%2Fwww.onthemarket.com%2Fdetails%2F19782017%2F'));
  assert.ok(mail.html.includes('/markets?check=https%3A%2F%2Fwww.onthemarket.com'));
  assert.ok(mail.html.includes('gross yield'));
});

// ── How long it has been sitting ──

const aged = (over: Partial<SourcedListing>): SourcedListing => ({
  source: 'onthemarket', id: '1', canonicalUrl: 'https://www.onthemarket.com/details/1/', kind: 'sale',
  title: 'x', address: null, postcode: null, outcode: null, postcodeArea: null, lat: null, lng: null,
  bedrooms: 2, bathrooms: null, price: { amount: 200_000, period: 'total' }, rawType: null, photo: null,
  ...over,
});
const AGE_NOW = new Date('2026-09-24T00:00:00Z');

test('the portal date wins over our own sighting', () => {
  // The listing went up in April; we only started watching in September. Saying
  // "3 days" would turn a five-month-old listing into a brand new one.
  assert.deepEqual(listingAge(aged({ listedDate: '2026-04-24' }), '2026-09-21T00:00:00Z', AGE_NOW), { days: 153, source: 'portal' });
});

test('without a portal date the sighting is used, and labelled as such', () => {
  assert.deepEqual(listingAge(aged({}), '2026-09-21T00:00:00Z', AGE_NOW), { days: 3, source: 'sighting' });
});

test('no usable date is unknown, not new', () => {
  assert.equal(listingAge(aged({}), null, AGE_NOW), null);
  assert.equal(listingAge(aged({ listedDate: 'soon' }), null, AGE_NOW), null);
  // A date in the future is a bad date.
  assert.equal(listingAge(aged({ listedDate: '2027-01-01' }), null, AGE_NOW), null);
});

test('the area median needs a real sample before it means anything', () => {
  const ages = (days: number[]) => days.map((d) => ({ days: d, source: 'portal' as const }));
  assert.equal(medianAgeDays(ages([10, 20, 30])), null);
  assert.equal(medianAgeDays(ages([10, 20, 30]), 3), 20);
  assert.equal(medianAgeDays(ages([10, 20, 30, 40]), 4), 25);
  // Listings with no usable date do not count towards the sample.
  assert.equal(medianAgeDays([...ages([10, 20, 30]), null, null], 4), null);
});

// ── Motivation in the ranking ──

const rankable = (over: Partial<SourcedListing>, price: number) => ({
  listing: aged({ ...over, price: { amount: price, period: 'total' as const } }),
  deal: dealForSourced(aged({ ...over, price: { amount: price, period: 'total' as const } }), { byBedrooms: [{ bedrooms: 2, grossRevenue: 30_000, adr: 140 }], headline: { grossRevenue: 30_000, adr: 140 } }, null),
  areaFit: 60,
  areaName: 'Nottingham',
});

test('off leaves the ranking exactly as it was', () => {
  const cheap = { ...rankable({ id: 'a', canonicalUrl: 'https://x/a' }, 150_000), motivation: { score: 0, firmScore: 0, fired: [] } };
  const dear = { ...rankable({ id: 'b', canonicalUrl: 'https://x/b' }, 300_000), motivation: { score: 100, firmScore: 100, fired: [] } };
  const withOff = rankPicks([cheap, dear], 5, 'off');
  const withoutArg = rankPicks([cheap, dear], 5);
  assert.deepEqual(withOff.map((p) => p.listing.id), withoutArg.map((p) => p.listing.id));
  // The better yield still wins: a perfect motivation score changed nothing.
  assert.equal(withOff[0].listing.id, 'a');
});

test('prefer lifts a motivated listing but cannot rescue a worse deal outright', () => {
  const plain = { ...rankable({ id: 'a', canonicalUrl: 'https://x/a' }, 200_000), motivation: { score: 0, firmScore: 0, fired: [] } };
  const motivated = { ...rankable({ id: 'b', canonicalUrl: 'https://x/b' }, 215_000), motivation: { score: 100, firmScore: 60, fired: [] } };
  const ranked = rankPicks([plain, motivated], 5, 'prefer');
  assert.equal(ranked[0].listing.id, 'b');
  // The lift is bounded, so a hopeless deal cannot climb over a good one.
  const hopeless = { ...rankable({ id: 'c', canonicalUrl: 'https://x/c' }, 900_000), motivation: { score: 100, firmScore: 100, fired: [] } };
  assert.equal(rankPicks([plain, hopeless], 5, 'prefer')[0].listing.id, 'a');
});

test('only drops everything that has not cleared the bar', () => {
  const yes = { ...rankable({ id: 'a', canonicalUrl: 'https://x/a' }, 200_000), motivation: { score: 40, firmScore: 30, fired: [] }, motivationQualifies: true };
  const no = { ...rankable({ id: 'b', canonicalUrl: 'https://x/b' }, 150_000), motivation: { score: 10, firmScore: 0, fired: [] }, motivationQualifies: false };
  assert.deepEqual(rankPicks([no, yes], 5, 'only').map((p) => p.listing.id), ['a']);
  // Unknown is not a pass: a candidate nobody judged must not slip through.
  const unjudged = { ...rankable({ id: 'c', canonicalUrl: 'https://x/c' }, 150_000) };
  assert.deepEqual(rankPicks([unjudged], 5, 'only'), []);
});

test('a rent-to-rent that loses money is never rescued by motivation', () => {
  // The rent is far above what the property can earn, so the margin is negative.
  const figures = { byBedrooms: [{ bedrooms: 2, grossRevenue: 12_000, adr: 60 }], headline: { grossRevenue: 12_000, adr: 60 } };
  const l = aged({ id: 'a', canonicalUrl: 'https://x/a', kind: 'rent', price: { amount: 3_000, period: 'pcm' } });
  const losing = {
    listing: l,
    deal: dealForSourced(l, figures, null),
    areaFit: 60,
    areaName: 'Nottingham',
    motivation: { score: 100, firmScore: 100, fired: [] },
    motivationQualifies: true,
  };
  assert.ok(losing.deal && losing.deal.kind === 'rent-to-rent' && losing.deal.monthlyMargin <= 0);
  for (const mode of ['off', 'prefer', 'only'] as const) {
    assert.deepEqual(rankPicks([losing], 5, mode), [], mode);
  }
});

test('the lift is capped so a fit can never exceed 100', () => {
  const strong = { ...rankable({ id: 'a', canonicalUrl: 'https://x/a' }, 60_000), areaFit: 100, motivation: { score: 100, firmScore: 100, fired: [] } };
  const ranked = rankPicks([strong], 5, 'prefer');
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].fit <= 100);
  assert.ok(MOTIVATION_LIFT > 0);
});
