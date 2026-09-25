import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryForPostcode, stampDutyFromApi, stampDutyLocal, taxCountryFor, taxNameFor } from './stamp-duty.ts';
import { stampDutyAdditional } from './deal.ts';

test('the nation comes from the postcode area', () => {
  assert.equal(countryForPostcode('EH1 1BB'), 'scotland');
  assert.equal(countryForPostcode('g1 1xw'), 'scotland');
  assert.equal(countryForPostcode('CF10 1EP'), 'wales');
  assert.equal(countryForPostcode('LL30 2AA'), 'wales');
  assert.equal(countryForPostcode('BT1 1AA'), 'northern_ireland');
  assert.equal(countryForPostcode('NG1 5DT'), 'england');
  assert.equal(countryForPostcode('SW1A 1AA'), 'england');
  assert.equal(countryForPostcode('JE2 3AB'), 'england');
  assert.equal(countryForPostcode(''), 'england');
  // Border areas are decided by outcode.
  assert.equal(countryForPostcode('TD15 1AA'), 'england', 'Berwick-upon-Tweed');
  assert.equal(countryForPostcode('TD1 1AA'), 'scotland', 'Galashiels');
  assert.equal(countryForPostcode('CH7 1AA'), 'wales', 'Mold');
  assert.equal(countryForPostcode('CH1 1AA'), 'england', 'Chester');
  assert.equal(countryForPostcode('SY21 7AA'), 'wales', 'Welshpool');
  assert.equal(countryForPostcode('SY1 1AA'), 'england', 'Shrewsbury');
  assert.equal(countryForPostcode('SY23'), 'wales', 'an outcode on its own');
  assert.equal(taxNameFor('scotland'), 'LBTT');
  assert.equal(taxNameFor('wales'), 'LTT');
  assert.equal(taxNameFor('northern_ireland'), 'SDLT');
  assert.equal(taxCountryFor('LBTT', 'england'), 'scotland');
  assert.equal(taxCountryFor('SDLT', 'northern_ireland'), 'northern_ireland');
  assert.equal(taxCountryFor(null, 'wales'), 'wales');
});

test('England and Northern Ireland: the additional-property SDLT bands', () => {
  assert.equal(stampDutyLocal(100_000, 'england').amount, 5_000);
  assert.equal(stampDutyLocal(250_000, 'england').amount, 6_250 + 8_750);
  assert.equal(stampDutyLocal(400_000, 'northern_ireland').amount, 6_250 + 8_750 + 15_000);
  assert.equal(stampDutyLocal(1_000_000, 'england').amount, 6_250 + 8_750 + 67_500 + 11_250);
  assert.equal(stampDutyLocal(0, 'england').amount, 0);
  assert.deepEqual(stampDutyLocal(250_000, 'england'), { amount: 15_000, name: 'SDLT', effectiveRatePct: 6, country: 'england', source: 'local' });
  // The old export still gives the England figure.
  assert.equal(stampDutyAdditional(300_000), stampDutyLocal(300_000, 'england').amount);
});

test('Wales: the LTT higher residential bands', () => {
  assert.equal(stampDutyLocal(100_000, 'wales').amount, 5_000);
  assert.equal(stampDutyLocal(250_000, 'wales').amount, 9_000 + 5_950);
  assert.equal(stampDutyLocal(400_000, 'wales').amount, 9_000 + 5_950 + 15_000);
  assert.equal(stampDutyLocal(1_000_000, 'wales').amount, 9_000 + 5_950 + 15_000 + 43_750 + 37_500);
  assert.equal(stampDutyLocal(400_000, 'wales').name, 'LTT');
});

test('Scotland: LBTT bands plus the 8% supplement, matching PropertyData\'s own example', () => {
  // PropertyData's documented example: £250,000, investment, 12 Feb 2025 → £22,100 at 8.8%.
  const s = stampDutyLocal(250_000, 'scotland');
  assert.equal(s.amount, 22_100);
  assert.equal(s.effectiveRatePct, 8.8);
  assert.equal(s.name, 'LBTT');
  assert.equal(stampDutyLocal(100_000, 'scotland').amount, 8_000);
  assert.equal(stampDutyLocal(39_000, 'scotland').amount, 0);
  assert.equal(stampDutyLocal(400_000, 'scotland').amount, 2_100 + 3_750 + 7_500 + 32_000);
});

test('the API figure is used verbatim and keeps the nation the API named', () => {
  const f = stampDutyFromApi({ name: 'LBTT', payable: 22_100, effectiveRatePct: 8.8, countryUsed: 'scotland', modeUsed: 'investment', transactionDate: '2025-02-12' }, 'scotland', 250_000);
  assert.deepEqual(f, { amount: 22_100, name: 'LBTT', effectiveRatePct: 8.8, country: 'scotland', source: 'propertydata' });
  // Without a rate from the API it is worked out from the price, never from the payable alone.
  const g = stampDutyFromApi({ name: 'SDLT', payable: 15_000, effectiveRatePct: null, countryUsed: null, modeUsed: null, transactionDate: null }, 'northern_ireland', 250_000);
  assert.equal(g.country, 'northern_ireland');
  assert.equal(g.source, 'propertydata');
  assert.equal(g.effectiveRatePct, 6);
  assert.equal(stampDutyFromApi({ name: 'SDLT', payable: 15_000, effectiveRatePct: null, countryUsed: null, modeUsed: null, transactionDate: null }, 'england', 0).effectiveRatePct, 0);
});
