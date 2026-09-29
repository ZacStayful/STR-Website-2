import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineVersusOurs, parseReportProject, parseReportProjectMine, quantityLabel, reportProjectFrom, reportProjectMineFrom, spanLabel, valueBasis } from './report.ts';
import { estimateFromFindings, type ProjectEstimate } from './estimate.ts';
import { LINE_SPECS, lineCost, type LineFinding, type LineKey, type PhotoFindings } from './costing.ts';
import { cleanMemberLines, evaluateMember, memberContextFrom, memberFiguresFrom } from './member-figures.ts';
import { DEFAULT_PROJECT_SETTINGS } from './config.ts';

function findings(): PhotoFindings {
  const lines: Partial<Record<LineKey, LineFinding>> = {};
  for (const s of LINE_SPECS) lines[s.key] = { status: s.sight === 'hidden' ? 'cant_tell' : s.key === 'roof' ? 'not_needed' : 'needed', reason: 'Dated, from the photos', photos: [2, 3] };
  return { condition: 'full', kitchenSize: 'small', lines, counts: { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null } };
}

const outcome = estimateFromFindings({ price: 70_000, facts: { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null }, country: 'england', ceiling: null, findings: findings() });
const estimate = (outcome as { kind: 'project'; estimate: ProjectEstimate }).estimate;

test('the report keeps our estimate’s figures, and no photo or photo number', () => {
  const p = reportProjectFrom(estimate, '2026-09-29T09:00:00.000Z', 1234.4);
  assert.equal(p.level, estimate.level);
  assert.equal(p.works.low, estimate.works.low);
  assert.equal(p.works.high, estimate.works.high);
  assert.equal(p.value, estimate.value.value);
  assert.equal(p.valueAdded, estimate.test.valueAdded);
  assert.deepEqual(p.finance.cash, estimate.finance.cash);
  assert.equal(p.profitAfterWorksPcm, 1234);
  assert.ok(p.notNeeded.includes(estimate.lines.find((l) => l.key === 'roof')!.label));
  assert.equal(p.lines.length + p.notNeeded.length, estimate.lines.length);
  for (const l of p.lines) assert.notEqual(l.status, 'not_needed');
  const kitchen = estimate.lines.find((l) => l.key === 'kitchen')!;
  const printed = p.lines.find((l) => l.label === kitchen.label)!;
  assert.equal(printed.cost, Math.round(lineCost(kitchen)));
  assert.equal(printed.reason, 'Dated, from the photos', 'the reason is kept');
  const json = JSON.stringify(p);
  assert.ok(!/"photos"|https?:/i.test(json), 'no photo list or URL on a stored report');
  assert.ok(p.finance.bridge && p.finance.refinance, 'a full project carries its bridge and refinance');
});

test('the stored shape reads back; anything else is no section', () => {
  const p = reportProjectFrom(estimate, '2026-09-29T09:00:00.000Z', null);
  assert.deepEqual(parseReportProject(JSON.parse(JSON.stringify(p))), p);
  assert.equal(parseReportProject(null), null);
  assert.equal(parseReportProject({ ...p, v: 2 }), null);
  assert.equal(parseReportProject({ ...p, lines: [{ label: 'x', quantity: 1, unitCost: 1, cost: 1, status: 'not_needed' }] }), null);
  assert.equal(parseReportProject({ ...p, finance: { ...p.finance, cash: null } }), null);
});

test('the viewer’s locked figures sit beside ours, and read back', () => {
  const ctx = memberContextFrom(estimate, 3, DEFAULT_PROJECT_SETTINGS);
  const r = cleanMemberLines([{ key: 'kitchen', quantity: 1, unitCost: 9000, status: 'needed' }], estimate.lines);
  assert.ok(r.ok);
  if (!r.ok) return;
  const f = memberFiguresFrom(evaluateMember(r.lines, ctx), estimate.lines);
  const mine = reportProjectMineFrom(f, 3, '2026-09-29T10:00:00.000Z');
  assert.equal(mine.works.high, f.worksHigh);
  assert.equal(mine.changedLines, 1);
  assert.deepEqual(parseReportProjectMine(JSON.parse(JSON.stringify(mine))), mine);
  assert.equal(parseReportProjectMine({ ...mine, cash: 5 }), null);
  const ours = reportProjectFrom(estimate, '2026-09-29T09:00:00.000Z', null);
  const line = mineVersusOurs(ours, mine);
  assert.match(line, /^Your locked figures \(version 3\): works £5,500 above ours at the high end, value added £4,500 more\.$/);
  assert.equal(mineVersusOurs(ours, { ...mine, works: { ...ours.works }, valueAdded: ours.valueAdded, passes: true }), 'Your locked figures (version 3): the same works as ours, the same value added.');
});

test('labels', () => {
  assert.equal(spanLabel({ low: 14_300, high: 26_100 }), '£14,300–£26,100');
  assert.equal(spanLabel({ low: 5_000.2, high: 5_000.4 }), '£5,000');
  assert.equal(quantityLabel({ quantity: 4, unitCost: 250 }), '4 × £250');
  assert.equal(quantityLabel({ quantity: 0.9, unitCost: 4500 }), '0.9 × £4,500');
  assert.match(valueBasis({ ceiling: { sales: 8, radiusMiles: 1 } }), /8 sales within 1 miles/);
  assert.match(valueBasis({ ceiling: null }), /twice the visible works/);
});
