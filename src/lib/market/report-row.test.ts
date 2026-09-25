import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toReportRow } from './report-row.ts';

test('a database row is normalised: numbers parsed, occupancy as a percentage, district from the postcode', () => {
  const r = toReportRow({ id: 'abc', created_at: '2026-08-01T00:00:00+00:00', source: 'analyser', postcode: 'l1 8jq', postcode_area: 'l', bedrooms: '2', adr: '150', occupancy: '0.55', gross_revenue: '30000', comp_avg_rating: '4.7', comp_avg_review_count: 'abc', monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  assert.equal(r.postcode_area, 'L');
  assert.equal(r.district, 'L1');
  assert.equal(r.bedrooms, 2);
  assert.equal(r.adr, 150);
  assert.equal(r.occupancy, 55);
  assert.equal(r.gross_revenue, 30000);
  assert.equal(r.comp_avg_rating, 4.7);
  assert.equal(r.comp_avg_review_count, null);
  assert.deepEqual(r.monthly, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('invalid monthly arrays and missing postcodes become null', () => {
  assert.equal(toReportRow({ monthly: null }).monthly, null);
  assert.equal(toReportRow({ monthly: [1, 2, 3] }).monthly, null);
  assert.equal(toReportRow({ monthly: Array.from({ length: 12 }, () => 'x') }).monthly, null);
  const r = toReportRow({ postcode: null, postcode_area: 'NG', occupancy: 62 });
  assert.equal(r.district, null);
  assert.equal(r.occupancy, 62);
  assert.equal(r.source, 'unknown');
});

test('the analyser quality verdict is carried through, and absent means null', () => {
  const judged = toReportRow({ comparables_found: 12, quality_level: ' High ' });
  assert.equal(judged.comparables_found, 12);
  assert.equal(judged.quality_level, 'high');
  const asText = toReportRow({ comparables_found: '0', quality_level: 'low' });
  assert.equal(asText.comparables_found, 0);
  assert.equal(asText.quality_level, 'low');
  const backfill = toReportRow({ comparables_found: null, quality_level: null });
  assert.equal(backfill.comparables_found, null);
  assert.equal(backfill.quality_level, null);
  const missing = toReportRow({});
  assert.equal(missing.comparables_found, null);
  assert.equal(missing.quality_level, null);
});
