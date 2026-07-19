import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminEmail } from './admin.ts';

test('matches the default admin email', () => {
  assert.equal(isAdminEmail('zac@stayful.co.uk'), true);
});

test('is case-insensitive and trims whitespace', () => {
  assert.equal(isAdminEmail('  ZAC@Stayful.CO.UK '), true);
});

test('rejects non-admin emails', () => {
  assert.equal(isAdminEmail('someone@example.com'), false);
});

test('rejects null / undefined / empty', () => {
  assert.equal(isAdminEmail(null), false);
  assert.equal(isAdminEmail(undefined), false);
  assert.equal(isAdminEmail(''), false);
});

test('honours the ADMIN_EMAILS env override', () => {
  const prev = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'a@x.com, B@Y.com';
  try {
    assert.equal(isAdminEmail('a@x.com'), true);
    assert.equal(isAdminEmail('b@y.com'), true);
    // default admin no longer matches when the env override is set
    assert.equal(isAdminEmail('zac@stayful.co.uk'), false);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prev;
  }
});
