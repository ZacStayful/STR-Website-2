import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_FIXTURES } from './__fixtures__/propertydata.ts';
import {
  fallbackFloorArea,
  fallbackLongLet,
  flagPossiblyListed,
  floorAreaFromEntry,
  isHighFloodRisk,
  longLetAttemptParams,
  matchAddressEntries,
  matchAddressEntry,
  num,
  outcodeOf,
  parseAccountCredits,
  parseCouncilTax,
  parseDemand,
  parseDesignation,
  parseEnergyEfficiency,
  parseFloodRisk,
  parseFloorAreas,
  parseKeyStats,
  parseListedBuildings,
  parseMortgageRates,
  parseStampDuty,
  parseValuationRent,
  parseValuationSale,
  pdCallKey,
  pdUrl,
  postcodeAreaOf,
  propertyTypeSlug,
  saleAttemptParams,
} from './propertydata-parse.ts';

const ERROR = { status: 'error', message: 'Invalid postcode' };

test('the URL puts the key first, keeps the postcode space and drops empty values', () => {
  const u = pdUrl('/valuation-rent', { postcode: 'W14 9JH', bedrooms: 2, empty: '', missing: undefined, nothing: null }, 'SECRET');
  assert.equal(u.origin + u.pathname, 'https://api.propertydata.co.uk/valuation-rent');
  assert.ok(u.search.startsWith('?key=SECRET&'));
  assert.equal(u.searchParams.get('postcode'), 'W14 9JH');
  assert.equal(u.searchParams.get('bedrooms'), '2');
  assert.equal(u.searchParams.has('empty'), false);
  assert.equal(u.searchParams.has('missing'), false);
  assert.equal(u.searchParams.has('nothing'), false);
  // The meter and cache key never carry the API key.
  assert.equal(pdCallKey('valuation-rent', { postcode: 'W14 9JH', bedrooms: 2 }), '/valuation-rent?postcode=W14+9JH&bedrooms=2');
  assert.equal(pdCallKey('mortgage-rates', {}), '/mortgage-rates');
});

test('numbers are read from every format the API uses', () => {
  assert.equal(num('1,519.51'), 1519.51);
  assert.equal(num('3.6%'), 3.6);
  assert.equal(num('-0.6%'), -0.6);
  assert.equal(num('£825,000'), 825000);
  assert.equal(num(5), 5);
  assert.equal(num('Jun 2023'), null);
  assert.equal(num(''), null);
  assert.equal(num(null), null);
  assert.equal(num(Number.NaN), null);
});

test('postcode helpers', () => {
  assert.equal(outcodeOf('ng1 5dt'), 'NG1');
  assert.equal(outcodeOf('EC1A1BB'), 'EC1A');
  assert.equal(outcodeOf('NG1'), null);
  assert.equal(postcodeAreaOf('ng1 5dt'), 'NG');
  assert.equal(postcodeAreaOf('W14'), 'W');
  assert.equal(postcodeAreaOf(''), null);
});

test('floor areas: documented key, legacy key, and address matching', () => {
  const list = parseFloorAreas(PD_FIXTURES.floorAreas);
  assert.ok(list);
  assert.equal(list.length, 5);
  assert.equal(list[0].squareFeet, 603);
  assert.equal(list[0].habitableRooms, 3);
  assert.equal(list[0].inspectionDate, '2016-08-31');
  const legacy = parseFloorAreas({ status: 'success', data: [{ address: '1 Test Road', square_feet: '500' }] });
  assert.equal(legacy?.[0].squareFeet, 500);
  assert.equal(parseFloorAreas(ERROR), null);
  assert.equal(parseFloorAreas({ status: 'success' }), null);

  const both = matchAddressEntries(list, '32 Charleville Road, London, W14 9JH');
  assert.equal(both?.matched, 'address');
  assert.deepEqual(both?.entries.map((e) => e.address), ['Third Floor Flat, 32 Charleville Road', 'Flat B8, 32 Charleville Road']);
  assert.equal(matchAddressEntry(list, 'Flat B8, 32 Charleville Road')?.entry.address, 'Flat B8, 32 Charleville Road');
  assert.equal(matchAddressEntry(list, '18b Charleville Road')?.entry.address, '18b Charleville Road');
  // "2 Charleville Road" must not match number 32, and a different street must not match on the number.
  assert.equal(matchAddressEntries(list, '2 Charleville Road'), null);
  assert.equal(matchAddressEntries(list, '46 Sinclair Road'), null);
  assert.equal(matchAddressEntries(list, '99 Nowhere Street'), null);
  assert.equal(matchAddressEntries(list, 'Charleville Road'), null);
  // A bare number can only be matched on the number.
  const bare = matchAddressEntries(list, '48');
  assert.equal(bare?.matched, 'house-number');
  assert.equal(bare?.entries[0].address, 'Flat 1, 48 Charleville Road');

  assert.deepEqual(floorAreaFromEntry(list[1], 2), { squareFeet: 258, constructionDate: '1914_2000', matched: true });
  assert.deepEqual(floorAreaFromEntry(null, 3), { squareFeet: 900, constructionDate: '1914_2000', matched: false });
  assert.deepEqual(fallbackFloorArea(9), { squareFeet: 1350, constructionDate: '1914_2000', matched: false });
});

