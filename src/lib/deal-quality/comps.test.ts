import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bedroomsFilter,
  bedroomsOf,
  boxAround,
  confidenceFor,
  distanceKm,
  isEntireHome,
  kindMatches,
  nextSearchStep,
  revenueSpread,
  settingFilter,
  similarComps,
  startRadiusKm,
  stepAtLeast,
  toReportComp,
  typeBucket,
  type CompListing,
} from './comps.ts';
import { DEFAULT_DEAL_COMPS, DEFAULT_DEAL_CONFIDENCE } from './config.ts';

const HOME = { lat: 53.4057, lng: -2.9855 };
/** A listing `km` north of HOME. */
function at(km: number, over: Partial<CompListing> = {}): CompListing {
  return {
    listingID: `${km}-${Math.random()}`,
    latitude: HOME.lat + km / 111.2,
    longitude: HOME.lng,
    bedrooms: '2',
    room_type: 'entire_home',
    property_type: 'condo',
    annual_revenue_ltm: 20_000,
    ...over,
  };
}
const SUBJECT = { ...HOME, bedrooms: 2, kind: 'flat' as const };

test('bedrooms: "Studio" is 0, numeric strings and numbers read, anything else unknown', () => {
  assert.equal(bedroomsOf('Studio'), 0);
  assert.equal(bedroomsOf('3'), 3);
  assert.equal(bedroomsOf(4), 4);
  assert.equal(bedroomsOf('6+'), null);
  assert.equal(bedroomsOf(null), null);
  assert.equal(bedroomsOf(2.5), null);
});

test('entire homes only; a private room never counts', () => {
  assert.equal(isEntireHome({ room_type: 'entire_home' }), true);
  assert.equal(isEntireHome({ room_type: 'private_room' }), false);
  assert.equal(isEntireHome({ room_type: null, room_and_property_type: 'Entire rental unit' }), true);
  assert.equal(isEntireHome({ room_type: null, room_and_property_type: 'Private room in home' }), false);
});

test('Airbnb types reduce to flat, house or other', () => {
  assert.equal(typeBucket({ property_type: 'condo' }), 'flat');
  assert.equal(typeBucket({ property_type: 'rental_unit' }), 'flat');
  assert.equal(typeBucket({ property_type: 'serviced_apartment' }), 'flat');
  assert.equal(typeBucket({ property_type: 'townhouse' }), 'house');
  assert.equal(typeBucket({ property_type: 'cottage' }), 'house');
  assert.equal(typeBucket({ property_type: 'home' }), 'house');
  assert.equal(typeBucket({ property_type: 'cabin' }), 'other');
  assert.equal(typeBucket({ property_type: 'farm_stay' }), 'other');
  assert.equal(typeBucket({ property_type: null, room_and_property_type: 'Entire condo' }), 'flat');
  assert.equal(typeBucket({ property_type: null }), 'unknown');
});

test('kind: flats with flats, houses with houses; unknown on either side matches', () => {
  assert.equal(kindMatches('flat', 'flat'), true);
  assert.equal(kindMatches('flat', 'house'), false);
  assert.equal(kindMatches('house', 'other'), false);
  assert.equal(kindMatches('house', 'unknown'), true);
  assert.equal(kindMatches('unknown', 'other'), true);
});

test('similar: same bedrooms, entire home, earning, inside the radius, one per listing, nearest first', () => {
  const listings = [
    at(1.5, { listingID: 'far' }),
    at(0.3, { listingID: 'near' }),
    at(0.3, { listingID: 'near' }), // the same listing on a second page
    at(0.5, { listingID: 'three-bed', bedrooms: '3' }),
    at(0.5, { listingID: 'room', room_type: 'private_room' }),
    at(0.5, { listingID: 'no-revenue', annual_revenue_ltm: 0 }),
    at(3, { listingID: 'outside' }),
    at(0.7, { listingID: 'house', property_type: 'townhouse' }),
  ];
  const s = similarComps(listings, SUBJECT, 2);
  assert.deepEqual(s.matched.map((c) => c.listingID), ['near', 'far']);
  assert.deepEqual(s.anyKind.map((c) => c.listingID), ['near', 'house', 'far']);
  assert.ok(Math.abs(s.matched[0].distanceKm - 0.3) < 0.02);
});

