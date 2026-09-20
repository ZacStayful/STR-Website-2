import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmailFrom, safeDisplayName, brandedFrom, safeReplyTo } from './from.ts';

const ENV_FROM = 'Stayful <hello@stayful.co.uk>';

test('a Name <addr> sender parses into both halves', () => {
  assert.deepEqual(parseEmailFrom(ENV_FROM), { name: 'Stayful', address: 'hello@stayful.co.uk' });
  assert.deepEqual(parseEmailFrom('"Stayful Ltd" <hello@stayful.co.uk>'), { name: 'Stayful Ltd', address: 'hello@stayful.co.uk' });
});

test('a bare address parses with no name', () => {
  assert.deepEqual(parseEmailFrom('hello@stayful.co.uk'), { name: null, address: 'hello@stayful.co.uk' });
});

test('nonsense does not parse', () => {
  for (const bad of [null, undefined, '', '   ', 'not an address', 'two words@x']) {
    assert.equal(parseEmailFrom(bad), null, JSON.stringify(bad));
  }
});

test('the customer’s name becomes the display name, our address stays', () => {
  assert.equal(brandedFrom(ENV_FROM, 'Northern Lets'), '"Northern Lets" <hello@stayful.co.uk>');
});

test('a newline in the company name cannot rewrite the headers', () => {
  // The attack this module exists for: a company name carrying CRLF would
  // otherwise let the rest of the header block be rewritten — a different
  // recipient, a different reply-to, anything.
  const evil = 'Acme\r\nBcc: victim@example.com';
  const from = brandedFrom(ENV_FROM, evil);

  // The property that matters is that no line break survives. Once the CRLF
  // is gone the remaining text is inert: it sits inside the quoted display
  // name and renders as a silly sender name, not as a header.
  assert.ok(from && !from.includes('\r') && !from.includes('\n'), 'no line breaks survive');
  assert.equal(from, '"Acme Bcc: victim@example.com" <hello@stayful.co.uk>');

  // And exactly one address, ours.
  assert.equal((from ?? '').match(/</g)?.length, 1);
  assert.ok((from ?? '').endsWith('<hello@stayful.co.uk>'));
});

test('quotes and angle brackets cannot escape the display name', () => {
  const from = brandedFrom(ENV_FROM, 'Acme" <attacker@evil.com> "');
  assert.equal(from, '"Acme attacker@evil.com" <hello@stayful.co.uk>');
  // Exactly one address, and it is ours.
  assert.equal((from ?? '').match(/</g)?.length, 1);
  assert.ok((from ?? '').endsWith('<hello@stayful.co.uk>'));
});

test('control characters are stripped', () => {
  assert.equal(safeDisplayName('Acme\u0000\u0007Ltd'), 'Acme Ltd');
  assert.equal(safeDisplayName('Acme\tLtd'), 'Acme Ltd');
});

test('a very long name is capped rather than sent whole', () => {
  const name = safeDisplayName('x'.repeat(500));
  assert.ok(name && name.length <= 64);
});

test('an unusable name falls back to the configured sender, not to nothing', () => {
  // An email from us beats an email from nobody.
  for (const bad of [null, undefined, '', '   ', '"""', '<<<>>>']) {
    assert.equal(brandedFrom(ENV_FROM, bad), ENV_FROM, JSON.stringify(bad));
  }
});

test('no configured sender means no email at all', () => {
  assert.equal(brandedFrom(undefined, 'Northern Lets'), null);
  assert.equal(brandedFrom('rubbish', 'Northern Lets'), null);
});

test('the display name is always quoted, so punctuation is safe', () => {
  // "Smith, Jones & Co" unquoted is two addresses to a strict parser.
  assert.equal(brandedFrom(ENV_FROM, 'Smith, Jones and Co'), '"Smith Jones and Co" <hello@stayful.co.uk>');
  assert.equal(brandedFrom(ENV_FROM, 'Acme Ltd.'), '"Acme Ltd." <hello@stayful.co.uk>');
});

test('a plausible reply-to is kept', () => {
  assert.equal(safeReplyTo('dana@northernlets.co.uk'), 'dana@northernlets.co.uk');
});

test('anything that could be a second header is refused as a reply-to', () => {
  for (const bad of [
    'dana@x.com\r\nBcc: evil@x.com',
    'dana@x.com, evil@x.com',
    'Dana <dana@x.com>',
    'dana@x.com; evil@x.com',
    'not an email',
    '',
    null,
    'a@b',
  ]) {
    assert.equal(safeReplyTo(bad), null, JSON.stringify(bad));
  }
});
