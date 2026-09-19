import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOPES, parseScopes, hasScope, isScope, scopesAreEmpty, spendsCredit,
  READ_ONLY_SCOPES, SCOPE_LABELS, type Scope,
} from './scopes.ts';

test('a valid list round-trips in canonical order', () => {
  // Two keys with the same reach must read identically, whatever order they
  // were minted in.
  assert.deepEqual(parseScopes(['leads:read', 'analyse']), ['analyse', 'leads:read']);
  assert.deepEqual(parseScopes(['analyse', 'leads:read']), ['analyse', 'leads:read']);
});

test('an unrecognised scope is dropped rather than carried', () => {
  assert.deepEqual(parseScopes(['leads:read', 'admin', 'billing:write', '']), ['leads:read']);
  assert.equal(isScope('admin'), false);
  assert.equal(isScope('leads:read'), true);
});

test('nonsense parses to no scopes, not to every scope', () => {
  for (const bad of [null, undefined, 'leads:read', 42, {}]) {
    assert.deepEqual(parseScopes(bad), [], JSON.stringify(bad));
  }
});

test('duplicates collapse', () => {
  assert.deepEqual(parseScopes(['analyse', 'analyse', 'analyse']), ['analyse']);
});

test('write does not imply read', () => {
  // Convenient, and deliberately not done: "write implies read" is how a key
  // ends up doing more than its owner meant.
  const held: Scope[] = ['leads:write'];
  assert.equal(hasScope(held, 'leads:write'), true);
  assert.equal(hasScope(held, 'leads:read'), false);
});

test('an empty key holds nothing at all', () => {
  const held = parseScopes([]);
  assert.equal(scopesAreEmpty(held), true);
  for (const s of SCOPES) assert.equal(hasScope(held, s), false, `${s} should not be held`);
});

test('only the analyse scope can spend credit', () => {
  assert.equal(spendsCredit(READ_ONLY_SCOPES), false);
  assert.equal(spendsCredit(['leads:write']), false);
  assert.equal(spendsCredit(['analyse']), true);
});

test('the read-only default really is read-only', () => {
  for (const s of READ_ONLY_SCOPES) {
    assert.ok(!s.endsWith(':write') && s !== 'analyse', `${s} is not read-only`);
  }
});

test('every scope has a label a person can read', () => {
  // Guards against a new scope being added to the union and turning up in
  // the minting UI with no explanation of what it lets a key do.
  for (const s of SCOPES) {
    assert.ok((SCOPE_LABELS[s] ?? '').length > 0, `${s} has no label`);
  }
});