test('start radius: the nearest past report’s reach rounded up to a step, else the location class', () => {
  assert.equal(startRadiusKm(DEFAULT_DEAL_COMPS, 1.39, 'urban'), 2);
  assert.equal(startRadiusKm(DEFAULT_DEAL_COMPS, 40, 'urban'), 25);
  assert.equal(startRadiusKm(DEFAULT_DEAL_COMPS, null, 'urban'), 0.8);
  assert.equal(startRadiusKm(DEFAULT_DEAL_COMPS, null, 'coastal'), 5);
  assert.equal(startRadiusKm(DEFAULT_DEAL_COMPS, null, 'rural_isolated'), 12);
  assert.equal(stepAtLeast([0.8, 2, 5], 2), 2);
});

test('the search stops once it holds the target, or when the calls run out', () => {
  const done = [{ radiusKm: 2, page: 1, returned: 30, totalCount: 30 }];
  assert.equal(nextSearchStep(DEFAULT_DEAL_COMPS, done, 12, 2), null);
  assert.equal(nextSearchStep(DEFAULT_DEAL_COMPS, done, 3, 0), null);
});

test('a full page whose box holds more reads the next page, not a wider box', () => {
  const done = [{ radiusKm: 2, page: 1, returned: 50, totalCount: 180 }];
  assert.deepEqual(nextSearchStep(DEFAULT_DEAL_COMPS, done, 8, 2), { radiusKm: 2, page: 2 });
});

test('otherwise it widens to the step whose area should hold the target', () => {
  // 3 similar within 2 km: 2 × √(12/3) = 4 km → the 5 km step.
  assert.deepEqual(nextSearchStep(DEFAULT_DEAL_COMPS, [{ radiusKm: 2, page: 1, returned: 3, totalCount: 3 }], 3, 2), { radiusKm: 5, page: 1 });
  // Nothing within 0.8 km: 0.8 × √12 ≈ 2.8 km → the 5 km step.
  assert.deepEqual(nextSearchStep(DEFAULT_DEAL_COMPS, [{ radiusKm: 0.8, page: 1, returned: 0, totalCount: 0 }], 0, 2), { radiusKm: 5, page: 1 });
  // 10 within 5 km: 5.5 km wanted → the 12 km step.
  assert.deepEqual(nextSearchStep(DEFAULT_DEAL_COMPS, [{ radiusKm: 5, page: 1, returned: 10, totalCount: 10 }], 10, 1), { radiusKm: 12, page: 1 });
});

test('at the max radius with every listing read, it stops short of the target', () => {
  assert.equal(nextSearchStep(DEFAULT_DEAL_COMPS, [{ radiusKm: 25, page: 1, returned: 7, totalCount: 7 }], 7, 2), null);
});

test('spread: the middle half of revenue against the median, the larger side', () => {
  const s = revenueSpread([10_000, 20_000, 30_000, 40_000, 50_000]);
  assert.ok(s);
  assert.equal(s.median, 30_000);
  assert.equal(s.q1, 20_000);
  assert.equal(s.q3, 40_000);
  assert.equal(s.spreadPct, 33.3);
  assert.equal(revenueSpread([20_000]), null);
  assert.equal(revenueSpread([0, 0, -5]), null);
});

