import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserConversion, parseMeAnswer, SIGNED_OUT } from './me.ts';

const H = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

test('a signed-out answer is the empty answer', () => {
  assert.deepEqual(parseMeAnswer({ signedIn: false }), SIGNED_OUT);
});

test('anything malformed is nothing to act on', () => {
  for (const v of [null, undefined, 'x', 1, [], {}, { signedIn: 'yes' }]) assert.equal(parseMeAnswer(v), null);
});

test('a member answer keeps only well-formed values', () => {
  const a = parseMeAnswer({
    signedIn: true,
    who: H,
    choice: 'accept',
    excluded: false,
    pixel: { em: H2, external_id: H, name: 'Jo' },
    pending: [
      { key: 'Purchase:pi_1', name: 'Purchase', eventId: 'pi_1', valuePence: 1000 },
      { key: 'X:1', name: 'Lead', eventId: 'e1', valuePence: null },
      { key: 'FirstReport:u', name: 'FirstReport', eventId: 'bad id with spaces', valuePence: null },
    ],
  });
  assert.ok(a);
  assert.equal(a.who, H);
  assert.equal(a.choice, 'accept');
  assert.deepEqual(a.pixel, { em: H2, external_id: H });
  assert.deepEqual(a.pending, [{ key: 'Purchase:pi_1', name: 'Purchase', eventId: 'pi_1', valuePence: 1000 }]);
});

test('an unhashed email never reaches the pixel', () => {
  const a = parseMeAnswer({ signedIn: true, pixel: { em: 'jo@example.com', external_id: H } });
  assert.deepEqual(a?.pixel, { em: null, external_id: H });
  assert.equal(parseMeAnswer({ signedIn: true, pixel: { em: H, external_id: 'user-1' } })?.pixel, null);
});

test('a conversion needs a key, a known event and a clean event id', () => {
  assert.deepEqual(parseBrowserConversion({ key: 'Subscribe:u', name: 'Subscribe', eventId: 'in_1', valuePence: 999.6 }), {
    key: 'Subscribe:u',
    name: 'Subscribe',
    eventId: 'in_1',
    valuePence: 1000,
  });
  assert.equal(parseBrowserConversion({ key: '', name: 'Subscribe', eventId: 'in_1' }), null);
  assert.equal(parseBrowserConversion({ key: 'k', name: 'Subscribe', eventId: 'in_1', valuePence: -5 }), null);
  assert.equal(parseBrowserConversion({ key: 'k', name: 'Subscribe', eventId: 'in_1', valuePence: '10' }), null);
});

test('at most ten conversions are taken from one answer', () => {
  const pending = Array.from({ length: 15 }, (_, i) => ({ key: `Purchase:pi_${i}`, name: 'Purchase', eventId: `pi_${i}`, valuePence: 1000 }));
  assert.equal(parseMeAnswer({ signedIn: true, pending })?.pending.length, 10);
});
