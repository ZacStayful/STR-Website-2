import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateSlots,
  callAffordable,
  checkOf,
  checkOutcome,
  daySpend,
  GEOCODE_PENCE,
  MAX_CHECK_ATTEMPTS,
  reportRowFor,
  shortlistExpiryAt,
  shortlistOrder,
  storedCheckFrom,
  subjectKindFor,
  ukDayStart,
  validCheckFor,
  worstCasePence,
  type StoredCheck,
} from './checks.ts';
import type { ShortLetData, DataQuality } from '../types.ts';

const NOW = new Date('2026-09-29T07:00:00Z');

function check(over: Partial<StoredCheck> = {}): StoredCheck {
  return {
    checkedAt: '2026-09-28T03:45:00.000Z',
    via: 'daily',
    gross: 48_789,
    adr: 165,
    occupancy: 0.71,
    compCount: 12,
    spreadPct: 10.3,
    confidence: 'high',
    radiusKm: 0.8,
    calls: 1,
    pence: 5,
    bedrooms: 1,
    kind: 'sale',
    locationClass: 'urban',
    kindRelaxed: false,
    ...over,
  };
}

test('a stored check reads back from the screening, and anything malformed reads as none', () => {
  const c = check();
  assert.deepEqual(checkOf({ band: 'qualified', check: c }), c);
  assert.deepEqual(checkOf({ band: 'qualified', check: JSON.parse(JSON.stringify(c)) }), c, 'survives the JSON round trip');
  assert.equal(checkOf({ band: 'qualified' }), null);
  assert.equal(checkOf(null), null);
  assert.equal(checkOf({ check: { ...c, gross: 0 } }), null, 'no figure is no check');
  assert.equal(checkOf({ check: { ...c, checkedAt: 'never' } }), null);
  assert.equal(checkOf({ check: { ...c, confidence: 'insufficient' } }), null);
  assert.equal(checkOf({ check: { ...c, kind: 'auction' } }), null);
  const loose = checkOf({ check: { gross: '48789', bedrooms: '1', checkedAt: c.checkedAt, confidence: 'low', kind: 'rent' } });
  assert.equal(loose?.gross, 48_789);
  assert.equal(loose?.via, 'daily');
  assert.equal(loose?.compCount, 0);
});

test('a check is good for validDays, for the same kind and bedrooms', () => {
  const c = check();
  const listing = { bedrooms: 1, kind: 'sale' as const };
  assert.deepEqual(validCheckFor(c, listing, 180, NOW), c);
  assert.equal(validCheckFor(c, listing, 1, new Date('2026-10-01T00:00:00Z')), null, 'expired');
  assert.equal(validCheckFor(c, { bedrooms: 2, kind: 'sale' }, 180, NOW), null, 'the listing now says two beds');
  assert.equal(validCheckFor(c, { bedrooms: 1, kind: 'rent' }, 180, NOW), null, 'a rental is another deal');
  assert.deepEqual(validCheckFor(c, { bedrooms: null, kind: 'sale' }, 180, NOW), c, 'a listing that no longer states bedrooms keeps the check');
  assert.equal(validCheckFor(null, listing, 180, NOW), null);
  assert.equal(validCheckFor(check({ checkedAt: '2027-01-01T00:00:00Z' }), listing, 180, NOW), null, 'a check from the future is not trusted');
});

test('the UK day starts at London midnight: UTC in winter, an hour earlier in summer', () => {
  assert.equal(ukDayStart(new Date('2026-09-29T07:00:00Z')).toISOString(), '2026-09-28T23:00:00.000Z');
  assert.equal(ukDayStart(new Date('2026-09-28T23:30:00Z')).toISOString(), '2026-09-28T23:00:00.000Z', '00:30 London on the 29th');
  assert.equal(ukDayStart(new Date('2026-09-28T22:30:00Z')).toISOString(), '2026-09-27T23:00:00.000Z', 'still the 28th in London');
  assert.equal(ukDayStart(new Date('2026-12-10T10:00:00Z')).toISOString(), '2026-12-10T00:00:00.000Z');
  assert.equal(shortlistExpiryAt(NOW, { shortlistExpiryDays: 7 }), '2026-10-06T07:00:00.000Z');
});