test('rent valuation is weekly and converted to a month', () => {
  const v = parseValuationRent(PD_FIXTURES.valuationRent);
  assert.deepEqual(v, { weeklyRent: 332, monthlyRent: 1439 });
  assert.deepEqual(parseValuationRent({ status: 'success', result: { estimate: 1200, unit: 'gbp_per_month' } }), { weeklyRent: 277, monthlyRent: 1200 });
  assert.equal(parseValuationRent({ status: 'success', result: { estimate: 0 } }), null);
  assert.equal(parseValuationRent(ERROR), null);
  assert.deepEqual(fallbackLongLet(2), { monthlyRent: 1400, estimateHigh: 1610, estimateLow: 1190, comparables: [] });
});

test('sale valuation reads the margin and confidence, with ±15% when no margin comes back', () => {
  const v = parseValuationSale(PD_FIXTURES.valuationSale);
  assert.deepEqual(v, { estimate: 390000, margin: 20000, confidence: 'high', low: 370000, high: 410000 });
  const bare = parseValuationSale({ status: 'success', result: { estimate: 200000 } });
  assert.deepEqual(bare, { estimate: 200000, margin: null, confidence: null, low: 170000, high: 230000 });
  assert.equal(parseValuationSale(ERROR), null);
});

test('stamp duty, mortgage rates and account credits', () => {
  assert.deepEqual(parseStampDuty(PD_FIXTURES.stampDuty), {
    name: 'LBTT',
    payable: 22100,
    effectiveRatePct: 8.8,
    countryUsed: 'scotland',
    modeUsed: 'investment',
    transactionDate: '2025-02-12',
  });
  assert.equal(parseStampDuty(ERROR), null);
  const rates = parseMortgageRates(PD_FIXTURES.mortgageRates);
  assert.deepEqual(rates, { fixed2y: { ratePct: 5.5, date: 'Jun 2023' }, fixed3y: { ratePct: 5.29, date: 'Jun 2023' }, variable: { ratePct: 7.54, date: 'Jun 2023' } });
  assert.equal(parseMortgageRates({ status: 'success', data: {} }), null);
  const credits = parseAccountCredits(PD_FIXTURES.accountCredits);
  assert.deepEqual(credits, { used: 36, remaining: 4964, limit: 5000, renewsAt: '2024-03-31T23:00:00.000Z' });
});

test('council tax bands and the properties in the postcode', () => {
  const ct = parseCouncilTax(PD_FIXTURES.councilTax);
  assert.ok(ct);
  assert.equal(ct.council, 'Hammersmith and Fulham');
  assert.equal(ct.rating, 'Low tax');
  assert.equal(ct.year, '2026/27');
  assert.equal(ct.bandsAnnual.D, 1519.51);
  assert.equal(ct.bandsAnnual.H, 3039.02);
  assert.equal(ct.properties.length, 12);
  assert.deepEqual(ct.properties[0], { address: 'MAIS 1ST 2ND & 3RD FLRS AT 3, CHARLEVILLE ROAD, LONDON, W14 9JH', band: 'E' });
  const eighteen = matchAddressEntries(ct.properties, '18 Charleville Road, London, W14 9JH');
  assert.equal(eighteen?.entries.length, 6);
  assert.equal(parseCouncilTax(ERROR), null);
});

test('EPC entries, flood risk and the designations', () => {
  const epc = parseEnergyEfficiency(PD_FIXTURES.energyEfficiency);
  assert.ok(epc);
  assert.equal(epc.length, 3);
  assert.deepEqual(epc[0], { address: 'Flat 3 , 26 , Charleville Road', rating: 'D', score: 66, inspectionDate: '2023-01-27' });
  assert.equal(matchAddressEntry(epc, 'Flat 3, 26 Charleville Road')?.entry.rating, 'D');
  assert.equal(parseEnergyEfficiency(ERROR), null);

  assert.deepEqual(parseFloodRisk(PD_FIXTURES.floodRisk), { level: 'High' });
  assert.equal(isHighFloodRisk('High'), true);
  assert.equal(isHighFloodRisk('Very Low'), false);
  assert.equal(isHighFloodRisk(null), false);

  assert.deepEqual(parseDesignation(PD_FIXTURES.aonb, 'aonb'), { inside: true, name: 'Cotswolds AONB' });
  assert.deepEqual(parseDesignation(PD_FIXTURES.conservationArea, 'conservation_area'), { inside: true, name: 'Lynmouth conservation area' });
  assert.deepEqual(parseDesignation(PD_FIXTURES.greenBelt, 'green_belt'), { inside: true, name: 'Oxford Greenbelt' });
  assert.deepEqual(parseDesignation(PD_FIXTURES.nationalPark, 'national_park'), { inside: true, name: 'Exmoor National Park' });
  assert.deepEqual(parseDesignation({ status: 'success', aonb: false }, 'aonb'), { inside: false, name: null });
  assert.equal(parseDesignation({ status: 'success' }, 'aonb'), null);
  assert.equal(parseDesignation(ERROR, 'green_belt'), null);
});

