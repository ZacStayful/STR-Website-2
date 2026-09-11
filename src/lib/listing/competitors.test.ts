import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseCompetitors, matchTracked, rankCompetitors, gridCell, type TrackedListing } from './competitors.ts';

function l(id: string, revenue: number, over: Partial<TrackedListing> = {}): TrackedListing {
  return { listingId: id, name: id, url: `https://www.airbnb.co.uk/rooms/${id}`, lat: 0, lng: 0, bedrooms: 2, bathrooms: 1, guests: 4, roomType: 'Entire home/apt', propertyType: 'House', annualRevenue: revenue, adr: 100, occupancy: 0.6, reviewCount: 10, rating: 4.8, activeDays: 300, ...over };
}

test('summary uses earning listings for medians and counts same-size', () => {
  const s = summariseCompetitors([l('a', 10000), l('b', 30000, { bedrooms: 3 }), l('c', 0), l('d', 20000)], 2);
  assert.equal(s.count, 4);
  assert.equal(s.earning, 3);
  assert.equal(s.medianRevenue, 20000);
  assert.equal(s.topQuartileRevenue, 25000);
  assert.equal(s.medianAdr, 100);
  assert.equal(s.medianOccupancy, 0.6);
  assert.equal(s.sameSize, 3);
  assert.equal(summariseCompetitors([]).medianRevenue, null);
});

test('matchTracked and rankCompetitors', () => {
  const list = [l('far', 5000, { distanceKm: 2 }), l('none', 0, { distanceKm: 0.1 }), l('near', 8000, { distanceKm: 0.5 })];
  assert.equal(matchTracked(list, 'near')?.annualRevenue, 8000);
  assert.equal(matchTracked(list, 'zzz'), null);
  assert.deepEqual(rankCompetitors(list).map((x) => x.listingId), ['near', 'far', 'none']);
  assert.equal(rankCompetitors(list, 1).length, 1);
});

test('gridCell buckets nearby points together', () => {
  assert.equal(gridCell(53.4539, -2.15971), gridCell(53.4541, -2.1600));
  assert.notEqual(gridCell(53.4539, -2.15971), gridCell(53.4639, -2.15971));
});
