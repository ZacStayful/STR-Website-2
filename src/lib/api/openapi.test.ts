import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES, openApiDocument, API_VERSION } from './openapi.ts';
import { SCOPES, isScope } from './scopes.ts';

const V1_DIR = new URL('../../app/api/v1/', import.meta.url).pathname;

/**
 * Walks the v1 route files and reads which HTTP methods each one exports.
 *
 * This is what makes "the spec cannot drift" true rather than merely
 * claimed: a route added without a spec entry, or an entry left behind after
 * a route is deleted, fails here. An agent trusts this document, so a spec
 * that has quietly stopped matching is worse than no spec at all.
 */
function routesOnDisk(): Array<{ path: string; method: string }> {
  const found: Array<{ path: string; method: string }> = [];

  const walk = (dir: string, urlPath: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // "openapi.json" is a directory holding the spec route itself, which
        // is not part of the API surface it describes.
        if (entry === 'openapi.json') continue;
        // [id] on disk is {id} in an OpenAPI path.
        const segment = entry.startsWith('[') && entry.endsWith(']') ? `{${entry.slice(1, -1)}}` : entry;
        walk(full, `${urlPath}/${segment}`);
      } else if (entry === 'route.ts' || entry === 'route.tsx') {
        const src = readFileSync(full, 'utf8');
        for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
          if (new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(src)) {
            found.push({ path: urlPath || '/', method: method.toLowerCase() });
          }
        }
      }
    }
  };

  walk(V1_DIR, '');
  return found;
}

test('every route on disk is described in the spec', () => {
  const described = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  for (const r of routesOnDisk()) {
    assert.ok(
      described.has(`${r.method} ${r.path}`),
      `${r.method.toUpperCase()} ${r.path} exists but is missing from ROUTES in openapi.ts`,
    );
  }
});

test('every route in the spec exists on disk', () => {
  const onDisk = new Set(routesOnDisk().map((r) => `${r.method} ${r.path}`));
  for (const r of ROUTES) {
    assert.ok(
      onDisk.has(`${r.method} ${r.path}`),
      `${r.method.toUpperCase()} ${r.path} is documented but no such route file exports it`,
    );
  }
});

test('the spec found the routes at all', () => {
  // Guards the two tests above against silently passing on an empty walk if
  // the directory ever moves.
  assert.ok(routesOnDisk().length >= 10, 'expected to find the v1 routes on disk');
});

test('every declared scope is a real scope', () => {
  for (const r of ROUTES) {
    if (r.scope === null) continue;
    assert.ok(isScope(r.scope), `${r.path} declares an unknown scope ${r.scope}`);
  }
});

test('only the analyse route spends credit', () => {
  const spending = ROUTES.filter((r) => r.spends).map((r) => r.path);
  assert.deepEqual(spending, ['/analyse']);
  // And it is the only one behind the analyse scope, so a key without it
  // cannot cost its owner anything.
  assert.deepEqual(ROUTES.filter((r) => r.scope === 'analyse').map((r) => r.path), ['/analyse']);
});

test('every scope is reachable through at least one route', () => {
  // A scope a customer can tick that grants access to nothing is a promise
  // the product does not keep.
  const used = new Set(ROUTES.map((r) => r.scope).filter(Boolean));
  for (const s of SCOPES) {
    assert.ok(used.has(s), `${s} can be granted but no route requires it`);
  }
});

test('the document is valid OpenAPI 3.1 with every path present', () => {
  const doc = openApiDocument('https://stayful.co.uk') as {
    openapi: string;
    info: { version: string };
    servers: Array<{ url: string }>;
    paths: Record<string, Record<string, unknown>>;
  };
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.info.version, API_VERSION);
  assert.equal(doc.servers[0].url, 'https://stayful.co.uk/api/v1');

  for (const r of ROUTES) {
    assert.ok(doc.paths[r.path], `${r.path} missing from paths`);
    assert.ok(doc.paths[r.path][r.method], `${r.method} ${r.path} missing`);
  }
});

test('a path parameter is always marked required', () => {
  const doc = openApiDocument('https://x.test') as {
    paths: Record<string, Record<string, { parameters?: Array<{ in: string; required: boolean }> }>>;
  };
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const op of Object.values(methods)) {
      for (const p of op.parameters ?? []) {
        if (p.in === 'path') assert.equal(p.required, true, `${path} has an optional path parameter`);
      }
    }
  }
});

test('every route documents the whole error vocabulary', () => {
  // An agent should be able to read one operation and know every code it can
  // receive, rather than discovering 402 in production.
  const doc = openApiDocument('https://x.test') as {
    paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  };
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      for (const status of ['400', '401', '402', '403', '404', '429', '500']) {
        assert.ok(op.responses[status], `${method} ${path} does not document ${status}`);
      }
    }
  }
});

test('operation ids are unique', () => {
  const doc = openApiDocument('https://x.test') as {
    paths: Record<string, Record<string, { operationId: string }>>;
  };
  const ids = Object.values(doc.paths).flatMap((m) => Object.values(m).map((o) => o.operationId));
  assert.equal(new Set(ids).size, ids.length, 'duplicate operationId — generated clients would collide');
});