test('listed buildings are sorted by distance and only a very near one flags the property', () => {
  const list = parseListedBuildings(PD_FIXTURES.listedBuildings);
  assert.ok(list);
  assert.deepEqual(list.map((b) => b.distanceMiles), [0.49, 1.2, 1.28]);
  assert.equal(list[0].name, 'MECCA BINGO');
  assert.equal(list[0].grade, 'II*');
  assert.equal(flagPossiblyListed(list), false);
  assert.equal(flagPossiblyListed([{ name: 'X', grade: 'II', distanceMiles: 0.03, url: null, listDate: null }, ...list]), true);
  assert.equal(parseListedBuildings({ status: 'success', data: { listed_buildings: [] } })?.length, 0);
  assert.equal(parseListedBuildings(ERROR), null);
});

test('sales and rental demand snapshots', () => {
  assert.deepEqual(parseDemand(PD_FIXTURES.demand, 'sale'), { kind: 'sale', total: 718, perMonth: 27, turnoverPct: 4, monthsOfInventory: 25, daysOnMarket: 761, rating: 'Buyers market' });
  assert.deepEqual(parseDemand(PD_FIXTURES.demandRent, 'rent'), { kind: 'rent', total: 656, perMonth: 138, turnoverPct: 21, monthsOfInventory: 4.8, daysOnMarket: 142, rating: 'Tenants market' });
  assert.equal(parseDemand({ status: 'success' }, 'rent'), null);
  assert.equal(parseDemand(ERROR, 'sale'), null);
});

test('region key stats keep nulls where PropertyData has no figure', () => {
  const rows = parseKeyStats(PD_FIXTURES.keyStats);
  assert.ok(rows);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].outcode, 'BN1');
  assert.equal(rows[0].growth5y, 17.8);
  assert.equal(rows[0].avgRentWeekly, 315.1);
  assert.equal(rows[0].avgYieldPct, 4.1);
  assert.equal(rows[0].turnoverPct, 1);
  assert.equal(rows[1].avgRentWeekly, null);
  assert.equal(rows[1].avgYieldPct, null);
  assert.equal(rows[1].growth7y, null);
  assert.equal(rows[2].growth1y, -0.6);
  assert.equal(parseKeyStats(ERROR), null);
});

test('valuation attempts run from the member\'s details down to the plainest defaults', () => {
  const rent = longLetAttemptParams('NG1 5DT', 2, { propertyType: 'terraced_house', constructionDate: 'pre_1914', internalArea: 812, bathrooms: 2, finishQuality: 'average', outdoorSpace: 'garden', offStreetParking: 1 });
  assert.equal(rent.length, 6);
  assert.deepEqual(rent[0], { postcode: 'NG1 5DT', property_type: 'terraced_house', construction_date: 'pre_1914', internal_area: '812', bedrooms: '2', bathrooms: '2', finish_quality: 'average', outdoor_space: 'garden', off_street_parking: '1' });
  assert.equal(rent[1].finish_quality, 'average');
  assert.equal(rent[1].property_type, 'terraced_house');
  assert.deepEqual(rent.slice(2).map((a) => a.property_type), ['terraced_house', 'semi-detached_house', 'detached_house', 'flat']);
  // Too small an area is lifted to the API's minimum.
  assert.equal(longLetAttemptParams('NG1 5DT', 1, { internalArea: 120 })[0].internal_area, '300');
  assert.equal(longLetAttemptParams('NG1 5DT', 1, {})[0].finish_quality, 'high');

  const sale = saleAttemptParams('NG1 5DT', 2, 'Semi-detached');
  assert.equal(sale.length, 5);
  assert.equal(sale[0].property_type, 'semi-detached_house');
  assert.deepEqual(sale[1], { postcode: 'NG1 5DT', property_type: 'semi-detached_house', bedrooms: '2' });
  assert.deepEqual(sale.slice(2).map((a) => a.property_type), ['flat', 'terraced_house', 'detached_house']);
  assert.equal(propertyTypeSlug('Detached House'), 'detached_house');
  assert.equal(propertyTypeSlug('bungalow'), 'flat');
});
