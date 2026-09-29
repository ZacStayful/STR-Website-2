import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyLeftInLine, parseProjectCard, projectCardData, projectCashLine, projectNumbers, valueAddedLabel, worksLabel } from './headline.ts';
import { estimateFromFindings } from './estimate.ts';
import { profitAfterWorksPcm } from './finance.ts';
import { monthlyMortgage, purchaseDeal } from '../listing/deal.ts';
import type { LineKey, PhotoFindings } from './costing.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const NOW = new Date('2026-09-29T12:00:00Z');

function norton() {
  const lines: PhotoFindings['lines'] = {};
  for (const k of ['radiators', 'bathroom', 'plaster', 'skirting', 'paint', 'kitchen', 'carpet', 'windows', 'outside_doors', 'internal_doors', 'boiler'] as LineKey[]) lines[k] = { status: 'needed', reason: 'x', photos: [2] };
  lines.roof = { status: 'cant_tell', reason: 'x', photos: [] };
  lines.damp = { status: 'cant_tell', reason: 'x', photos: [] };
  const out = estimateFromFindings({
    price: 70_000,
    facts: { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null },
    country: 'england',
    ceiling: null,
    findings: { condition: 'full', kitchenSize: 'small', lines, counts: { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null } },
  });
  if (out.kind !== 'project') throw new Error('expected a project');
  return out.estimate;
}

test('the card data carries numbers only, and survives the database round trip', () => {
  const card = projectCardData(norton(), 3, NOW);
  assert.equal(card.level, 'full');
  assert.equal(card.valueAdded, 18_090);
  assert.equal(card.cashLow, 74_766);
  assert.equal(card.moneyLeftInHigh, 41_006);
  const json = JSON.stringify(card);
  assert.doesNotMatch(json, /reason|photo|x"/, 'no reasons or photo numbers on the card');
  assert.deepEqual(parseProjectCard(json), card);
  assert.deepEqual(parseProjectCard(JSON.parse(json)), card);
});

test('anything unusable reads as not a Project deal', () => {
  assert.equal(parseProjectCard(null), null);
  assert.equal(parseProjectCard('not json'), null);
  assert.equal(parseProjectCard({ v: 2 }), null);
  assert.equal(parseProjectCard({ ...projectCardData(norton(), 3, NOW), worksHigh: 'lots' }), null);
});

test('the three numbers and the cash line, as a member reads them', () => {
  assert.equal(worksLabel(26_620, 39_710), 'Works ~£27k–£40k');
  assert.equal(worksLabel(3_355, 18_744), 'Works ~£3.4k–£19k');
  assert.equal(valueAddedLabel(18_090), '£18k value added');
  assert.equal(projectCashLine({ cashLow: 74_766, cashHigh: 87_856 }), '£75k–£88k cash in');
  assert.equal(moneyLeftInLine({ moneyLeftInLow: 27_916, moneyLeftInHigh: 41_006 }), '£28k–£41k left in after refinance');
  assert.equal(moneyLeftInLine({ moneyLeftInLow: -2_000, moneyLeftInHigh: 1_500 }), '£0–£1.5k left in after refinance');
  assert.equal(moneyLeftInLine({ moneyLeftInLow: null, moneyLeftInHigh: null }), null);
  const n = projectNumbers(projectCardData(norton(), 3, NOW), { grossRevenue: 30_000, confidence: 'medium', compCount: 12 }, null, WIDTHS);
  assert.equal(n.works, 'Works ~£27k–£40k');
  assert.equal(n.valueAdded, '£18k value added');
  assert.match(n.profit ?? '', /\/mo after works$/);
  assert.equal(n.caption, 'based on 12 similar Airbnbs nearby');
  assert.equal(projectNumbers(projectCardData(norton(), 3, NOW), { grossRevenue: null, confidence: null }, null, WIDTHS).profit, null, 'no income, no profit line');
});

test('profit after works: a light refresh on the ordinary model; a full project after the 75% refinance', () => {
  const light = profitAfterWorksPcm({ level: 'light', price: 240_000, value: 260_090, bedrooms: 3, grossRevenue: 40_000 });
  assert.equal(light, purchaseDeal(240_000, { grossRevenue: 40_000, adr: 0, bedrooms: 3 }).cashflowMonthly);
  const full = profitAfterWorksPcm({ level: 'full', price: 70_000, value: 127_800, bedrooms: 3, grossRevenue: 30_000, finance: { mortgageRatePct: 6, termYears: 20 } });
  const net = purchaseDeal(70_000, { grossRevenue: 30_000, adr: 0, bedrooms: 3 }).netOperating;
  // Batch 16b: every purchase mortgage is interest-only, the refinance's included.
  assert.equal(full, Math.round(net / 12 - (95_850 * 0.06) / 12), 'the member’s own rate on 75% of the value, interest-only');
  const repayment = profitAfterWorksPcm({ level: 'full', price: 70_000, value: 127_800, bedrooms: 3, grossRevenue: 30_000, finance: { mortgageRatePct: 6, termYears: 20, mortgageType: 'repayment' } });
  assert.equal(repayment, Math.round(net / 12 - monthlyMortgage(95_850, 6, 20)), 'the repayment formula stays behind the one setting');
});
