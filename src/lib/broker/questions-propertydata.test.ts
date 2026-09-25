import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryLedger, memoryStore, resolveQuestion } from './resolve.ts';
import { pdQuestions, type PdClient } from './questions-propertydata-defs.ts';

const enabled = () => true;

function fakeClient(overrides: Partial<PdClient> = {}): PdClient & { calls: string[] } {
  const calls: string[] = [];
  const log = <T>(name: string, value: T) => async () => {
    calls.push(name);
    return value;
  };
  return {
    calls,
    floorAreas: log('floorAreas', [{ address: '1 Test Road', squareFeet: 500, habitableRooms: 2, inspectionDate: null }]),
    valuationRent: log('valuationRent', { weeklyRent: 300, monthlyRent: 1300 }),
    valuationSale: log('valuationSale', { estimate: 200000, margin: 10000, confidence: 'high' as const, low: 190000, high: 210000 }),
    stampDuty: log('stampDuty', { name: 'SDLT', payable: 7500, effectiveRatePct: 5, countryUsed: 'england', modeUsed: 'investment', transactionDate: '2026-09-25' }),
    mortgageRates: log('mortgageRates', { fixed2y: { ratePct: 5.5, date: 'Jun 2023' }, fixed3y: null, variable: null }),
    councilTax: log('councilTax', { council: 'Test', rating: null, year: null, bandsAnnual: { D: 1500 }, properties: [] }),
    energyEfficiency: log('energyEfficiency', []),
    floodRisk: log('floodRisk', { level: 'Low' }),
    designation: log('designation', { inside: false, name: null }),
    listedBuildings: log('listedBuildings', []),
    demand: log('demand', { kind: 'rent' as const, total: 1, perMonth: 1, turnoverPct: 1, monthsOfInventory: 1, daysOnMarket: 10, rating: 'Balanced market' }),
    keyStats: log('keyStats', [{ outcode: 'BN1', avgPrice: 1, avgPricePsf: 1, avgRentWeekly: 1, avgYieldPct: 1, growth1y: 1, growth3y: 1, growth5y: 1, growth7y: 1, salesPerMonth: 1, turnoverPct: 1 }]),
    ...overrides,
  };
}

test('a postcode is fetched once however it is spelled, then served from the cache', async () => {
  const client = fakeClient();
  const q = pdQuestions(client);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
  const a = await resolveQuestion(deps, q.pdFloorAreas, { postcode: 'ng1 5dt' }, { mode: 'full', userId: 'u1' });
  const b = await resolveQuestion(deps, q.pdFloorAreas, { postcode: 'NG1  5DT' }, { mode: 'quick' });
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(client.calls.filter((c) => c === 'floorAreas').length, 1);
  assert.equal(a.value?.[0].squareFeet, 500);
});

test('the rent valuation walks the attempts in order and never caches a failure', async () => {
  let n = 0;
  const client = fakeClient({
    valuationRent: async (params) => {
      n++;
      return n < 3 ? null : { weeklyRent: Number(params.bedrooms) * 100, monthlyRent: Number(params.bedrooms) * 433 };
    },
  });
  const q = pdQuestions(client);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
  const r = await resolveQuestion(deps, q.pdLongLetRent, { postcode: 'NG1 5DT', bedrooms: 2, options: { propertyType: 'flat' } }, { mode: 'full' });
  assert.equal(r.value?.attempt, 3);
  assert.equal(r.value?.monthlyRent, 866);
  assert.equal(n, 3);

  // Different options are a different question; the same options are a hit.
  await resolveQuestion(deps, q.pdLongLetRent, { postcode: 'NG1 5DT', bedrooms: 2, options: { propertyType: 'flat' } }, { mode: 'full' });
  assert.equal(n, 3);
  n = 0;
  await resolveQuestion(deps, q.pdLongLetRent, { postcode: 'NG1 5DT', bedrooms: 2, options: { propertyType: 'detached_house' } }, { mode: 'full' });
  assert.equal(n, 3);

  let attempts = 0;
  const failing = fakeClient({
    valuationRent: async () => {
      attempts++;
      return null;
    },
  });
  const q2 = pdQuestions(failing);
  const store = memoryStore();
  const r2 = await resolveQuestion({ store, ledger: memoryLedger(), enabled }, q2.pdLongLetRent, { postcode: 'SW1A 1AA', bedrooms: 1 }, { mode: 'full' });
  assert.equal(r2.unavailable, true);
  assert.equal(attempts, 6);
  assert.equal(store.map.size, 0);
});

