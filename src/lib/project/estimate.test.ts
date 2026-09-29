import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestCase, estimateFromFindings, evaluateLines } from './estimate.ts';
import { lineCost, linesFromFindings, levelFor, quantitiesFor, summariseWorks, type LineKey, type LineStatus, type PhotoFindings, type PropertyFacts } from './costing.ts';
import { DEFAULT_PROJECT_SETTINGS } from './config.ts';

const NO_COUNTS: PhotoFindings['counts'] = { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null };

function findings(condition: PhotoFindings['condition'], kitchenSize: PhotoFindings['kitchenSize'], statuses: Partial<Record<LineKey, LineStatus>>): PhotoFindings {
  const lines: PhotoFindings['lines'] = {};
  for (const [k, status] of Object.entries(statuses) as [LineKey, LineStatus][]) lines[k] = { status, reason: `${k} ${status}`, photos: [1] };
  return { condition, kitchenSize, lines, counts: NO_COUNTS };
}

const HOUSE_3: PropertyFacts = { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null };

// The plan's three worked examples (29 Sep 2026), line statuses as read from each listing.

test('Wilberfoss YO41, a light refresh: £3,355–£18,744 of works, £260,090 after works, £1,346 added: fails', () => {
  const out = estimateFromFindings({
    price: 240_000,
    facts: { ...HOUSE_3, floorAreaSqft: 818 },
    country: 'england',
    ceiling: null,
    findings: findings('light', 'big', {
      radiators: 'not_needed',
      bathroom: 'not_needed',
      plaster: 'not_needed',
      skirting: 'not_needed',
      paint: 'needed',
      kitchen: 'not_needed',
      carpet: 'needed',
      windows: 'not_needed',
      outside_doors: 'not_needed',
      internal_doors: 'not_needed',
      boiler: 'cant_tell',
      roof: 'cant_tell',
      damp: 'cant_tell',
    }),
  });
  assert.equal(out.kind, 'project');
  if (out.kind !== 'project') return;
  const e = out.estimate;
  const byKey = new Map(e.lines.map((l) => [l.key, l]));
  assert.equal(lineCost(byKey.get('rewire')!), 4_090, '818 sq ft of a 900 sq ft £4,500 rewire');
  assert.equal(e.works.neededLines, 3_050, 'waste £300 + paint 5 × £350 + carpet 4 × £250');
  assert.equal(e.works.cantTellLines, 13_990);
  assert.deepEqual([e.works.low, e.works.high], [3_355, 18_744]);
  assert.equal(e.level, 'light');
  assert.equal(e.value.fromWorks, 260_090);
  assert.equal(e.test.valueAdded, 1_346);
  assert.equal(e.test.passes, false);
  assert.equal(e.test.missed, 'amount');
  assert.equal(e.finance.stampDuty, 14_300);
  assert.equal(e.finance.buyingCosts, 2_500);
  assert.equal(e.finance.months, 2);
  assert.deepEqual(e.finance.holding, { low: 500, high: 500 });
  assert.deepEqual(e.finance.moneyIn, { low: 260_655, high: 276_044 });
  assert.deepEqual(e.finance.cash, { low: 97_155, high: 112_544 }, '25% deposit £60,000 + tax + buying + works + holding + £16,500 furnishing');
  assert.equal(e.finance.refinance, null);
  assert.equal(e.finance.bridge, null);
});

