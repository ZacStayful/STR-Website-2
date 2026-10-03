import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLUG_PATTERN } from './config.ts';
import { CHIP_ORDER } from '../intelligence/config.ts';
import { checkContent, renderEntry, SAMPLE_MEMBER } from './render.ts';
import { LEGACY_REFS, SEED, refToSlug } from './seed.ts';
import { schemaSnapshot } from './test-fixtures.ts';

test('every seed passes the approval checks against the schema seeds', () => {
  const g = schemaSnapshot();
  for (const e of SEED) {
    const c = checkContent(e, g);
    assert.deepEqual(c.errors, [], `${e.slug}: ${c.errors.join(' | ')}`);
  }
});

test('slugs are unique and valid; every chip has an entry on the view', () => {
  const slugs = SEED.map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, SLUG_PATTERN);
  for (const chip of CHIP_ORDER) {
    const e = SEED.find((x) => x.slug === chip);
    assert.ok(e, `chip ${chip} has no seed entry`);
    assert.ok(e.channels.includes('view'), chip);
  }
});

test('every seed renders for a sample member', () => {
  const g = schemaSnapshot({ callsLive: true });
  for (const e of SEED) {
    const r = renderEntry(e, g, SAMPLE_MEMBER);
    assert.equal(r.kind, 'ok', `${e.slug}: ${JSON.stringify(r)}`);
  }
});

test('the old knowledge ids all point at seed slugs', () => {
  const slugs = new Set(SEED.map((e) => e.slug));
  for (const [old, slug] of Object.entries(LEGACY_REFS)) assert.ok(slugs.has(slug), `${old} → ${slug}`);
  assert.equal(refToSlug('[faq.3]'), 'bold_claims');
  assert.equal(refToSlug(' [credits] '), 'credits');
  assert.equal(refToSlug(''), null);
});
