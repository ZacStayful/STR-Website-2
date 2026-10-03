import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFact, sensitiveTopic } from './facts-rules.ts';

test('only a confirmed fact is kept', () => {
  assert.deepEqual(checkFact({ fact: 'Prefers 2-bed flats near stations', confirmed: false }), { ok: false, reason: 'not_confirmed' });
  assert.deepEqual(checkFact({ fact: 'Prefers 2-bed flats near stations', confirmed: 'yes' }), { ok: false, reason: 'not_confirmed' });
  assert.deepEqual(checkFact({ fact: '  Prefers 2-bed   flats near stations ', asked: 'Want me to remember that?', confirmed: true }), { ok: true, fact: 'Prefers 2-bed flats near stations', asked: 'Want me to remember that?' });
});

test('property preferences and what the profile already holds are fine', () => {
  for (const f of ['Has a mortgage in principle', 'Wants rent-to-rent in Leeds', 'Looking to buy within three months', 'Budget up to £200k', 'Prefers houses with parking', 'Funding with a bridging loan']) {
    assert.equal(checkFact({ fact: f, confirmed: true }).ok, true, f);
  }
});

test('sensitive topics are refused', () => {
  assert.equal(sensitiveTopic('Has a bad back from surgery'), 'health');
  assert.equal(sensitiveTopic('Is going through a divorce'), 'money');
  assert.equal(sensitiveTopic('Her husband wants Leeds'), 'people');
  assert.equal(sensitiveTopic('Has a CCJ'), 'money');
  assert.equal(sensitiveTopic('Is on universal credit'), 'money');
  assert.equal(sensitiveTopic('Goes to church on Sundays'), 'identity');
  assert.equal(sensitiveTopic('Wants a short-let near the station'), null);
  assert.equal(checkFact({ fact: 'Pregnant, wants a bungalow', confirmed: true }).ok, false);
});

test('contact and card details are refused', () => {
  for (const f of ['Email me at sam@example.com', 'Call 07700 900123', 'Lives at LS6 2AB', 'See www.example.com']) {
    const r = checkFact({ fact: f, confirmed: true });
    assert.equal(r.ok, false, f);
  }
});

test('empty and too long', () => {
  assert.equal(checkFact({ fact: '   ', confirmed: true }).ok, false);
  assert.equal(checkFact({ fact: 'x'.repeat(161), confirmed: true }).ok, false);
});
