import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEAL_OPEN_LADDER, parseLadder, openPricePence, ladderBandIndex, formatOpenPrice, describeBand } from './ladder.ts';

test('open price follows the ladder bands with exclusive upper bounds', () => {
  assert.equal(openPricePence(0), 25);
  assert.equal(openPricePence(14_999), 25);
  assert.equal(openPricePence(15_000), 40);
  assert.equal(openPricePence(24_999), 40);
  assert.equal(openPricePence(25_000), 60);
  assert.equal(openPricePence(40_000), 80);
  assert.equal(openPricePence(59_999), 80);
  assert.equal(openPricePence(60_000), 100);
  assert.equal(openPricePence(250_000), 100);
});

test('a deal with no profit figure prices at the lowest band', () => {
  assert.equal(openPricePence(null), 25);
  assert.equal(openPricePence(undefined), 25);
  assert.equal(openPricePence(Number.NaN), 25);
  assert.equal(openPricePence(-3_000), 25);
});

test('parseLadder accepts a well-formed stored ladder and applies it', () => {
  const ladder = parseLadder([{ upTo: 10_000, pence: 10 }, { upTo: null, pence: 15 }]);
  assert.deepEqual(ladder, [{ upTo: 10_000, pence: 10 }, { upTo: null, pence: 15 }]);
  assert.equal(openPricePence(9_999, ladder), 10);
  assert.equal(openPricePence(10_000, ladder), 15);
  assert.equal(ladderBandIndex(10_000, ladder), 1);
});

test('parseLadder falls back to the default on anything malformed', () => {
  assert.equal(parseLadder(null), DEFAULT_DEAL_OPEN_LADDER);
  assert.equal(parseLadder('nope'), DEFAULT_DEAL_OPEN_LADDER);
  assert.equal(parseLadder([]), DEFAULT_DEAL_OPEN_LADDER);
  assert.equal(parseLadder([{ upTo: null }]), DEFAULT_DEAL_OPEN_LADDER, 'no price');
  assert.equal(parseLadder([{ upTo: 10, pence: 5 }]), DEFAULT_DEAL_OPEN_LADDER, 'no open top band');
  assert.equal(parseLadder([{ upTo: 20, pence: 5 }, { upTo: 10, pence: 6 }, { upTo: null, pence: 7 }]), DEFAULT_DEAL_OPEN_LADDER, 'out of order');
  assert.equal(parseLadder([{ upTo: null, pence: 5 }, { upTo: 10, pence: 6 }]), DEFAULT_DEAL_OPEN_LADDER, 'band after the top');
  assert.equal(parseLadder([{ upTo: 10, pence: -1 }, { upTo: null, pence: 7 }]), DEFAULT_DEAL_OPEN_LADDER, 'negative price');
});

test('prices and bands are described for people', () => {
  assert.equal(formatOpenPrice(25), '25p');
  assert.equal(formatOpenPrice(100), '£1');
  assert.equal(formatOpenPrice(120), '£1.20');
  assert.equal(formatOpenPrice(0), 'Free');
  assert.equal(describeBand(DEFAULT_DEAL_OPEN_LADDER, 0), 'under £15k');
  assert.equal(describeBand(DEFAULT_DEAL_OPEN_LADDER, 1), '£15k–£25k');
  assert.equal(describeBand(DEFAULT_DEAL_OPEN_LADDER, 4), '£60k+');
});
