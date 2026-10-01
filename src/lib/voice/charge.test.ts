import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affordableSeconds, capToBalance, minutesChargePence } from './charge.ts';

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
