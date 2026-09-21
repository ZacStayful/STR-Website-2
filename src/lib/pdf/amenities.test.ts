import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAmenities, canonicalAmenities, differentiatorPremium } from './amenities.ts';
import type { AmenityComp } from './amenities.ts';

const comp = (nightly: number, amenities: Record<string, boolean>): AmenityComp =>
  ({ nightly, amenities });

test('Airbtics spelling variants resolve to one display name', () => {
  // getShortLetData already has to cope with four spellings of "parking".
  for (const key of ['parking', 'free_parking', 'Free parking on premises', 'free_parking_on_premises']) {
    assert.ok(canonicalAmenities({ [key]: true }).has('Free parking'), key);
  }
  assert.ok(canonicalAmenities({ WiFi: true }).has('WiFi'));
  assert.ok(canonicalAmenities({ wireless_internet: true }).has('WiFi'));
});

test('amenities flagged false, and ones we do not report on, are ignored', () => {
  const found = canonicalAmenities({ wifi: false, kitchen: true, unicorn_stable: true });
  assert.deepEqual([...found], ['Kitchen']);
});

test('a missing amenity map yields nothing at all', () => {
  assert.equal(canonicalAmenities(null).size, 0);
  assert.equal(canonicalAmenities(undefined).size, 0);
});

test('reports saved before amenities were captured fall back', () => {
  // The caller substitutes a fixed list rather than printing an empty section.
  assert.equal(scoreAmenities([]), null);
  assert.equal(scoreAmenities([{ nightly: 100 }, { nightly: 110 }, { nightly: 120 }]), null);
  // Two listings is an anecdote, not a market.
  assert.equal(scoreAmenities([comp(100, { wifi: true }), comp(110, { wifi: true })]), null);
});

test('penetration decides both the score and the band', () => {
  const comps = [
    comp(100, { wifi: true, kitchen: true, garden: true, hot_tub: true }),
    comp(110, { wifi: true, kitchen: true, garden: true }),
    comp(120, { wifi: true, kitchen: true, garden: true }),
    comp(130, { wifi: true, kitchen: true }),
    comp(140, { wifi: true, kitchen: true }),
    comp(150, { wifi: true, kitchen: true }),
    comp(160, { wifi: true }),
    comp(170, { wifi: true }),
  ];
  const out = scoreAmenities(comps);
  assert.ok(out);

  // Every listing has WiFi: table stakes, full marks.
  const wifi = out!.essential.find((a) => a.name === 'WiFi');
  assert.ok(wifi, 'WiFi should be essential');
  assert.equal(wifi!.score, 5);
  assert.equal(wifi!.penetration, 1);

  // Three of eight have a garden: worth having, not expected.
  const garden = out!.edge.find((a) => a.name === 'Garden');
  assert.ok(garden, 'Garden should be a competitive edge');
  assert.equal(garden!.score, 2);

  // One of eight has a hot tub: rare enough to stand out.
  const hotTub = out!.differentiators.find((a) => a.name === 'Hot tub');
  assert.ok(hotTub, 'Hot tub should be a differentiator');
  assert.equal(hotTub!.score, 1);
});

test('the band boundaries are inclusive at the bottom', () => {
  // Exactly 20% is still a competitive edge; below it becomes a differentiator.
  const at20 = scoreAmenities(
    Array.from({ length: 5 }, (_, i) => comp(100, i === 0 ? { wifi: true, pool: true } : { wifi: true })),
  );
  assert.ok(at20!.edge.some((a) => a.name === 'Pool'));

  const below20 = scoreAmenities(
    Array.from({ length: 10 }, (_, i) => comp(100, i === 0 ? { wifi: true, pool: true } : { wifi: true })),
  );
  assert.ok(below20!.differentiators.some((a) => a.name === 'Pool'));
});

test('scores stay inside one to five', () => {
  const comps = Array.from({ length: 10 }, (_, i) => comp(100 + i, i === 0 ? { pool: true } : { wifi: true }));
  const out = scoreAmenities(comps);
  assert.ok(out);
  for (const band of [out!.essential, out!.edge, out!.differentiators]) {
    for (const a of band) {
      assert.ok(a.score >= 1 && a.score <= 5, `${a.name} scored ${a.score}`);
      assert.ok(Number.isInteger(a.score));
    }
  }
});

test('each band is capped so the page cannot overflow', () => {
  const many = Array.from({ length: 8 }, (_, i) =>
    comp(100 + i, {
      wifi: true, kitchen: true, heating: true, washer: true, dryer: true,
      tv: true, workspace: true, parking: true, garden: true,
      air_conditioning: true, self_check_in: true,
    }),
  );
  const out = scoreAmenities(many);
  assert.ok(out);
  assert.ok(out!.essential.length <= 3);
  assert.ok(out!.edge.length <= 4);
  assert.ok(out!.differentiators.length <= 5);
});

test('a price premium needs enough comparables either side to mean anything', () => {
  // Only one listing has a hot tub: no honest premium can be read from that.
  const thin = [
    comp(400, { wifi: true, hot_tub: true }),
    comp(100, { wifi: true }), comp(100, { wifi: true }), comp(100, { wifi: true }),
    comp(100, { wifi: true }), comp(100, { wifi: true }), comp(100, { wifi: true }),
    comp(100, { wifi: true }),
  ];
  const out = scoreAmenities(thin);
  const hotTub = out!.differentiators.find((a) => a.name === 'Hot tub');
  assert.ok(hotTub, 'Hot tub should be a differentiator');
  assert.equal(hotTub!.premiumPct, null, 'one comparable cannot establish a premium');
  assert.equal(differentiatorPremium(out!.differentiators), null);
});

test('a real premium is measured from the comparables', () => {
  const comps = [
    comp(200, { wifi: true, garden: true }), comp(200, { wifi: true, garden: true }),
    comp(200, { wifi: true, garden: true }),
    comp(100, { wifi: true }), comp(100, { wifi: true }), comp(100, { wifi: true }),
  ];
  const out = scoreAmenities(comps);
  const garden = out!.edge.find((a) => a.name === 'Garden');
  assert.equal(garden?.premiumPct, 100, 'median £200 against £100');
});

test('the differentiator headline spans the observed premiums', () => {
  assert.deepEqual(
    differentiatorPremium([
      { name: 'a', score: 1, penetration: 0.1, premiumPct: 15 },
      { name: 'b', score: 1, penetration: 0.1, premiumPct: 30 },
      { name: 'c', score: 1, penetration: 0.1, premiumPct: null },
      { name: 'd', score: 1, penetration: 0.1, premiumPct: -5 },
    ]),
    { low: 15, high: 30 },
  );
});
