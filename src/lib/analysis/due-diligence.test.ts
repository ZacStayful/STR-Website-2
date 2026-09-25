import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_FIXTURES } from '../apis/__fixtures__/propertydata.ts';
import { parseDemand, parseDesignation, parseEnergyEfficiency, parseFloodRisk, parseListedBuildings } from '../apis/propertydata-parse.ts';
import { assembleDueDiligence, pickEpc, type DueDiligenceInputs } from './due-diligence.ts';

const NOW = '2026-09-25T09:00:00.000Z';

function inputs(over: Partial<DueDiligenceInputs> = {}): DueDiligenceInputs {
  return {
    postcode: 'W14 9JH',
    address: 'Flat 3, 26 Charleville Road, London, W14 9JH',
    epc: parseEnergyEfficiency(PD_FIXTURES.energyEfficiency),
    flood: parseFloodRisk(PD_FIXTURES.floodRisk),
    conservationArea: parseDesignation(PD_FIXTURES.conservationArea, 'conservation_area'),
    greenBelt: { inside: false, name: null },
    aonb: { inside: false, name: null },
    nationalPark: parseDesignation(PD_FIXTURES.nationalPark, 'national_park'),
    listed: parseListedBuildings(PD_FIXTURES.listedBuildings),
    demandSale: parseDemand(PD_FIXTURES.demand, 'sale'),
    demandRent: parseDemand(PD_FIXTURES.demandRent, 'rent'),
    fetchedAt: NOW,
    ...over,
  };
}

test('the EPC is the address\'s own certificate, the newest one when there are several', () => {
  const epc = pickEpc(parseEnergyEfficiency(PD_FIXTURES.energyEfficiency), 'Flat 3, 26 Charleville Road');
  assert.deepEqual(epc, { rating: 'D', score: 66, inspectionDate: '2023-01-27', address: 'Flat 3 , 26 , Charleville Road', matched: 'address' });
  const twice = pickEpc(
    [
      { address: '10 Test Road', rating: 'E', score: 45, inspectionDate: '2015-01-01' },
      { address: '10 Test Road', rating: 'C', score: 72, inspectionDate: '2024-06-01' },
    ],
    '10 Test Road',
  );
  assert.equal(twice?.rating, 'C');
  assert.equal(pickEpc(parseEnergyEfficiency(PD_FIXTURES.energyEfficiency), '99 Nowhere Lane'), null);
  assert.equal(pickEpc(null, '10 Test Road'), null);
});

test('the block is assembled from whatever came back, and is null when nothing did', () => {
  const { epc, dueDiligence } = assembleDueDiligence(inputs());
  assert.equal(epc?.rating, 'D');
  assert.ok(dueDiligence);
  assert.equal(dueDiligence.outcode, 'W14');
  assert.deepEqual(dueDiligence.floodRisk, { level: 'High', high: true });
  assert.equal(dueDiligence.conservationArea?.name, 'Lynmouth conservation area');
  assert.equal(dueDiligence.nationalPark?.inside, true);
  assert.equal(dueDiligence.listedBuildings?.nearest.length, 3);
  assert.equal(dueDiligence.listedBuildings?.possiblyListed, false);
  assert.equal(dueDiligence.exitLiquidity.sale?.rating, 'Buyers market');
  assert.equal(dueDiligence.exitLiquidity.rent?.daysOnMarket, 142);
  assert.equal(dueDiligence.fetchedAt, NOW);

  const nothing = assembleDueDiligence(inputs({ epc: null, flood: null, conservationArea: null, greenBelt: null, aonb: null, nationalPark: null, listed: null, demandSale: null, demandRent: null }));
  assert.equal(nothing.epc, null);
  assert.equal(nothing.dueDiligence, null);

  const floodOnly = assembleDueDiligence(inputs({ epc: null, conservationArea: null, greenBelt: null, aonb: null, nationalPark: null, listed: null, demandSale: null, demandRent: null, flood: { level: 'Very Low' } }));
  assert.deepEqual(floodOnly.dueDiligence?.floodRisk, { level: 'Very Low', high: false });
  assert.equal(floodOnly.dueDiligence?.listedBuildings, null);
});

test('a listed building within ~80 m flags the property as possibly listed', () => {
  const near = { name: 'The Old Bank', grade: 'II', distanceMiles: 0.03, url: null, listDate: null };
  const { dueDiligence } = assembleDueDiligence(inputs({ listed: [near, ...(parseListedBuildings(PD_FIXTURES.listedBuildings) ?? [])] }));
  assert.equal(dueDiligence?.listedBuildings?.possiblyListed, true);
  assert.equal(dueDiligence?.listedBuildings?.nearest[0].name, 'The Old Bank');
  assert.equal(dueDiligence?.listedBuildings?.nearest.length, 3);
});
