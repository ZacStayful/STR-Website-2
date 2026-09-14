import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_META, areaMetaForCode, areaMetaForSlug } from './areas.ts';
import { AREA_REGION } from './regions.ts';
import { AREA_CENTROIDS, MANUAL_CENTROIDS } from './area-centroids.ts';
import { districtLocalities, listedDistricts } from './district-localities.ts';

test('every postcode area with a region or a centroid has a place name, never the "<CODE> postcode area" fallback', () => {
  const codes = new Set([...Object.keys(AREA_REGION), ...Object.keys(AREA_CENTROIDS), ...Object.keys(MANUAL_CENTROIDS)].map((c) => c.toUpperCase()));
  for (const code of codes) {
    const meta = areaMetaForCode(code);
    assert.doesNotMatch(meta.name, /postcode area/, `${code} has no place name`);
    assert.notEqual(meta.slug, code.toLowerCase(), `${code} has no proper slug`);
  }
});

test('codes and slugs are unique and round-trip, and the bare code is an alias for the named slug', () => {
  const codes = AREA_META.map((a) => a.code);
  const slugs = AREA_META.map((a) => a.slug);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const a of AREA_META) {
    assert.equal(areaMetaForSlug(a.slug)?.code, a.code);
    assert.equal(areaMetaForSlug(a.code.toLowerCase())?.slug, a.slug, `${a.code} alias`);
  }
  assert.equal(areaMetaForCode('bd').name, 'Bradford');
  assert.equal(areaMetaForSlug('nottingham')?.code, 'NG');
  assert.equal(areaMetaForSlug('not-a-place'), null);
});

test('an unknown two-letter code still gets a page with the generated fallback', () => {
  assert.equal(areaMetaForCode('ZZ').name, 'ZZ postcode area');
  assert.equal(areaMetaForSlug('zz')?.code, 'ZZ');
});

test('every listed district belongs to a named area, is upper-case and has at least one locality', () => {
  for (const d of listedDistricts()) {
    assert.match(d, /^[A-Z]{1,2}\d{1,2}$/, d);
    const area = d.replace(/\d+$/, '');
    assert.doesNotMatch(areaMetaForCode(area).name, /postcode area/, `${d} is in an unnamed area`);
    const locs = districtLocalities(d);
    assert.ok(locs.length >= 1, `${d} has no locality`);
    assert.ok(locs.every((l) => l.length > 1), `${d} has a blank locality`);
  }
  assert.deepEqual(districtLocalities('le2').slice(0, 2), ['Clarendon Park', 'Knighton']);
  assert.deepEqual(districtLocalities('ZZ1'), []);
});

test('every postcode area has at least one district with localities', () => {
  const byArea = new Map<string, number>();
  for (const d of listedDistricts()) {
    const area = d.replace(/\d+$/, '');
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  for (const a of AREA_META) assert.ok((byArea.get(a.code) ?? 0) > 0, `${a.code} (${a.name}) has no districts listed`);
  assert.ok(listedDistricts().length > 2000, `only ${listedDistricts().length} districts listed`);
});
