import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affordableSeconds, callablePence, capToBalance, maxSpendRate, minutesChargePence } from './charge.ts';

test('pro rata per second at 65p a minute, rounded up to the penny', () => {
  assert.equal(minutesChargePence(40, 65), 44);
  assert.equal(minutesChargePence(60, 65), 65);
  assert.equal(minutesChargePence(61, 65), 67);
  assert.equal(minutesChargePence(0, 65), 0);
  assert.equal(minutesChargePence(-5, 65), 0);
});

test('a charge never takes the balance below zero', () => {
  assert.equal(capToBalance(65, 500), 65);
  assert.equal(capToBalance(650, 430), 430);
  assert.equal(capToBalance(65, 0), 0);
  assert.equal(capToBalance(65, -20), 0);
});

test('affordable seconds keep the texts back and stop at the longest call', () => {
  assert.equal(affordableSeconds(500, 65, 600, 44), 420);
  assert.equal(affordableSeconds(10_000, 65, 600, 44), 600);
  assert.equal(affordableSeconds(50, 65, 600, 44), 5);
});

test('R2-13: a call never takes credit an open reservation holds; with nothing reserved, the whole balance', () => {
  const rates = { plan: 1, welcome: 1, topup: 1.3, adjustment: 1.3 };
  assert.equal(maxSpendRate(rates), 1.3);
  // Nothing reserved: the displayed balance, as before.
  assert.equal(callablePence({ totalPence: 600, spendableBasePence: 600, reservedBasePence: 0 }, 1.3), 600);
  // £6 of plan credit with £3 reserved for a running deep report: £3 is free (the review's case).
  assert.equal(callablePence({ totalPence: 600, spendableBasePence: 300, reservedBasePence: 300 }, 1.3), 300);
  const call = capToBalance(325, callablePence({ totalPence: 600, spendableBasePence: 300, reservedBasePence: 300 }, 1.3));
  assert.equal(call, 300, 'a 5-minute call is capped at the free £3, so the report can still settle');
  // £10 of top-up (base ≈ 769p) with 700p base reserved: 90p face is free (1000 − 700 × 1.3), which takes ≈ 69p base and leaves the 700 covered.
  const topup = callablePence({ totalPence: 1000, spendableBasePence: 1000 / 1.3 - 700, reservedBasePence: 700 }, 1.3);
  assert.ok(Math.abs(topup - 90) < 0.01, String(topup));
  assert.ok((1000 - topup) / 1.3 >= 700 - 0.01, 'what is left still covers the reservation');
  // Everything reserved: nothing for the call.
  assert.equal(callablePence({ totalPence: 500, spendableBasePence: 0, reservedBasePence: 500 }, 1.3), 0);
  assert.equal(callablePence({ totalPence: 500, spendableBasePence: -20, reservedBasePence: 520 }, 1.3), 0);
  // Affordability follows: £3 free buys 4 minutes after the texts are kept back (65p a minute, 44p reserve).
  assert.equal(affordableSeconds(callablePence({ totalPence: 600, spendableBasePence: 300, reservedBasePence: 300 }, 1.3), 65, 600, 44), 236);
});
