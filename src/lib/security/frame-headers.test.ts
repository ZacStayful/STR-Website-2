import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FRAME_HEADERS } from './frame-headers.ts';

// Next's own matcher for header sources (path-to-regexp, as next.config uses it).
const require = createRequire(import.meta.url);
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp') as { pathToRegexp: (p: string, keys?: unknown[], o?: Record<string, unknown>) => RegExp };

function headersFor(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of FRAME_HEADERS) {
    if (pathToRegexp(rule.source, [], { strict: true, sensitive: false, delimiter: '/' }).test(path)) {
      for (const h of rule.headers) out.set(h.key, h.value);
    }
  }
  return out;
}

test('only /f/* may be framed by other sites', () => {
  // Next redirects a trailing slash away before headers apply.
  for (const p of ['/f/AbCdEfGhIjKlMnOpQrStUvWx']) {
    const h = headersFor(p);
    assert.equal(h.get('Content-Security-Policy'), 'frame-ancestors *', p);
    assert.equal(h.has('X-Frame-Options'), false, p);
  }
});

test('everything else may be framed by this site only', () => {
  for (const p of ['/', '/leads', '/leads/setup/live', '/for-management-companies', '/r/token', '/api/generate-pdf', '/login', '/fees', '/features', '/account/billing', '/admin']) {
    const h = headersFor(p);
    assert.equal(h.get('X-Frame-Options'), 'SAMEORIGIN', p);
    assert.equal(h.get('Content-Security-Policy'), "frame-ancestors 'self'", p);
  }
});
