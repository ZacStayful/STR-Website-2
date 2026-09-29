/**
 * Batch 19's promises that live in how files are put together, not in a
 * function: pinned by reading the source, so a later edit that breaks one
 * fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('the root layout renders TrackingRoot after the page, so the page reads its own address first', () => {
  const src = read('src/app/layout.tsx');
  const children = src.indexOf('{children}');
  const root = src.indexOf('<TrackingRoot');
  assert.ok(children > 0 && root > children);
  // The pixel id only reaches the browser on a production build.
  assert.match(src, /pixelId=\{pixelEnabled\(\) \? metaPixelId\(\) : null\}/);
});

test('the pixel is set up with no automatic events before init, and never by the standard snippet', () => {
  const src = read('src/lib/meta/pixel.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code, /disablePushState = true/);
  const autoConfig = code.indexOf("fbq('set', 'autoConfig', false, pixelId)");
  const init = code.indexOf("fbq('init'");
  assert.ok(autoConfig > 0 && init > autoConfig, 'autoConfig off before init');
  assert.doesNotMatch(code, /noscript/i);
  assert.doesNotMatch(code, /fbq\('track'/, 'every send goes through the checked call()');
  // Every send checks the live address first.
  assert.match(code, /function call\([^)]*\)[^{]*\{\s*if \(!canSendNow\(\)\) return false;/);
  assert.match(code, /isCleanForSend\(window\.location\.href\)/);
});

test('every page is served with a referrer policy that never carries a path or query', () => {
  const src = read('next.config.ts');
  assert.match(src, /source: "\/:path\*"/);
  assert.match(src, /key: "Referrer-Policy", value: "strict-origin"/);
});

test('the Conversions API token is never read in browser code', () => {
  for (const path of ['src/lib/meta/pixel.ts', 'src/lib/tracking/runtime.ts', 'src/lib/tracking/browser.ts', 'src/components/tracking/TrackingRoot.tsx', 'src/components/tracking/CookieSettingsLink.tsx']) {
    assert.doesNotMatch(read(path), /META_CAPI_ACCESS_TOKEN|capiToken|serverSendMode/, path);
  }
});
