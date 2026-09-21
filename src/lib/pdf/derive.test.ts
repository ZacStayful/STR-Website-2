import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveReportData } from './derive.ts';
import { sampleAnalysis } from './__fixtures__/sample.ts';

// This module was untestable until its `@/lib/scores` import became relative:
// node --test cannot resolve the alias.

test('the town comes from the geocoder when the analysis captured one', () => {
  const d = deriveReportData(sampleAnalysis({ locality: 'Leicester' }));
  assert.equal(d.property.locality, 'Leicester');
  assert.equal(d.property.addressLine, '22 Princess Road West');
  assert.equal(d.property.postcode, 'LE1 6TE');
});

test('an older report with no stored town falls back to the address', () => {
  const d = deriveReportData(sampleAnalysis({ locality: null }));
  assert.equal(d.property.locality, 'Leicester', 'parsed out of the address string');
});

test('an address with nothing to parse still renders', () => {
  const d = deriveReportData(sampleAnalysis({ locality: null, address: 'Rose Cottage' }));
  assert.equal(d.property.addressLine, 'Rose Cottage');
  // The outward code stands in, so the header never shows a stray separator.
  assert.equal(d.property.locality, 'LE1');
});

test('the issued date is the report\'s own, not the clock', () => {
  // The prospect's link re-renders on every click; a wall-clock date would
  // change each time they opened the same report.
  const d = deriveReportData(sampleAnalysis());
  assert.equal(d.issuedAt, '18.09.2026');
});

test('amenities are read from the comparable set', () => {
  const d = deriveReportData(sampleAnalysis());
  assert.equal(d.amenities.derived, true);
  // Every one of the twelve comparables has WiFi and a kitchen.
  assert.ok(d.amenities.essential.some((a) => a.name === 'WiFi' && a.score === 5));
  assert.ok(d.amenities.essential.some((a) => a.name === 'Kitchen'));
  // One in twelve has a hot tub.
  assert.ok(d.amenities.differentiators.some((a) => a.name === 'Hot tub'));
  for (const band of [d.amenities.essential, d.amenities.recommended, d.amenities.differentiators]) {
    for (const a of band) assert.ok(a.score >= 1 && a.score <= 5, `${a.name}=${a.score}`);
  }
});

test('a report saved before amenities were captured still renders', () => {
  const d = deriveReportData(sampleAnalysis({ noAmenityData: true }));
  assert.equal(d.amenities.derived, false, 'flagged as the standing recommendation');
  assert.ok(d.amenities.essential.length > 0, 'falls back rather than showing nothing');
  assert.equal(d.amenities.premium, null);
});

test('the platform fee saved is the fee the owner actually pays', () => {
  const standard = deriveReportData(sampleAnalysis());
  assert.equal(standard.growth.platformFeeSavingsPct, 15);
  const custom = deriveReportData(sampleAnalysis(), {
    platformPct: 12, mgmtPct: 15, cleaningMonthly: null, selfManaged: false,
  });
  assert.equal(custom.growth.platformFeeSavingsPct, 12);
});

test('the direct-booking share sits inside the band the report quotes', () => {
  const d = deriveReportData(sampleAnalysis());
  assert.ok(d.growth.directBookingPctMonth36 >= 30 && d.growth.directBookingPctMonth36 <= 50);
  // A location with no demand drivers at all still lands inside the band.
  const bare = deriveReportData(sampleAnalysis({ noDemandDrivers: true }));
  assert.ok(bare.growth.directBookingPctMonth36 >= 30 && bare.growth.directBookingPctMonth36 <= 50);
});

test('stay length and repeat guests come from real booking counts', () => {
  const d = deriveReportData(sampleAnalysis());
  assert.ok(d.growth.avgStayNights, 'derived from bookings and booked nights');
  assert.ok(d.growth.avgStayNights! >= 2 && d.growth.avgStayNights! <= 6, `got ${d.growth.avgStayNights}`);
  assert.ok(d.growth.repeatCustomers! > 0);
});

test('without booking counts the repeat figure is withheld, not invented', () => {
  const d = deriveReportData(sampleAnalysis({ noBookings: true }));
  assert.equal(d.growth.avgStayNights, null);
  assert.equal(d.growth.repeatCustomers, null);
  // Everything else still derives.
  assert.ok(d.growth.extraMonthlyProfitYr3 > 0);
});

test('self-managed removes the management fee from the breakdown', () => {
  const d = deriveReportData(sampleAnalysis(), {
    platformPct: 15, mgmtPct: 0, cleaningMonthly: null, selfManaged: true,
  });
  assert.equal(d.shortLetAnnual.managementFee, 0);
  assert.equal(d.shortLetAnnual.selfManaged, true);
  assert.ok(d.shortLetAnnual.net > 0);
});

test('a missing valuation leaves the value strip off rather than showing zero', () => {
  const d = deriveReportData(sampleAnalysis({ noValuation: true }));
  assert.equal(d.overview.valueConservative, null);
  assert.equal(d.overview.valueUpper, null);
});

test('the twelve-month forecast is complete and flags its peaks', () => {
  const d = deriveReportData(sampleAnalysis());
  assert.equal(d.monthly.length, 12);
  assert.ok(d.monthly.some((m) => m.peak));
  assert.ok(!d.monthly.every((m) => m.peak), 'not every month is a peak');
  for (const m of d.monthly) {
    assert.ok(Number.isFinite(m.net) && m.net >= 0);
    assert.ok(m.occupancy >= 0 && m.occupancy <= 1);
  }
});

test('a single comparable does not break the benchmark', () => {
  const one = sampleAnalysis();
  const d = deriveReportData(sampleAnalysis({ comparables: [one.shortLet.comparables[0]] }));
  assert.equal(d.compsBenchmark.count, 1);
  assert.ok(Number.isFinite(d.compsBenchmark.avgNightly));
  assert.ok(Number.isFinite(d.marketTargets.beatNightly));
  // Too thin to read a market from, so the standing recommendation stands in.
  assert.equal(d.amenities.derived, false);
});

test('no comparables at all still produces a renderable report', () => {
  const d = deriveReportData(sampleAnalysis({ comparables: [] }));
  assert.equal(d.comparables.length, 0);
  for (const v of [d.compsBenchmark.avgNightly, d.compsBenchmark.avgOccupancy, d.marketTargets.beatRevenue]) {
    assert.ok(Number.isFinite(v), 'never NaN — it would blank an SVG coordinate');
  }
  assert.equal(d.growth.repeatCustomers, null);
});
