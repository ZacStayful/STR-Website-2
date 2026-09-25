import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_FIXTURES } from '../apis/__fixtures__/propertydata.ts';
import { parseCouncilTax, parseMortgageRates, type CouncilTaxData } from '../apis/propertydata-parse.ts';
import { billsFromCouncilTax, DEFAULT_COUNCIL_TAX_PCM, pickCouncilTaxBand, UTILITIES_ALLOWANCE_PCM } from './bills.ts';
import { liveMortgageRate, liveMortgageRateLabel } from './mortgage-rate.ts';

const data = parseCouncilTax(PD_FIXTURES.councilTax) as CouncilTaxData;

test('the band comes from the address, then the postcode, then band D', () => {
  // Number 18 has six flats in the trimmed fixture: C, C, C, D, C, E → the commonest, C.
  const eighteen = pickCouncilTaxBand(data, '18 Charleville Road, London, W14 9JH');
  assert.equal(eighteen?.band, 'C');
  assert.equal(eighteen?.matched, 'address');
  assert.equal(eighteen?.annual, 1350.68);
  assert.equal(eighteen?.council, 'Hammersmith and Fulham');
  const twenty = pickCouncilTaxBand(data, 'Flat 2 at 20, Charleville Road');
  assert.equal(twenty?.band, 'D');
  assert.equal(twenty?.matched, 'address');
  // Unknown address: the commonest band in the postcode. The trimmed fixture
  // has C, D and E four times each, and a tie goes to the cheaper band.
  const elsewhere = pickCouncilTaxBand(data, '99 Other Street');
  assert.equal(elsewhere?.band, 'C');
  assert.equal(elsewhere?.matched, 'postcode-mode');
  // No rows at all: band D by default.
  const bare = pickCouncilTaxBand({ ...data, properties: [] }, '1 Test Road');
  assert.equal(bare?.matched, 'default-band-d');
  assert.equal(bare?.annual, 1519.51);
  // No charges at all: nothing to price.
  assert.equal(pickCouncilTaxBand({ ...data, bandsAnnual: {} }, '1 Test Road'), null);
  assert.equal(pickCouncilTaxBand(null, '1 Test Road'), null);
});

test('the bills line keeps its £250 default and moves with the band', () => {
  assert.deepEqual(billsFromCouncilTax(null), { billsPcm: 250, councilTaxPcm: DEFAULT_COUNCIL_TAX_PCM, utilitiesPcm: UTILITIES_ALLOWANCE_PCM });
  const e = billsFromCouncilTax({ band: 'E', annual: 1857.18, council: null, year: null, matched: 'address' });
  assert.deepEqual(e, { billsPcm: 275, councilTaxPcm: 155, utilitiesPcm: 120 });
});

test('the default mortgage rate is the higher of the two fixed averages', () => {
  const live = liveMortgageRate(parseMortgageRates(PD_FIXTURES.mortgageRates));
  assert.deepEqual(live, { ratePct: 5.5, product: '2-year fixed', date: 'Jun 2023' });
  assert.equal(liveMortgageRateLabel(live!), 'avg 2-year fixed 5.5% (Jun 2023)');
  const threeHigher = liveMortgageRate({ fixed2y: { ratePct: 4.9, date: 'Sep 2026' }, fixed3y: { ratePct: 5.1, date: 'Sep 2026' }, variable: { ratePct: 7, date: null } });
  assert.equal(threeHigher?.product, '3-year fixed');
  assert.equal(threeHigher?.ratePct, 5.1);
  assert.equal(liveMortgageRate({ fixed2y: null, fixed3y: null, variable: { ratePct: 7, date: null } }), null);
  assert.equal(liveMortgageRate(null), null);
});