test('slots: each stream its share, no more than it has waiting, spare passed top areas → low entry → rent-to-rent', () => {
  const split = { top60: 6, low_entry: 8, r2r: 6, project: 0 };
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 20, r2r: 10, project: 0 }, 20), { top60: 6, low_entry: 8, r2r: 6, project: 0 });
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 2, r2r: 10, project: 0 }, 20), { top60: 12, low_entry: 2, r2r: 6, project: 0 }, 'low entry has two: the spare six go to top areas first');
  assert.deepEqual(allocateSlots(split, { top60: 7, low_entry: 2, r2r: 10, project: 0 }, 20), { top60: 7, low_entry: 2, r2r: 10, project: 0 }, 'then on to rent-to-rent');
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 20, r2r: 10, project: 0 }, 5), { top60: 5, low_entry: 0, r2r: 0, project: 0 }, 'the day allows five more');
  assert.deepEqual(allocateSlots(split, { top60: 0, low_entry: 0, r2r: 0, project: 0 }, 20), { top60: 0, low_entry: 0, r2r: 0, project: 0 });
  assert.deepEqual(allocateSlots(split, { top60: 3, low_entry: 3, r2r: 3, project: 0 }, 0), { top60: 0, low_entry: 0, r2r: 0, project: 0 }, 'nothing left today');
});

test('Batch 17: Project candidates have their own count of comparables checks, on top of the day’s, never taking another stream’s slot', () => {
  const split = { top60: 6, low_entry: 8, r2r: 6, project: 5 };
  // The day's 20 go to the three streams exactly as before; the Project stream has its own five.
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 20, r2r: 10, project: 9 }, 20, 5), { top60: 6, low_entry: 8, r2r: 6, project: 5 });
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 20, r2r: 10, project: 2 }, 20, 5), { top60: 6, low_entry: 8, r2r: 6, project: 2 }, 'unused Project slots are not handed to the others');
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 2, r2r: 10, project: 9 }, 20, 5), { top60: 12, low_entry: 2, r2r: 6, project: 5 }, 'and the others’ spare never goes to Project');
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 20, r2r: 10, project: 9 }, 20, 2), { top60: 6, low_entry: 8, r2r: 6, project: 2 }, 'today’s runs have used three of the five');
  assert.deepEqual(allocateSlots(split, { top60: 30, low_entry: 20, r2r: 10, project: 9 }, 20), { top60: 6, low_entry: 8, r2r: 6, project: 0 }, 'without a Project count, none');
});

test('the shortlist order: most profitable first, then longest waiting', () => {
  const rows = [
    { id: 'a', annual_profit: 8_000, first_seen_at: '2026-09-20T00:00:00Z' },
    { id: 'b', annual_profit: '12000', first_seen_at: '2026-09-25T00:00:00Z' },
    { id: 'c', annual_profit: null, first_seen_at: '2026-09-01T00:00:00Z' },
    { id: 'd', annual_profit: 8_000, first_seen_at: '2026-09-10T00:00:00Z' },
  ];
  assert.deepEqual(shortlistOrder(rows).map((r) => r.id), ['b', 'd', 'a', 'c']);
});

test('the day’s spend is summed over every checking run started today, whatever the job', () => {
  const day = ukDayStart(NOW);
  const runs = [
    { startedAt: '2026-09-29T03:40:00Z', summary: { rawCostPence: 35, checked: { top60: 3, low_entry: 2, r2r: 1 } } },
    { startedAt: '2026-09-29T04:00:00Z', summary: { rawCostPence: '20.5', checked: { top60: 1 } } },
    { startedAt: '2026-09-28T04:00:00Z', summary: { rawCostPence: 100, checked: { top60: 20 } } },
    { startedAt: '2026-09-29T05:00:00Z', summary: null },
  ];
  assert.deepEqual(daySpend(runs, day), { runs: 3, checked: { top60: 4, low_entry: 2, r2r: 1, project: 0 }, pence: 55.5 });
  assert.equal(callAffordable(100, 55.5, 5), true);
  assert.equal(callAffordable(100, 95.5, 5), false);
  assert.equal(callAffordable(100, 95, 5), true, 'exactly at the cap');
  assert.equal(worstCasePence({ maxCallsPerCheck: 3 }, 5, false), 15);
  assert.equal(worstCasePence({ maxCallsPerCheck: 3 }, 5, true), 15 + GEOCODE_PENCE);
  assert.equal(MAX_CHECK_ATTEMPTS, 3);
});

