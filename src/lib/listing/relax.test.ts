import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseRelaxation, closestMatch, describeRelaxation, RELAX_TARGET, type NearMiss, type CurrentFilter } from './relax.ts';
import type { SourcedListing } from './sourcing.ts';

const l = (id: string, over: Partial<SourcedListing> = {}): SourcedListing => ({
  source: 'onthemarket', id, canonicalUrl: `https://x/${id}`, kind: 'sale', title: id,
  address: null, postcode: null, outcode: null, postcodeArea: 'NG', lat: null, lng: null,
  bedrooms: 2, bathrooms: null, price: { amount: 200_000, period: 'total' }, rawType: null, photo: null,
  ...over,
});

const miss = (id: string, fails: NearMiss['fails'], over: Partial<NearMiss> = {}): NearMiss => ({
  listing: l(id), fails, ageDays: null, amount: null, bedrooms: null, ...over,
});

const sale: CurrentFilter = { kind: 'sale', thresholdUnits: 5, maxPrice: 250_000, minBedrooms: 3 };

test('the constraint costing the most is the one named', () => {
  const misses = [
    miss('a', ['motivation'], { ageDays: 120 }),
    miss('b', ['motivation'], { ageDays: 110 }),
    miss('c', ['motivation'], { ageDays: 100 }),
    miss('d', ['price'], { amount: 260_000 }),
  ];
  const r = analyseRelaxation(misses, sale)!;
  assert.equal(r.binding.key, 'motivation');
  assert.equal(r.binding.current, '5 months');
  // 100 days is three months, and all three of those listings clear it.
  assert.equal(r.binding.suggested, '3 months');
  assert.equal(r.binding.wouldAdd, 3);
});

test('a listing that fails several things proves nothing about any of them', () => {
  // Relaxing the threshold alone would still not have let these through, so
  // counting them would promise the member something that will not happen.
  const misses = [
    miss('a', ['motivation', 'price'], { ageDays: 120, amount: 400_000 }),
    miss('b', ['motivation', 'bedrooms'], { ageDays: 130, bedrooms: 1 }),
  ];
  assert.equal(analyseRelaxation(misses, sale), null);
});

test('the suggested value really does admit the number claimed', () => {
  const ages = [200, 150, 120, 100, 95];
  const misses = ages.map((d, i) => miss(`a${i}`, ['motivation'], { ageDays: d }));
  const r = analyseRelaxation(misses, sale)!;
  const perMonth = 30.44;
  const suggestedMonths = Number(r.binding.suggested.split(' ')[0]);
  const actuallyAdmitted = ages.filter((d) => d >= suggestedMonths * perMonth).length;
  assert.equal(r.binding.wouldAdd, actuallyAdmitted);
  assert.ok(actuallyAdmitted >= RELAX_TARGET);
});

test('a change that is not a relaxation is not suggested', () => {
  // These are older than the member's threshold already, so the threshold is
  // not what stopped them and lowering it would be nonsense advice.
  const misses = [miss('a', ['motivation'], { ageDays: 900 }), miss('b', ['motivation'], { ageDays: 800 })];
  assert.equal(analyseRelaxation(misses, sale), null);
  // Same for a budget that is already above the listings that failed on it.
  assert.equal(analyseRelaxation([miss('c', ['price'], { amount: 100_000 })], sale), null);
});

test('budget and bedrooms are advised on in their own units', () => {
  const byPrice = analyseRelaxation([
    miss('a', ['price'], { amount: 260_000 }),
    miss('b', ['price'], { amount: 275_000 }),
  ], sale)!;
  assert.equal(byPrice.binding.key, 'price');
  assert.equal(byPrice.binding.current, '£250,000');
  assert.equal(byPrice.binding.suggested, '£275,000');

  const byBeds = analyseRelaxation([
    miss('a', ['bedrooms'], { bedrooms: 2 }),
    miss('b', ['bedrooms'], { bedrooms: 2 }),
  ], sale)!;
  assert.equal(byBeds.binding.key, 'bedrooms');
  assert.equal(byBeds.binding.suggested, '2');
});

test('a let is advised in weeks and pcm, not months', () => {
  const rent: CurrentFilter = { kind: 'rent', thresholdUnits: 8, maxPrice: 1_200, minBedrooms: null };
  const r = analyseRelaxation([
    miss('a', ['motivation'], { ageDays: 35 }),
    miss('b', ['motivation'], { ageDays: 30 }),
  ], rent)!;
  assert.equal(r.binding.current, '8 weeks');
  assert.equal(r.binding.suggested, '4 weeks');
  const p = analyseRelaxation([miss('c', ['price'], { amount: 1_400 })], rent)!;
  assert.match(p.binding.suggested, /pcm$/);
});

