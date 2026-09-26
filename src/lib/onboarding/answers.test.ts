import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWelcomeAnswers, areaCodesFrom, WELCOME_FIELDS } from './answers.ts';

const form = (fields: Record<string, string>) => (k: string) => (k in fields ? fields[k] : null);

test('buy near a postcode', () => {
  const r = parseWelcomeAnswers(form({ kind: 'sale', budget: '200-350', where: 'near', postcode: 'ng2 5gb', maxDistanceMiles: '50' }));
  assert.ok(r.ok);
  assert.deepEqual(r.answers, { kind: 'sale', budget: '200-350', maxRentPcm: null, where: 'near', postcode: 'NG2 5GB', maxDistanceMiles: 50, areas: [] });
});

test('rent-to-rent with a ceiling in chosen areas', () => {
  const r = parseWelcomeAnswers(form({ kind: 'rent', maxRentPcm: '£1,500', budget: '500+', where: 'areas', areas: 'ng, M,zz,ng' }));
  assert.ok(r.ok);
  assert.equal(r.answers.budget, null, 'a budget band is ignored for rent-only');
  assert.equal(r.answers.maxRentPcm, 1500);
  assert.deepEqual(r.answers.areas, ['NG', 'M']);
  assert.equal(r.answers.postcode, null);
});

test('both keeps a budget and a ceiling; anywhere carries no place', () => {
  const r = parseWelcomeAnswers(form({ kind: 'both', budget: 'u200', maxRentPcm: '2000', where: 'anywhere' }));
  assert.ok(r.ok);
  assert.equal(r.answers.budget, 'u200');
  assert.equal(r.answers.maxRentPcm, 2000);
  assert.equal(r.answers.where, 'anywhere');
  assert.deepEqual(r.answers.areas, []);
  assert.equal(r.answers.postcode, null);
  assert.equal(r.answers.maxDistanceMiles, null);
});

test('"not sure yet" is an empty budget or ceiling, stored as null', () => {
  const r = parseWelcomeAnswers(form({ kind: 'both', budget: '', maxRentPcm: '', where: 'anywhere' }));
  assert.ok(r.ok);
  assert.equal(r.answers.budget, null);
  assert.equal(r.answers.maxRentPcm, null);
  const junk = parseWelcomeAnswers(form({ kind: 'sale', budget: 'silly', where: 'anywhere' }));
  assert.ok(junk.ok);
  assert.equal(junk.answers.budget, null);
});

test('a rent ceiling outside the sane band is refused rather than silently dropped', () => {
  const r = parseWelcomeAnswers(form({ kind: 'rent', maxRentPcm: '50', where: 'anywhere' }));
  assert.equal(r.ok, false);
  const big = parseWelcomeAnswers(form({ kind: 'rent', maxRentPcm: '99999', where: 'anywhere' }));
  assert.equal(big.ok, false);
});

test('missing or wrong answers fail with a message', () => {
  assert.equal(parseWelcomeAnswers(form({})).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'buy' })).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'sale', where: 'somewhere' })).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'sale', where: 'near', postcode: 'hello', maxDistanceMiles: '25' })).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'sale', where: 'near', postcode: 'NG2 5GB' })).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'sale', where: 'near', postcode: 'NG2 5GB', maxDistanceMiles: '30' })).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'sale', where: 'areas', areas: 'zz, qq' })).ok, false);
  assert.equal(parseWelcomeAnswers(form({ kind: 'sale', where: 'areas' })).ok, false);
});

test('area codes are validated, uppercased and deduplicated', () => {
  assert.deepEqual(areaCodesFrom('ng,M, l ,NG,xx'), ['NG', 'M', 'L']);
  assert.deepEqual(areaCodesFrom(''), []);
  assert.deepEqual(areaCodesFrom(null), []);
});

test('field names are stable strings the wizard and the action share', () => {
  assert.equal(WELCOME_FIELDS.kind, 'kind');
  assert.equal(WELCOME_FIELDS.areas, 'areas');
  assert.equal(WELCOME_FIELDS.next, 'next');
});
