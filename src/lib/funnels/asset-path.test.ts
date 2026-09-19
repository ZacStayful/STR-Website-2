import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoStoragePath, ourStoragePath, BRAND_BUCKET } from './asset-path.ts';

const USER = '11111111-2222-3333-4444-555555555555';
const FUNNEL = '99999999-8888-7777-6666-555555555555';
const BASE = `https://abc.supabase.co/storage/v1/object/public/${BRAND_BUCKET}/`;

test('a path is scoped to the customer', () => {
  const path = logoStoragePath(USER, FUNNEL, 'deadbeef', '.png');
  assert.equal(path, `brand/${USER}/${FUNNEL}-deadbeef.png`);
  assert.ok(path.startsWith(`brand/${USER}/`), 'the user id is what makes assets attributable');
});

test('a URL we wrote round-trips back to its path', () => {
  const path = logoStoragePath(USER, FUNNEL, 'deadbeef', '.png');
  assert.equal(ourStoragePath(BASE + path), path);
});

test('a query string or fragment does not defeat the match', () => {
  const path = logoStoragePath(USER, FUNNEL, 'abc123', '.jpg');
  assert.equal(ourStoragePath(`${BASE}${path}?v=2`), path);
  assert.equal(ourStoragePath(`${BASE}${path}#x`), path);
});

test('someone else’s URL is not ours to delete', () => {
  // The case this exists for: a customer pasted a link to a logo on their
  // own website, then replaced it. That file is not ours to touch.
  for (const url of [
    'https://theircompany.co.uk/assets/logo.png',
    'https://cdn.example.com/logo.png',
    'https://abc.supabase.co/storage/v1/object/public/other-bucket/brand/x/y.png',
  ]) {
    assert.equal(ourStoragePath(url), null, url);
  }
});

test('a path in our bucket but not our layout is refused', () => {
  // Only the exact shape we write. Anything else was put there by something
  // that is not this code.
  for (const path of [
    'brand/not-a-uuid/file.png',
    'brand/file.png',
    'other/11111111-2222-3333-4444-555555555555/file.png',
    `brand/${USER}/nested/file.png`,
    '',
  ]) {
    assert.equal(ourStoragePath(BASE + path), null, path || '(empty)');
  }
});

test('traversal is refused outright', () => {
  assert.equal(ourStoragePath(`${BASE}brand/${USER}/../../../secret.png`), null);
  assert.equal(ourStoragePath(`${BASE}../../other/file.png`), null);
});

test('nothing is not a path', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(ourStoragePath(v), null);
  }
});

test('both extensions we write are accepted back', () => {
  for (const ext of ['.png', '.jpg']) {
    const path = logoStoragePath(USER, FUNNEL, 'aa11', ext);
    assert.equal(ourStoragePath(BASE + path), path);
  }
});
