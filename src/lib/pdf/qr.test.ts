import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeQr } from './qr.ts';

const BOOKING = 'https://calendly.com/zac-stayful/call';

const fingerprint = (rows: boolean[][]) =>
  createHash('sha256')
    .update(rows.map((r) => r.map((b) => (b ? '1' : '0')).join('')).join(''))
    .digest('hex');

/**
 * This encoder was verified module-for-module against the `qrcode` npm package
 * across every payload length from 13 to 213 bytes (versions 1–10): the grid is
 * identical at any given mask. That package is not a dependency, so this golden
 * fingerprint stands in for it — if a refactor silently changes the output, an
 * unscannable code cannot reach a customer's report unnoticed.
 */
test('the booking code matches its verified fingerprint', () => {
  const m = encodeQr(BOOKING);
  assert.equal(m.size, 29, 'version 3');
  assert.equal(
    fingerprint(m.rows),
    'b411d7d499d5d7831560717ad1007b66b6437c6cdbbdee61a04cf8edeea91145',
  );
});

test('the symbol is square and the version scales with the payload', () => {
  for (const text of ['https://a.co/x', BOOKING, `https://a.co/${'x'.repeat(150)}`]) {
    const m = encodeQr(text);
    assert.equal(m.rows.length, m.size);
    for (const row of m.rows) assert.equal(row.length, m.size);
    // Every version is 17 + 4v modules across.
    assert.equal((m.size - 17) % 4, 0);
  }
  assert.ok(encodeQr(`https://a.co/${'x'.repeat(150)}`).size > encodeQr('https://a.co/x').size);
});

test('all three finder patterns are present and well-formed', () => {
  const { size, rows } = encodeQr(BOOKING);
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    // Dark 7x7 border...
    for (let i = 0; i < 7; i += 1) {
      assert.ok(rows[top][left + i], `top edge (${top},${left})`);
      assert.ok(rows[top + 6][left + i], `bottom edge (${top},${left})`);
      assert.ok(rows[top + i][left], `left edge (${top},${left})`);
      assert.ok(rows[top + i][left + 6], `right edge (${top},${left})`);
    }
    // ...a light ring...
    assert.equal(rows[top + 1][left + 1], false);
    assert.equal(rows[top + 1][left + 5], false);
    // ...and a solid 3x3 core.
    for (let r = 2; r <= 4; r += 1) {
      for (let c = 2; c <= 4; c += 1) assert.ok(rows[top + r][left + c]);
    }
  }
});

test('the timing patterns alternate', () => {
  const { size, rows } = encodeQr(BOOKING);
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(rows[6][i], i % 2 === 0, `horizontal timing at ${i}`);
    assert.equal(rows[i][6], i % 2 === 0, `vertical timing at ${i}`);
  }
});

test('the dark module is always set', () => {
  const { size, rows } = encodeQr(BOOKING);
  assert.equal(rows[size - 8][8], true);
});

test('an over-long payload throws rather than emitting a broken code', () => {
  // Better a CTA with no QR than a code on a customer's report that will not scan.
  assert.throws(() => encodeQr('x'.repeat(300)), /exceeds/);
});

test('different URLs produce different symbols', () => {
  assert.notEqual(
    fingerprint(encodeQr('https://calendly.com/stayful').rows),
    fingerprint(encodeQr(BOOKING).rows),
  );
});