test('the portal’s type text becomes the search’s idea of the property', () => {
  assert.equal(subjectKindFor('Flat'), 'flat');
  assert.equal(subjectKindFor('2 bedroom apartment'), 'flat');
  assert.equal(subjectKindFor('Terraced house'), 'house');
  assert.equal(subjectKindFor('Detached bungalow'), 'house');
  assert.equal(subjectKindFor(null), 'unknown');
  assert.equal(subjectKindFor('Land'), 'unknown', 'not flat, not house: no kind test');
});

test('what a check means: no figure is never shown, a figure under the bar retires, else shown', () => {
  assert.equal(checkOutcome(false, true), 'insufficient');
  assert.equal(checkOutcome(true, false), 'unqualified');
  assert.equal(checkOutcome(true, true), 'shown');
});

test('the stored check rounds its figures and remembers the listing it was made for', () => {
  const c = storedCheckFrom(
    { gross: 48_788.6, adr: 164.7, occupancy: 0.71234, compCount: 12, spreadPct: 10.34, confidence: 'high', locationClass: 'urban' },
    { radiusKm: 0.8, calls: 1, pence: 5.004, kindRelaxed: false },
    { bedrooms: 1, kind: 'sale' },
    'daily',
    new Date('2026-09-28T03:45:00Z'),
  );
  assert.deepEqual(c, check({ gross: 48_789, adr: 165, occupancy: 0.712, spreadPct: 10.3, pence: 5 }));
});

test('the analyser_reports row a check writes: the analyser’s shape, keyed on the deal, the outward code only, no address', () => {
  const data = {
    annualRevenue: 48_789,
    monthlyRevenue: [3000, 3000, 3500, 4000, 4500, 5000, 5500, 5500, 4500, 3800, 3200, 3289],
    occupancyRate: 0.71,
    averageDailyRate: 165,
    activeListings: 40,
    comparables: [
      { title: 'Flat A', url: 'https://airbnb.com/rooms/1', bedrooms: 1, accommodates: 2, averageDailyRate: 160, occupancyRate: 0.7, annualRevenue: 40_000, rating: 4.8, reviewCount: 50, listingAge: 2, daysAvailable: 300, amenityCount: 20 },
      { title: 'Flat B', url: 'https://airbnb.com/rooms/2', bedrooms: 1, accommodates: 2, averageDailyRate: 170, occupancyRate: 72, annualRevenue: 44_000, rating: 4.6, reviewCount: 30, listingAge: 4, daysAvailable: 320, amenityCount: 22 },
    ],
    locationClass: 'urban',
  } as unknown as ShortLetData;
  const quality: DataQuality = { comparablesFound: 12, comparablesTarget: 12, searchRadiusKm: 0.8, searchBroadened: false, level: 'high', disclaimer: null };
  const row = reportRowFor({ dealId: 'deal-1', checkedAt: '2026-09-28T03:45:00.000Z', outcode: 'yo10', postcodeArea: 'yo', bedrooms: 1, guests: 4, lat: 53.95, lng: -1.08, check: check(), data, quality });
  assert.equal(row.source, 'deal_comps');
  assert.equal(row.request_id, 'deal-1');
  assert.equal(row.address, null);
  assert.equal(row.postcode, 'YO10', 'the outward code, never the full postcode');
  assert.equal(row.postcode_area, 'YO');
  assert.equal(row.gross_revenue, 48_789);
  assert.equal(row.adr, 165);
  assert.equal(row.occupancy, 71, 'a percentage, as the analyser writes it');
  assert.equal(row.comp_count, 12);
  assert.equal(row.comp_radius_km, 0.8);
  assert.equal(row.comp_avg_annual_revenue, 42_000);
  assert.equal(row.comp_avg_occupancy, 71, 'mixed scales normalised');
  assert.equal(row.comp_avg_rating, 4.7);
  assert.equal(row.active_listings, 40);
  assert.equal(row.extraction_status, 'ok');
  const raw = row.raw_response as { shortLet: Record<string, unknown>; dataQuality: DataQuality; property: Record<string, unknown>; dealCheck: Record<string, unknown> };
  assert.equal(raw.shortLet.locationClass, 'urban');
  assert.equal((raw.shortLet.comparables as unknown[]).length, 2);
  assert.equal(raw.dataQuality.level, 'high');
  assert.deepEqual(raw.property, { bedrooms: 1, guests: 4 });
  assert.equal(raw.dealCheck.dealId, 'deal-1');
  const text = JSON.stringify(row);
  assert.ok(!/rightmove|onthemarket|zoopla|High Street/i.test(text), 'no listing, no address');
});
