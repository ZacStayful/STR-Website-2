import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk } from './analysis.ts';
import type { DemandDrivers, LongLetData, ShortLetData } from './types.ts';

const shortLet: ShortLetData = {
  annualRevenue: 40_000,
  monthlyRevenue: [3000, 3100, 3200, 3300, 3400, 3500, 3600, 3500, 3400, 3300, 3200, 3100],
  occupancyRate: 0.75,
  averageDailyRate: 250,
  activeListings: 40,
  comparables: [],
};
const longLet: LongLetData = { monthlyRent: 1200, estimateHigh: 1380, estimateLow: 1020, comparables: [] };
const amenities: DemandDrivers = { hospitals: [], universities: [], airports: [], trainStations: [], busStations: [], subwayStations: [] };
const events = { totalEvents: 0 };

test('only a High flood rating raises the guest damage factor, and nothing else moves', () => {
  const base = assessRisk(shortLet, longLet, amenities, events);
  assert.equal(base.guestDamage, 'low', 'a £250 ADR property starts low');
  const flooded = assessRisk(shortLet, longLet, amenities, events, { floodRisk: 'High' });
  assert.equal(flooded.guestDamage, 'high');
  assert.ok(flooded.overallScore > base.overallScore);
  for (const key of ['incomeVolatility', 'setupCost', 'regulatory', 'seasonality', 'platformDependency', 'locationDemand', 'competition'] as const) {
    assert.equal(flooded[key], base[key], key);
  }
  for (const level of ['Medium', 'Low', 'Very Low', null, undefined]) {
    assert.deepEqual(assessRisk(shortLet, longLet, amenities, events, { floodRisk: level }), base, String(level));
  }
});
