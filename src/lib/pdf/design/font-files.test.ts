import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FONT_FILES, FONT_DIR, fontPath } from './font-files.ts';

/**
 * Fonts are the one thing in this app read from disk at render time, so a
 * packaging mistake is invisible until a customer's report comes out in
 * Helvetica. These assertions fail the build instead.
 */

test('every registered font file is actually present', () => {
  for (const file of FONT_FILES) {
    const p = fontPath(file);
    assert.ok(p, `${file} is missing from ${FONT_DIR}`);
    assert.ok(fs.statSync(p as string).size > 1000, `${file} is implausibly small`);
  }
});

test('a missing file resolves to null rather than a bad path', () => {
  // This is what makes the Helvetica fallback reachable instead of a throw
  // from deep inside renderToBuffer.
  assert.equal(fontPath('NotAFont-Regular.ttf'), null);
});

test('the files are real TrueType, not an error page or a web format', () => {
  // Downloading fonts is fiddly: an HTML 404 body and a WOFF wrapper both
  // arrive as a plausible-looking file. fontkit rejects them at render time.
  for (const file of FONT_FILES) {
    const head = fs.readFileSync(fontPath(file) as string).subarray(0, 4);
    const sfnt = head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00;
    assert.ok(sfnt, `${file} is not a TrueType file (magic ${head.toString('hex')})`);
  }
});

test('both weights of both families are registered', () => {
  // react-pdf throws "Font family not registered" if a style asks for a weight
  // that was never registered, so the set has to stay complete.
  assert.equal(FONT_FILES.length, 4);
  assert.ok(FONT_FILES.some((f) => f.startsWith('DMSans-Regular')));
  assert.ok(FONT_FILES.some((f) => f.startsWith('DMSans-Bold')));
  assert.ok(FONT_FILES.some((f) => f.startsWith('JetBrainsMono-Regular')));
  assert.ok(FONT_FILES.some((f) => f.startsWith('JetBrainsMono-Medium')));
});