test('Norton YO17, a full project: £26,620–£39,710 of works, £127,800 after works, £18,090 (14.2%) added: passes rule B', () => {
  const out = estimateFromFindings({
    price: 70_000,
    facts: HOUSE_3,
    country: 'england',
    ceiling: { value: 165_000, sales: 4, radiusMiles: 3, basis: 'type' },
    findings: findings('full', 'small', {
      radiators: 'needed',
      bathroom: 'needed',
      plaster: 'needed',
      skirting: 'needed',
      paint: 'needed',
      kitchen: 'needed',
      carpet: 'needed',
      windows: 'needed',
      outside_doors: 'needed',
      internal_doors: 'needed',
      boiler: 'needed',
      roof: 'cant_tell',
      damp: 'cant_tell',
    }),
  });
  assert.equal(out.kind, 'project');
  if (out.kind !== 'project') return;
  const e = out.estimate;
  assert.equal(e.works.visibleNeeded, 21_700);
  assert.equal(e.works.neededLines, 24_200, 'the old boiler is needed but counts at cost');
  assert.equal(e.works.cantTellLines, 11_900);
  assert.deepEqual([e.works.low, e.works.high], [26_620, 39_710]);
  assert.equal(e.level, 'full');
  assert.equal(e.value.fromWorks, 127_800);
  assert.equal(e.value.ceilingApplied, false);
  assert.equal(e.test.valueAdded, 18_090);
  assert.equal(e.test.valueAddedPct, 14.2);
  assert.equal(e.test.passes, true);
  const f = e.finance;
  assert.equal(f.stampDuty, 3_500);
  assert.equal(f.buyingCosts, 3_500);
  assert.equal(f.months, 4);
  assert.deepEqual(f.bridge, { loan: 49_000, ltvPct: 70, monthlyPct: 0.85, interest: { low: 1_666, high: 1_666 }, arrangementFee: 980, legalAndValuation: 0 });
  assert.deepEqual(f.holding, { low: 3_646, high: 3_646 }, 'interest £1,666 + arrangement £980 + bills 4 × £250');
  assert.deepEqual(f.moneyIn, { low: 107_266, high: 120_356 });
  assert.deepEqual(f.cash, { low: 74_766, high: 87_856 }, 'the works are paid in cash (Q8)');
  assert.deepEqual(f.refinance, { pct: 75, loan: 95_850, moneyLeftIn: { low: 27_916, high: 41_006 } });
});

test('Cambridge CB, well kept: £3,355–£19,195 of works, £470,500 after works, £1,305 added: fails', () => {
  const out = estimateFromFindings({
    price: 450_000,
    facts: HOUSE_3,
    country: 'england',
    ceiling: null,
    findings: findings('light', 'big', { paint: 'needed', carpet: 'needed', kitchen: 'not_needed', radiators: 'not_needed', bathroom: 'not_needed', plaster: 'not_needed', skirting: 'not_needed', windows: 'not_needed', outside_doors: 'not_needed', internal_doors: 'not_needed', boiler: 'cant_tell', roof: 'cant_tell', damp: 'cant_tell' }),
  });
  assert.equal(out.kind, 'project');
  if (out.kind !== 'project') return;
  const e = out.estimate;
  assert.deepEqual([e.works.low, e.works.high], [3_355, 19_195]);
  assert.equal(e.value.fromWorks, 470_500);
  assert.equal(e.test.valueAdded, 1_305);
  assert.equal(e.test.passes, false);
  assert.equal(e.finance.stampDuty, 35_000);
  assert.equal(e.finance.moneyIn.high, 507_195);
});

test('the ceiling caps the value when it is the lower, and the test runs on the capped value', () => {
  const lines = linesFromFindings(HOUSE_3, findings('full', 'small', { radiators: 'needed', bathroom: 'needed', plaster: 'needed', skirting: 'needed', paint: 'needed', kitchen: 'needed', carpet: 'needed', windows: 'needed', outside_doors: 'needed', internal_doors: 'needed', boiler: 'needed', roof: 'cant_tell', damp: 'cant_tell' }));
  const e = evaluateLines({ price: 70_000, facts: HOUSE_3, country: 'england', level: 'full', lines, ceiling: { value: 110_000, sales: 8, radiusMiles: 1, basis: 'bedrooms' } });
  assert.equal(e.value.ceilingApplied, true);
  assert.equal(e.value.value, 110_000);
  assert.equal(e.test.valueAdded, 110_000 - 70_000 - 39_710);
  assert.equal(e.test.passes, false);
  assert.equal(e.finance.refinance?.loan, 82_500, '75% of the capped value');
});

test('ready to go: the photos say so and the clearly needed works are small', () => {
  const out = estimateFromFindings({ price: 150_000, facts: HOUSE_3, country: 'england', ceiling: null, findings: findings('ready', 'big', { paint: 'needed' }) });
  assert.equal(out.kind, 'ready');
});

test('light or full (Q4): the photos rate it, the clearly needed works override', () => {
  assert.equal(levelFor('full', 26_620), 'full');
  assert.equal(levelFor('full', 4_999), 'light', 'a full rating under £5,000 of needed works is a light refresh');
  assert.equal(levelFor('light', 15_001), 'full', 'over £15,000 is a full project whatever the photos say');
  assert.equal(levelFor('light', 15_000), 'light');
  assert.equal(levelFor('ready', 16_000), 'full');
  assert.equal(levelFor('ready', 5_000), 'light');
  assert.equal(levelFor('ready', 4_999), 'ready');
});

