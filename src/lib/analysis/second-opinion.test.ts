import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparableRows, monthIndex, monthRows } from './second-opinion.ts';

test('month labels in either form', () => {
  assert.equal(monthIndex('2025-03'), 2);
  assert.equal(monthIndex('2025-12-01'), 11);
  assert.equal(monthIndex('March'), 2);
  assert.equal(monthIndex('sep'), 8);
  assert.equal(monthIndex('?'), null);
});

test('twelve rows, ours beside PMI’s, gaps as null', () => {
  const rows = monthRows([100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210], [{ month: '2025-01', revenue: 95.4 }, { month: 'July', revenue: 170 }]);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0], { month: 'Jan', ours: 100, pmi: 95 });
  assert.deepEqual(rows[6], { month: 'Jul', ours: 160, pmi: 170 });
  assert.equal(rows[1].pmi, null);
  assert.equal(monthRows(null, null)[0].ours, null);
});

test('comparables nearest first, only safe links', () => {
  const rows = comparableRows([
    { title: 'Far', revenue: 20000, adr: 100, occupancy: 0.6, rating: 4.8, url: 'javascript:alert(1)', distanceM: 3000 },
    { title: 'Near', revenue: 24000, adr: 120, occupancy: 72, rating: 4.9, url: 'https://www.airbnb.co.uk/rooms/1', distanceM: 400 },
  ]);
  assert.equal(rows[0].title, 'Near');
  assert.equal(rows[0].distance, '400 m');
  assert.equal(rows[0].occupancyPct, 72);
  assert.equal(rows[1].occupancyPct, 60);
  assert.equal(rows[1].url, null);
});