test('confidence: high ≤20% with 8+ comps, medium ≤40%, low beyond; 5–7 comps at most medium; under 5 insufficient', () => {
  const tight = { median: 100, q1: 90, q3: 115, spreadPct: 15 };
  const mid = { median: 100, q1: 70, q3: 130, spreadPct: 30 };
  const wide = { median: 100, q1: 50, q3: 160, spreadPct: 60 };
  assert.equal(confidenceFor(tight, 12, DEFAULT_DEAL_CONFIDENCE, 5), 'high');
  assert.equal(confidenceFor(tight, 7, DEFAULT_DEAL_CONFIDENCE, 5), 'medium');
  assert.equal(confidenceFor(mid, 12, DEFAULT_DEAL_CONFIDENCE, 5), 'medium');
  assert.equal(confidenceFor(wide, 12, DEFAULT_DEAL_CONFIDENCE, 5), 'low');
  assert.equal(confidenceFor(tight, 4, DEFAULT_DEAL_CONFIDENCE, 5), 'insufficient');
  assert.equal(confidenceFor(null, 12, DEFAULT_DEAL_CONFIDENCE, 5), 'insufficient');
  assert.equal(confidenceFor({ median: 100, q1: 80, q3: 120, spreadPct: 20 }, 12, DEFAULT_DEAL_CONFIDENCE, 5), 'high');
  assert.equal(confidenceFor({ median: 100, q1: 60, q3: 140, spreadPct: 40 }, 12, DEFAULT_DEAL_CONFIDENCE, 5), 'medium');
});

test('setting check: on a wide search, a comparable in a cluster the subject is not in is dropped', () => {
  const s = DEFAULT_DEAL_COMPS.setting;
  // The subject stands alone; four comps sit together 8 km away, three are scattered.
  const town = [8, 8.1, 8.2, 8.3].map((km) => ({ ...at(km, { listingID: `t${km}` }), distanceKm: km }));
  const scattered = [2, 4.5, 11].map((km) => ({ ...at(km, { listingID: `s${km}` }), distanceKm: km }));
  const r = settingFilter([...scattered, ...town], HOME, 12, true, s, 3);
  assert.equal(r.applied, true);
  assert.equal(r.dropped, 4);
  assert.deepEqual(r.kept.map((c) => c.listingID), ['s2', 's4.5', 's11']);
});

test('setting check: never on a partial read, a narrow search, or when it would leave too few', () => {
  const s = DEFAULT_DEAL_COMPS.setting;
  const town = [8, 8.1, 8.2, 8.3].map((km) => ({ ...at(km), distanceKm: km }));
  const scattered = [2, 4.5, 11].map((km) => ({ ...at(km), distanceKm: km }));
  assert.equal(settingFilter([...scattered, ...town], HOME, 12, false, s, 3).applied, false);
  assert.equal(settingFilter([...scattered, ...town], HOME, 2, true, s, 3).applied, false);
  assert.equal(settingFilter([...scattered, ...town], HOME, 12, true, s, 5).applied, false);
});

test('the pipeline’s comp shape: no monthly history, the listing date only when asked for', () => {
  const l = at(0.4, { listingID: 99, bedrooms: 'Studio', added_on: '2026-01-10', amenities: { parking: true } });
  const c = toReportComp(l);
  assert.equal(c.listingID, '99');
  assert.equal(c.bedrooms, 0);
  assert.deepEqual(c.revenue_ltm_monthly, {});
  assert.deepEqual(c.booked_daily_rate_ltm_monthly, {});
  assert.equal(c.added_on, undefined);
  assert.deepEqual(c.amenities, { parking: true });
  assert.equal(toReportComp(l, true).added_on, '2026-01-10');
});

test('the search box encloses the circle', () => {
  const b = boxAround(HOME.lat, HOME.lng, 5);
  assert.ok(distanceKm(HOME, { lat: b.ne_lat, lng: HOME.lng }) >= 4.99);
  assert.ok(distanceKm(HOME, { lat: HOME.lat, lng: b.ne_lng }) >= 4.99);
  assert.ok(b.sw_lat < HOME.lat && b.sw_lng < HOME.lng);
});

test('Airbtics’ bedrooms filter: 1–5 as numbers, 6+ as "6+", studios left to the client', () => {
  assert.deepEqual(bedroomsFilter(3), [3]);
  assert.deepEqual(bedroomsFilter(7), ['6+']);
  assert.equal(bedroomsFilter(0), null);
});