test('quantities follow the bedrooms, and a photo count can only lower one', () => {
  const q = quantitiesFor(HOUSE_3);
  assert.deepEqual([q.rooms, q.bathrooms, q.radiators, q.carpets, q.windows, q.outsideDoors, q.internalDoors, q.dampWalls, q.roofs], [5, 1, 6, 4, 6, 2, 5, 4, 1]);
  assert.equal(q.rewireScale, 1);
  const flat = quantitiesFor({ bedrooms: 2, bathrooms: 1, propertyKind: 'flat', floorAreaSqft: 600 });
  assert.deepEqual([flat.rooms, flat.outsideDoors, flat.dampWalls, flat.roofs], [4, 1, 2, 0]);
  assert.equal(flat.rewireBasis, 'floor_area');
  const lowered = quantitiesFor(HOUSE_3, { windows: 4, radiators: 9, rooms: 4 });
  assert.equal(lowered.windows, 4);
  assert.equal(lowered.radiators, 5, 'rooms 4 + 1 bathroom; the photos showing 9 cannot raise it');
  assert.equal(lowered.rooms, 4);
});

test('a flat has no roof of its own; hidden lines are never taken from the photos', () => {
  const lines = linesFromFindings({ bedrooms: 2, bathrooms: 1, propertyKind: 'flat', floorAreaSqft: null }, findings('full', 'small', { roof: 'needed', paint: 'needed' }));
  const roof = lines.find((l) => l.key === 'roof')!;
  assert.equal(roof.status, 'not_needed');
  assert.equal(roof.quantity, 0);
  const rewire = lines.find((l) => l.key === 'rewire')!;
  assert.equal(rewire.status, 'cant_tell');
  assert.deepEqual(rewire.photos, []);
});

test('a line the check left out is "can\'t tell", never "not needed"; waste follows the rest', () => {
  const lines = linesFromFindings(HOUSE_3, findings('light', null, {}));
  for (const l of lines) if (l.key !== 'roof') assert.equal(l.status, 'cant_tell', l.key);
  const kitchen = lines.find((l) => l.key === 'kitchen')!;
  assert.equal(lineCost(kitchen), 6_000, 'size not clear: priced as big');
  assert.match(kitchen.reason ?? '', /priced as big/);
});

test('a member switching lines and adding their own runs through the same sums', () => {
  const lines = linesFromFindings(HOUSE_3, findings('full', 'small', { paint: 'needed', kitchen: 'needed' }));
  const edited = lines.map((l) => (l.key === 'kitchen' ? { ...l, unitCost: 5_000 } : l.key === 'roof' ? { ...l, status: 'not_needed' as const } : l));
  edited.push({ key: 'own-1', label: 'New fence', unit: 'job', unitCost: 1_200, quantity: 1, status: 'needed', valueRole: 'hidden', reason: null, photos: [], own: true });
  const ours = summariseWorks(lines);
  const theirs = summariseWorks(edited);
  assert.equal(theirs.neededLines, ours.neededLines + 1_000 + 1_200);
  assert.equal(theirs.cantTellLines, ours.cantTellLines - 3_000);
});

test('the free best case: every visible line needed, extra-big kitchen, no ceiling', () => {
  const b = bestCase(150_000, HOUSE_3);
  assert.equal(b.worksHigh, 36_520, '(£25,700 visible + £7,500 hidden) × 1.1');
  assert.equal(b.valueAdded, 22_380, '0.9 × £25,700 − 0.1 × £7,500, whatever the price');
  assert.equal(b.passes, true);
  const dear = bestCase(200_000, HOUSE_3);
  assert.equal(dear.valueAdded, 22_380);
  assert.equal(dear.passes, false, 'under 10% of a £258,900 value');
});

test('every figure comes from the settings: a changed rate moves the works', () => {
  const s = { ...DEFAULT_PROJECT_SETTINGS, rates: { ...DEFAULT_PROJECT_SETTINGS.rates, paint: 400, contingencyPct: 0 } };
  const lines = linesFromFindings(HOUSE_3, findings('light', null, { paint: 'needed' }), s.rates, s.quantities);
  const w = summariseWorks(lines, s.rates.contingencyPct);
  assert.equal(w.low, 300 + 5 * 400);
});