test('the sale valuation stops at the first attempt that answers', async () => {
  let n = 0;
  const client = fakeClient({
    valuationSale: async () => {
      n++;
      return n === 1 ? null : { estimate: 250000, margin: null, confidence: null, low: 212500, high: 287500 };
    },
  });
  const q = pdQuestions(client);
  const r = await resolveQuestion({ store: memoryStore(), ledger: memoryLedger(), enabled }, q.pdSaleValuation, { postcode: 'NG1 5DT', bedrooms: 2, propertyType: 'flat' }, { mode: 'full' });
  assert.equal(r.value?.estimate, 250000);
  assert.equal(n, 2);
});

test('keys: stamp duty by nation, mode and price; demand by outcode; key stats by region at thirty credits', () => {
  const q = pdQuestions(fakeClient());
  assert.equal(q.pdStampDuty.key({ value: 250000.4, country: 'scotland', mode: 'investment' }), 'scotland|investment|res|250000');
  assert.equal(q.pdStampDuty.key({ value: 250000, country: 'scotland', mode: 'investment', ukResident: false }), 'scotland|investment|nonres|250000');
  assert.equal(q.pdMortgageRates.key({}), 'uk');
  assert.equal(q.pdDemandRent.key({ outcode: 'ng1' }), 'NG1');
  assert.equal(q.pdCouncilTax.key({ postcode: 'ng1 5dt' }), 'NG15DT');
  assert.equal(q.pdRegionKeyStats.key({ region: ' South_East ' }), 'south_east');
  assert.equal(q.pdRegionKeyStats.rungs[0].costPence, 75);
  assert.equal(q.pdFloodRisk.rungs[0].costPence, 2.5);
  for (const question of Object.values(q)) {
    assert.equal(question.rungs.length, 1);
    assert.equal(question.rungs[0].provider, 'propertydata');
    assert.equal(question.rungs[0].level, 3);
  }
});

test('the designation questions ask for their own field and demand for its own kind', async () => {
  const seen: string[] = [];
  const client = fakeClient({
    designation: async (_postcode, field) => {
      seen.push(field);
      return { inside: true, name: field };
    },
    demand: async (_outcode, kind) => {
      seen.push(kind);
      return { kind, total: null, perMonth: null, turnoverPct: null, monthsOfInventory: null, daysOnMarket: null, rating: 'Balanced market' };
    },
  });
  const q = pdQuestions(client);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
  const ctx = { mode: 'full' as const };
  await resolveQuestion(deps, q.pdConservationArea, { postcode: 'X1 1XX' }, ctx);
  await resolveQuestion(deps, q.pdGreenBelt, { postcode: 'X1 1XX' }, ctx);
  await resolveQuestion(deps, q.pdAonb, { postcode: 'X1 1XX' }, ctx);
  await resolveQuestion(deps, q.pdNationalPark, { postcode: 'X1 1XX' }, ctx);
  await resolveQuestion(deps, q.pdDemandSale, { outcode: 'X1' }, ctx);
  await resolveQuestion(deps, q.pdDemandRent, { outcode: 'X1' }, ctx);
  assert.deepEqual(seen, ['conservation_area', 'green_belt', 'aonb', 'national_park', 'sale', 'rent']);
});
