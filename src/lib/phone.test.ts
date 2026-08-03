import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMobile, mobileVariants } from './phone.ts';

test('folds every UK spelling of the same mobile to one key', () => {
  const expected = '+447537998686';
  assert.equal(normaliseMobile('+447537998686'), expected);
  assert.equal(normaliseMobile('447537998686'), expected);
  assert.equal(normaliseMobile('07537998686'), expected);
  assert.equal(normaliseMobile('7537998686'), expected);
});

test('ignores spaces, brackets and hyphens', () => {
  assert.equal(normaliseMobile('07537 998 686'), '+447537998686');
  assert.equal(normaliseMobile('(07537) 998-686'), '+447537998686');
  assert.equal(normaliseMobile('+44 7537 998686'), '+447537998686');
});

test('the two accounts Hannah Dallison signed up with pool together', () => {
  assert.equal(
    normaliseMobile('+447537998686'),
    normaliseMobile('07537998686'),
  );
});

test('keeps genuinely different numbers apart', () => {
  assert.notEqual(normaliseMobile('07537998686'), normaliseMobile('07873780609'));
});

test('UK landlines pool consistently too', () => {
  assert.equal(normaliseMobile('02079460958'), normaliseMobile('+442079460958'));
  // ...but never collide with a mobile.
  assert.notEqual(normaliseMobile('02079460958'), normaliseMobile('07537998686'));
});

test('does not fold non-UK numbers onto a UK key', () => {
  assert.equal(normaliseMobile('+353861234567'), '+353861234567');
  assert.notEqual(normaliseMobile('+353861234567'), normaliseMobile('07537998686'));
  // An international-prefix (00) number keeps its own identity.
  assert.equal(normaliseMobile('00353861234567'), '00353861234567');
});

test('returns null when there is nothing to match on', () => {
  assert.equal(normaliseMobile(null), null);
  assert.equal(normaliseMobile(undefined), null);
  assert.equal(normaliseMobile(''), null);
  assert.equal(normaliseMobile('   '), null);
});

test('variants cover the spellings actually stored at signup', () => {
  const variants = mobileVariants('+447537998686');
  for (const stored of ['+447537998686', '447537998686', '07537998686', '7537998686']) {
    assert.ok(variants.includes(stored), `missing variant ${stored}`);
  }
});

test('every variant normalises back to the original key', () => {
  const key = '+447537998686';
  for (const variant of mobileVariants(key)) {
    assert.equal(normaliseMobile(variant), key);
  }
});

test('non-UK keys are looked up verbatim', () => {
  assert.deepEqual(mobileVariants('+353861234567'), ['+353861234567']);
});
