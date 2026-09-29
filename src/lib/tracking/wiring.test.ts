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

test('conversions in code already running after the response are awaited; request ones use logConversion', () => {
  const analyse = read('src/app/api/analyse/route.ts');
  assert.match(analyse, /await recordConversion\(\{ name: 'FirstReport'/);
  const deal = read('src/lib/analysis/deal-analysis.ts');
  const start = deal.indexOf('const [{ error: doneErr }] = await Promise.all([');
  const awaited = deal.slice(start, deal.indexOf(']);', start));
  assert.match(awaited, /recordConversion\(\{ name: 'FirstReport', userId: purchase\.buyer_id \}\)/, 'inside the awaited Promise.all');
  assert.doesNotMatch(analyse + deal, /logConversion/);
  assert.match(read('src/lib/stripe/deps.ts'), /recordConversion: \(c\) => recordConversion\(c\)/);
  assert.match(read('src/lib/profile/server.ts'), /await logConversion\(\{ name: 'ProfileComplete', userId \}\)/);
  assert.match(read('src/app/api/billing/topup/route.ts'), /await logConversion\(\{ name: 'Purchase'/);
});

test('sign-up and sign-in bring the cookie choice across first, then attribution, then CompleteRegistration', () => {
  const src = read('src/lib/tracking/signup-server.ts');
  for (const fn of ['export async function onEmailSignup', 'export async function onSignIn']) {
    const body = src.slice(src.indexOf(fn), src.indexOf('\n}\n', src.indexOf(fn)));
    const consent = Math.max(body.indexOf('attachDevice('), body.indexOf('recordChoice('));
    const attribution = body.indexOf('saveAttribution(');
    const conversion = body.indexOf("recordConversion({ name: 'CompleteRegistration'");
    assert.ok(consent > 0 && attribution > consent && conversion > attribution, fn);
  }
  for (const path of ['src/app/auth/callback/route.ts', 'src/app/auth/confirm/route.ts', 'src/app/(auth)/actions.ts']) assert.match(read(path), /onSignIn\(/, path);
  assert.match(read('src/app/(auth)/actions.ts'), /onEmailSignup\(/);
});
