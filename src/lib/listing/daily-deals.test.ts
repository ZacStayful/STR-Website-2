import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyDealsMode, dailyChargeDay, PayerPurse, dailyDealsLine } from './daily-deals.ts';

test('per pick until the new pricing date, per day from that morning', () => {
  assert.equal(dailyDealsMode({ newPricingFrom: null }, new Date('2026-12-01T07:00:00Z')), 'per_pick');
  assert.equal(dailyDealsMode({ newPricingFrom: '2026-10-15' }, new Date('2026-10-14T23:59:00Z')), 'per_pick');
  assert.equal(dailyDealsMode({ newPricingFrom: '2026-10-15' }, new Date('2026-10-15T06:00:00Z')), 'per_day');
});

test('the charge day is the UTC day the email slot is kept by', () => {
  assert.equal(dailyChargeDay(new Date('2026-10-15T06:00:00Z')), '2026-10-15');
  assert.equal(dailyChargeDay(new Date('2026-10-15T23:30:00Z')), '2026-10-15');
});

test('teammates on one owner cannot between them overdraw it', () => {
  const purse = new PayerPurse(new Map([['owner', 80]]));
  assert.equal(purse.take('owner', 33), true);
  assert.equal(purse.take('owner', 33), true);
  // The third member of the team finds 14p left: no Today's 5 for them today.
  assert.equal(purse.take('owner', 33), false);
  assert.equal(Math.round(purse.remaining('owner')), 14);
});

test('a balance that could not be read is not a balance', () => {
  const purse = new PayerPurse(new Map([['a', null]]));
  assert.equal(purse.known('a'), false);
  assert.equal(purse.take('a', 33), false);
  assert.equal(purse.take('a', 0), true);
});

test('a pricier stand-in takes the difference, or is not sent', () => {
  const purse = new PayerPurse(new Map([['p', 100]]));
  assert.equal(purse.take('p', 60), true);
  // The 60p pick failed its page read; the stand-in is a £1 deal: 40p more is not there.
  assert.equal(purse.adjust('p', 60, 100), true);
  assert.equal(purse.remaining('p'), 0);
  const tight = new PayerPurse(new Map([['p', 70]]));
  tight.take('p', 60);
  assert.equal(tight.adjust('p', 60, 100), false);
  assert.equal(tight.remaining('p'), 10);
  // A cheaper one gives the difference back.
  assert.equal(tight.adjust('p', 60, 25), true);
  assert.equal(tight.remaining('p'), 45);
});

test('the daily price in words', () => {
  assert.equal(dailyDealsLine(33), 'Daily deals: 33p a day, about £10 a month, charged only on days we send them');
});
