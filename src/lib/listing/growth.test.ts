import { test } from 'node:test';
import assert from 'node:assert/strict';
import { futureValueRange, futureValueSentence } from './growth.ts';

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('the top end repeats the five-year growth and the low end takes half the annual rate', () => {
  const fv = futureValueRange(300_000, 'asking-price', 17.8, 'BN1', null);
  assert.ok(fv);
  assert.equal(fv.high, 353_400);
  near(fv.annualisedPct, 3.3, 0.05, 'annualised');
  near(fv.haircutAnnualPct, 1.7, 0.05, 'haircut');
  near(fv.low, 325_800, 300, 'low');
  assert.equal(fv.horizonYears, 5);
  assert.equal(fv.basis, 'asking-price');
  assert.equal(fv.outcode, 'BN1');
});

test('the haircut is capped at 3% a year however fast the area grew', () => {
  const fv = futureValueRange(200_000, 'estimated-value', 60, 'X1', '2026-09-01');
  assert.ok(fv);
  assert.equal(fv.haircutAnnualPct, 3);
  assert.equal(fv.low, Math.round(200_000 * 1.03 ** 5));
  assert.equal(fv.high, 320_000);
});

test('a falling or flat area reads as a flat-to-down range, never a negative haircut', () => {
  const down = futureValueRange(200_000, 'estimated-value', -10, 'X1', null);
  assert.ok(down);
  assert.equal(down.haircutAnnualPct, 0);
  assert.equal(down.high, 200_000, 'the floor of 0% a year is the top end when history is negative');
  assert.equal(down.low, 180_000);
  const flat = futureValueRange(200_000, 'estimated-value', 0, 'X1', null);
  assert.ok(flat);
  assert.equal(flat.low, 200_000);
  assert.equal(flat.high, 200_000);
});

test('no price or no growth figure means no range', () => {
  assert.equal(futureValueRange(0, 'asking-price', 10, 'X1', null), null);
  assert.equal(futureValueRange(250_000, 'asking-price', null, 'X1', null), null);
  assert.equal(futureValueRange(250_000, 'asking-price', Number.NaN, 'X1', null), null);
  assert.equal(futureValueRange(250_000, 'asking-price', -100, 'X1', null), null);
});

test('the sentence names the basis, the outcode and both rates', () => {
  const fv = futureValueRange(300_000, 'asking-price', 17.8, 'BN1', null)!;
  const s = futureValueSentence(fv);
  assert.ok(s.startsWith('Value in 5 years: £'));
  assert.ok(s.includes('from the asking price of £300,000'));
  assert.ok(s.includes("BN1's 5-year growth of 17.8%"));
  assert.ok(s.includes('not a forecast'));
});
