import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldWarnBeforeTopup, warningBandOpensAt, WARNING_BAND_MULTIPLE } from './topup-warning.ts';

const CYCLE_START = new Date('2026-03-01T00:00:00.000Z');

function input(over: Partial<Parameters<typeof shouldWarnBeforeTopup>[0]> = {}) {
  return {
    spendableBasePence: 3000,        // £30, inside the band above a £20 threshold
    thresholdPence: 2000,            // £20
    autoTopupAmountPence: 5000,      // £50 would be charged
    lastWarningAt: null,
    cycleStart: CYCLE_START,
    ...over,
  };
}

test('a balance inside the band warns', () => {
  assert.deepEqual(shouldWarnBeforeTopup(input()), { warn: true });
});

test('nothing is sent when auto top-up is off', () => {
  // lowBalanceEmail already covers this case, and no payment is coming — a
  // warning about one would be untrue as well as redundant.
  for (const amount of [null, 0]) {
    assert.deepEqual(shouldWarnBeforeTopup(input({ autoTopupAmountPence: amount })), {
      warn: false,
      because: 'auto_topup_off',
    });
  }
});

test('a comfortable balance is left alone', () => {
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 9000 })).warn, false);
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 4001 })).warn, false);
});

test('the band opens exactly at twice the threshold', () => {
  assert.equal(warningBandOpensAt(2000), 2000 * WARNING_BAND_MULTIPLE);
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 4000 })).warn, true, 'the edge is inside');
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 4001 })).warn, false, 'just above is outside');
});

test('at or below the threshold there is nothing left to warn about', () => {
  // The charge is happening now; the receipt is the honest message.
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 2000 })).warn, false);
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 1500 })).warn, false);
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: 0 })).warn, false);
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: -500 })).warn, false);
});

test('exactly one warning per cycle', () => {
  const sentThisCycle = shouldWarnBeforeTopup(input({ lastWarningAt: '2026-03-04T10:00:00.000Z' }));
  assert.deepEqual(sentThisCycle, { warn: false, because: 'already_sent_this_cycle' });

  // Last cycle's warning does not suppress this cycle's.
  assert.equal(shouldWarnBeforeTopup(input({ lastWarningAt: '2026-02-11T10:00:00.000Z' })).warn, true);
});

test('a warning sent exactly at the cycle boundary counts as this cycle', () => {
  const atBoundary = shouldWarnBeforeTopup(input({ lastWarningAt: CYCLE_START.toISOString() }));
  assert.equal(atBoundary.warn, false);
});

test('an unusable threshold stays silent rather than naming a figure we do not have', () => {
  for (const threshold of [0, -100, Number.NaN]) {
    assert.deepEqual(shouldWarnBeforeTopup(input({ thresholdPence: threshold })), {
      warn: false,
      because: 'unusable_threshold',
    });
  }
});

test('an unusable balance does not warn', () => {
  assert.equal(shouldWarnBeforeTopup(input({ spendableBasePence: Number.NaN })).warn, false);
});

test('an unparseable last-warning timestamp does not block a warning for ever', () => {
  // Corrupt data should cost an extra email, not silence the warning
  // permanently — the failure that would never be noticed.
  assert.equal(shouldWarnBeforeTopup(input({ lastWarningAt: 'not a date' })).warn, true);
});

test('the band scales with the threshold', () => {
  // A £50 threshold warns from £100, not from a hardcoded £40.
  const big = input({ thresholdPence: 5000, spendableBasePence: 9000 });
  assert.equal(shouldWarnBeforeTopup(big).warn, true);
  assert.equal(shouldWarnBeforeTopup({ ...big, spendableBasePence: 10_001 }).warn, false);
});
