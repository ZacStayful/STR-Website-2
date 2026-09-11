import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMiles } from './geo.ts';
import { areaCentroid } from './area-centroids.ts';

test('Manchester ↔ Leeds centroids are roughly 35–45 miles apart', () => {
  const d = haversineMiles(areaCentroid('M')!, areaCentroid('LS')!);
  assert.ok(d > 30 && d < 50, `got ${d}`);
});

test('London Bridge ↔ Edinburgh Waverley ≈ 332 miles', () => {
  const d = haversineMiles({ lat: 51.5045, lng: -0.0865 }, { lat: 55.952, lng: -3.1883 });
  assert.ok(Math.abs(d - 332) < 4, `got ${d}`);
});

test('every area has a centroid inside the UK bounding box', () => {
  // (BT / Northern Ireland is not in the GeoJSON yet.)
  for (const code of ['AB', 'TR', 'ZE', 'M', 'E']) {
    const c = areaCentroid(code)!;
    assert.ok(c.lat > 49.5 && c.lat < 61 && c.lng > -8.5 && c.lng < 2, code);
  }
});
