import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compFieldsFrom, fileMatchesAddress, locationFor, planRemovals, postcodeFromAddress, type BackfillRow } from './backfill.ts';

const ADDRESS = 'Flat 76, Velocity West, 5 City Walk, Leeds, West Yorkshire, LS11 9BG';
const row = (id: string, over: Partial<BackfillRow> = {}): BackfillRow => ({
  id,
  created_at: '2026-07-16T17:05:00Z',
  item: '11555761968',
  filename: 'Stayful_Property_Analysis_City_Walk__Holbeck__Leeds.pdf',
  address: ADDRESS,
  bedrooms: 1,
  gross_revenue: 75_498,
  adr: 331,
  occupancy: 62,
  ...over,
});

test('the postcode comes out of the item address; none when it only has an outcode', () => {
  assert.equal(postcodeFromAddress(ADDRESS), 'LS11 9BG');
  assert.equal(postcodeFromAddress('12 High St, York yo10 5dd'), 'YO10 5DD');
  assert.equal(postcodeFromAddress('Clifton, York, YO30'), null);
  assert.equal(postcodeFromAddress(null), null);
});

test('a file is for the address when its name shares two place words with it', () => {
  assert.equal(fileMatchesAddress('Stayful_Property_Analysis_City_Walk__Holbeck__Leeds.pdf', ADDRESS), true);
  assert.equal(fileMatchesAddress('Stayful_Property_Analysis_Velocity_West__5_City_Walk__Holbeck__Leeds__West_Yorkshire.pdf', ADDRESS), true);
  assert.equal(fileMatchesAddress('Stayful_Property_Analysis_Bradford.pdf', ADDRESS), false);
  assert.equal(fileMatchesAddress('Stayful_Property_Analysis_Leeds.pdf', ADDRESS), false, 'one shared word is not enough');
  assert.equal(fileMatchesAddress(null, ADDRESS), false);
});

test('one file under an item takes the address postcode; several need their name to match', () => {
  assert.deepEqual(locationFor(row('a', { filename: 'Anything.pdf' }), 1), { postcode: 'LS11 9BG' });
  assert.deepEqual(locationFor(row('b'), 3), { postcode: 'LS11 9BG' });
  assert.deepEqual(locationFor(row('c', { filename: 'Stayful_Property_Analysis_Bradford.pdf' }), 3), { skip: 'file_not_for_address' });
  assert.deepEqual(locationFor(row('d', { address: 'Leeds, LS11' }), 1), { skip: 'no_postcode' });
});

test('exact duplicates go whatever the file was called, the newest stays', () => {
  const rows = [
    row('old', { created_at: '2026-07-16T17:05:00Z' }),
    row('new', { created_at: '2026-07-16T17:06:00Z', filename: 'Stayful_Property_Analysis_Velocity_West__5_City_Walk__Holbeck__Leeds__West_Yorkshire.pdf' }),
    row('other-property', { gross_revenue: 41_000, adr: 150, occupancy: 70, bedrooms: 2, filename: 'Stayful_Property_Analysis_Bradford.pdf' }),
  ];
  assert.deepEqual(planRemovals(rows), [{ id: 'old', reason: 'exact_duplicate', keptId: 'new' }]);
});

test('a re-analysis of the same file keeps the last one inserted; different properties all stay', () => {
  const rows = [
    row('first', { created_at: '2026-07-16T17:05:00Z', gross_revenue: 70_000 }),
    row('second', { created_at: '2026-07-16T17:07:00Z', gross_revenue: 72_500 }),
    row('elsewhere', { filename: 'Stayful_Property_Analysis_Clifton_York.pdf', gross_revenue: 38_000 }),
  ];
  assert.deepEqual(planRemovals(rows), [{ id: 'first', reason: 'reanalysed', keptId: 'second' }]);
});

test('a failed extraction is never anyone\'s duplicate, and rows without an item are left alone', () => {
  const rows = [row('x', { gross_revenue: null, adr: null, occupancy: null, filename: 'a.pdf' }), row('y', { gross_revenue: null, adr: null, occupancy: null, filename: 'b.pdf' }), row('z', { item: null }), row('w', { item: null })];
  assert.deepEqual(planRemovals(rows), []);
});

test('the comparables\' figures come from the PDF read, occupancy as a percentage', () => {
  assert.deepEqual(compFieldsFrom({ comp_count: 12, comp_radius_km: 0.4, comp_avg_adr: 253, comp_avg_occupancy: 52, comp_avg_annual_revenue: 48_695 }), {
    comp_count: 12,
    comp_radius_km: 0.4,
    comp_avg_adr: 253,
    comp_avg_occupancy: 52,
    comp_avg_annual_revenue: 48_695,
  });
  assert.equal(compFieldsFrom({ comp_avg_occupancy: 0.52 }).comp_avg_occupancy, 52);
  assert.deepEqual(compFieldsFrom(null), { comp_count: null, comp_radius_km: null, comp_avg_adr: null, comp_avg_occupancy: null, comp_avg_annual_revenue: null });
});
