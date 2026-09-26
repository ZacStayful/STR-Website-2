import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTemplate, fillTemplate, mailtoHref, tidyLine } from './render.ts';

test('fills known fields', () => {
  assert.equal(fillTemplate('Hello {name}.', { name: 'Zac' }), 'Hello Zac.');
});

test('a bracket is kept whole when every field inside is known', () => {
  assert.equal(fillTemplate('View the property[ at {address}].', { address: '1 High St' }), 'View the property at 1 High St.');
  assert.equal(fillTemplate('Our clients in[ {town} and] the area.', { town: 'Leeds' }), 'Our clients in Leeds and the area.');
});

test('a bracket drops whole when any field inside is missing', () => {
  assert.equal(fillTemplate('View the property[ at {address}].', {}), 'View the property.');
  assert.equal(fillTemplate('View the [{bedrooms} ]property[ at {address}][, listed at {price}].', { price: '£1' }), 'View the property, listed at £1.');
  assert.equal(fillTemplate('X[ {a} and {b}] y.', { a: '1' }), 'X y.');
  assert.equal(fillTemplate('Our clients in[ {town} and] the area.', { town: '  ' }), 'Our clients in the area.');
});

test('a bare missing field drops its whole line, never prints a placeholder', () => {
  assert.equal(fillTemplate('One\nOffer: {amount}\nTwo', {}), 'One\nTwo');
});

test('a line left empty or only punctuation is removed', () => {
  assert.equal(fillTemplate('Thanks,\n[{memberName}]', {}), 'Thanks,');
  assert.equal(fillTemplate('Hi\n[- {item}]\nBye', {}), 'Hi\nBye');
});

test('paragraph breaks are kept, one at most in a row, none at the ends', () => {
  const t = '\nHello,\n\n[{gone}]\n\nMore.\n\n\nEnd.\n';
  assert.equal(fillTemplate(t, {}), 'Hello,\n\nMore.\n\nEnd.');
});

test('values are inserted once: a value never becomes template syntax', () => {
  assert.equal(fillTemplate('At {address}.', { address: 'Unit [2] {x}' }), 'At Unit [2] {x}.');
  assert.equal(fillTemplate('At[ {address}].', { address: 'a\n  b' }), 'At a b.');
});

test('tidyLine cleans what a dropped bracket leaves', () => {
  assert.equal(tidyLine('the  property , listed .'), 'the property, listed.');
  assert.equal(tidyLine('a ( ) b'), 'a b');
  assert.equal(tidyLine('one, . two'), 'one. two');
});

test('mailtoHref encodes subject and body with CRLF line breaks and no recipient', () => {
  const href = mailtoHref('Offer: 1 High St & Co', 'Hello,\n\nThanks');
  assert.ok(href.startsWith('mailto:?subject='));
  assert.equal(decodeURIComponent(href.split('&body=')[1]), 'Hello,\r\n\r\nThanks');
  assert.equal(decodeURIComponent(href.split('&body=')[0].replace('mailto:?subject=', '')), 'Offer: 1 High St & Co');
});

test('checkTemplate catches every way an edit could show a raw field', () => {
  const opts = { allowed: ['address', 'town'], bareAllowed: false };
  assert.deepEqual(checkTemplate('Fine[ at {address}].', opts), []);
  assert.ok(checkTemplate('Bad {address}.', opts).some((p) => p.includes('inside [brackets]')));
  assert.ok(checkTemplate('Bad[ {postcode}].', opts).some((p) => p.includes('unknown field')));
  assert.ok(checkTemplate('Bad[ [{address}]].', opts).some((p) => p.includes('inside a bracket')));
  assert.ok(checkTemplate('Bad[ {address}', opts).some((p) => p.includes('not closed')));
  assert.ok(checkTemplate('Bad] {address}', opts).some((p) => p.includes('with no [')));
  assert.ok(checkTemplate('Bad[ nothing].', opts).some((p) => p.includes('no {field}')));
  assert.ok(checkTemplate('Bad[ { address}].', opts).some((p) => p.includes('not a {field}')));
  assert.ok(checkTemplate('Great!', opts).some((p) => p.includes('exclamation')));
  assert.deepEqual(checkTemplate('Fine {address}.', { allowed: ['address'], bareAllowed: true }), []);
});