test('when two constraints are close the member is told, not given a winner', () => {
  const misses = [
    miss('a', ['motivation'], { ageDays: 120 }),
    miss('b', ['motivation'], { ageDays: 110 }),
    miss('c', ['price'], { amount: 255_000 }),
    miss('d', ['price'], { amount: 260_000 }),
  ];
  const r = analyseRelaxation(misses, sale, 2)!;
  assert.ok(r.close);
  assert.match(describeRelaxation(r)!, /almost as much/);
});

test('the closest match is the one that missed by least', () => {
  const misses = [
    miss('three', ['motivation', 'price', 'bedrooms']),
    miss('one', ['motivation']),
    miss('two', ['motivation', 'price']),
  ];
  assert.equal(closestMatch(misses)!.listing.id, 'one');
  // Ties break on motivation, so the member gets the most interesting near miss.
  const tied = [miss('dull', ['price']), miss('keen', ['price'])];
  assert.equal(closestMatch(tied, (x) => (x.id === 'keen' ? 50 : 0))!.listing.id, 'keen');
  assert.equal(closestMatch([]), null);
  // A listing that failed nothing is not a near miss — it should have been sent.
  assert.equal(closestMatch([miss('fine', [])]), null);
});

test('the line reads as advice, not as an error', () => {
  assert.equal(describeRelaxation(null), null);
  const r = analyseRelaxation([
    miss('a', ['motivation'], { ageDays: 120 }),
    miss('b', ['motivation'], { ageDays: 110 }),
    miss('c', ['motivation'], { ageDays: 100 }),
  ], sale)!;
  const line = describeRelaxation(r)!;
  assert.match(line, /tightest filter/);
  assert.match(line, /5 months/);
  assert.match(line, /3 months/);
  assert.match(line, /3 more would have qualified/);
});

// ── What is stored, and what may be applied in one click ──

import { toStoredRelaxation, parseStoredRelaxation } from './relax.ts';

const motivationOffer = () =>
  analyseRelaxation([
    miss('a', ['motivation'], { ageDays: 120 }),
    miss('b', ['motivation'], { ageDays: 110 }),
    miss('c', ['motivation'], { ageDays: 100 }),
  ], sale)!;

test('the time threshold is the only thing offered as one click', () => {
  const sold = toStoredRelaxation(motivationOffer(), 'sale')!;
  assert.equal(sold.applyField, 'minMonthsOnMarket');
  assert.equal(sold.value, 3);
  const let_ = toStoredRelaxation(motivationOffer(), 'rent')!;
  assert.equal(let_.applyField, 'minWeeksOnMarket');

  // Budget is a band and bedrooms is a small enum: both change the shape of the
  // search rather than loosening one dial, so they link to the filter instead.
  const byPrice = analyseRelaxation([miss('a', ['price'], { amount: 300_000 })], sale)!;
  const storedPrice = toStoredRelaxation(byPrice, 'sale')!;
  assert.equal(storedPrice.applyField, null);
  assert.equal(storedPrice.value, null);
});

test('a malformed offer is no offer at all, never a partial one', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { key: 'nonsense' }, { key: 'motivation' }]) {
    assert.equal(parseStoredRelaxation(bad), null, JSON.stringify(bad));
  }
});

test('a field with no value can never be applied', () => {
  // Writing a null threshold would reset the member's filter to the default
  // under the guise of applying their choice.
  const tampered = parseStoredRelaxation({
    key: 'motivation', label: 'x', current: '5 months', suggested: '3 months',
    wouldAdd: 3, applyField: 'minMonthsOnMarket', value: null,
  })!;
  assert.equal(tampered.applyField, null);
  assert.equal(tampered.value, null);

  const negative = parseStoredRelaxation({
    key: 'motivation', label: 'x', current: '5 months', suggested: '-1 months',
    wouldAdd: 3, applyField: 'minMonthsOnMarket', value: -1,
  })!;
  assert.equal(negative.applyField, null);
});

test('a stored offer survives the round trip intact', () => {
  const stored = toStoredRelaxation(motivationOffer(), 'sale')!;
  assert.deepEqual(parseStoredRelaxation(JSON.parse(JSON.stringify(stored))), stored);
  assert.equal(toStoredRelaxation(null, 'sale'), null);
});
