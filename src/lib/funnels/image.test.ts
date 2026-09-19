import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImage, extensionFor, uploadRejectionReason, ALLOWED_LOGO_MIMES } from './image.ts';
import { LOGO_MAX_BYTES } from './brand.ts';

/** Real file headers, padded to a plausible size. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, ...new Array(64).fill(0)]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(64).fill(0)]);
const bytes = (s: string) => new TextEncoder().encode(s);

test('a real PNG and JPEG are recognised', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
});

test('every JPEG variant starts the same way', () => {
  // JFIF, Exif and the rest all share FF D8 FF; only the fourth byte differs.
  for (const fourth of [0xe0, 0xe1, 0xdb, 0xee]) {
    assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, fourth, 0, 0])), 'image/jpeg');
  }
});

test('anything else sniffs as nothing', () => {
  assert.equal(sniffImage(PDF), null);
  assert.equal(sniffImage(GIF), null);
  assert.equal(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(new Uint8Array()), null);
});

test('a truncated header is not mistaken for a match', () => {
  // The PNG check needs 8 bytes and the JPEG check 3; a prefix shorter than
  // that must not pass on a partial comparison.
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8])), null);
});

test('the extension comes from the sniffed type', () => {
  assert.equal(extensionFor('image/png'), '.png');
  assert.equal(extensionFor('image/jpeg'), '.jpg');
});

test('a usable file is not rejected', () => {
  assert.equal(uploadRejectionReason(PNG), null);
  assert.equal(uploadRejectionReason(JPEG), null);
});

test('an empty file is refused', () => {
  assert.match(uploadRejectionReason(new Uint8Array()) ?? '', /empty/i);
});

test('an over-size file is refused, with both numbers in the message', () => {
  const big = new Uint8Array(LOGO_MAX_BYTES + 1);
  big.set(PNG.slice(0, 8));
  const reason = uploadRejectionReason(big) ?? '';
  assert.match(reason, /2\.0 MB|2 MB/, 'says the limit');
  assert.match(reason, /smaller/i, 'says what to do about it');
});

test('size is checked before format, so a huge PNG is told the real problem', () => {
  const big = new Uint8Array(LOGO_MAX_BYTES + 1);
  big.set(PNG.slice(0, 8));
  assert.doesNotMatch(uploadRejectionReason(big) ?? '', /not a PNG/i);
});

test('a PDF is named as a PDF', () => {
  // The same wording a pasted PDF link already gets, so the two paths do not
  // explain the same refusal differently.
  assert.match(uploadRejectionReason(PDF) ?? '', /PDF cannot be used/i);
});

test('an SVG is named, and says why the PDF report is the problem', () => {
  const reason = uploadRejectionReason(bytes('<svg xmlns="x"></svg>')) ?? '';
  assert.match(reason, /SVG/i);
  assert.match(reason, /PDF report/i);
});

test('an XML-declared SVG is still recognised', () => {
  assert.match(uploadRejectionReason(bytes('<?xml version="1.0"?><svg/>')) ?? '', /SVG/i);
});

test('leading whitespace does not hide an SVG', () => {
  assert.match(uploadRejectionReason(bytes('\n  <svg/>')) ?? '', /SVG/i);
});

test('a GIF and a WebP are each named', () => {
  assert.match(uploadRejectionReason(GIF) ?? '', /GIF/i);
  const webp = new Uint8Array(16);
  webp.set(bytes('RIFF'), 0);
  webp.set(bytes('WEBP'), 8);
  assert.match(uploadRejectionReason(webp) ?? '', /WebP/i);
});

test('a renamed file gets the message that actually explains it', () => {
  // The trap: someone renames report.pdf to logo.png. The extension is a
  // claim, not evidence, and the message has to say so or they will try the
  // exact same thing again.
  const reason = uploadRejectionReason(bytes('this is plain text pretending to be a png')) ?? '';
  assert.match(reason, /Renaming a file does not change its format/i);
});

test('every refusal explains itself rather than just failing', () => {
  for (const sample of [new Uint8Array(), PDF, GIF, bytes('nonsense'), bytes('<svg/>')]) {
    const reason = uploadRejectionReason(sample) ?? '';
    assert.ok(reason.length > 15, `too terse: "${reason}"`);
  }
});

test('the allowed set matches what the sniffer can return', () => {
  // Guards against the set and the sniffer drifting apart.
  assert.deepEqual([...ALLOWED_LOGO_MIMES].sort(), ['image/jpeg', 'image/png']);
  for (const mime of [sniffImage(PNG), sniffImage(JPEG)]) {
    assert.ok(mime && ALLOWED_LOGO_MIMES.has(mime));
  }
});
