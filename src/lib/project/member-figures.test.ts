import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMemberLines, countryOfTax, evaluateMember, MAX_OWN_LINES, memberContextFrom, memberFiguresFrom, nextOwnKey } from './member-figures.ts';
import { estimateFromFindings, type ProjectEstimate } from './estimate.ts';
import { LINE_SPECS, type LineFinding, type LineKey, type PhotoFindings } from './costing.ts';
import { DEFAULT_PROJECT_SETTINGS } from './config.ts';

function findings(): PhotoFindings {
  const lines: Partial<Record<LineKey, LineFinding>> = {};
  for (const s of LINE_SPECS) lines[s.key] = { status: s.sight === 'hidden' ? 'cant_tell' : 'needed', reason: 'From the photos', photos: [1] };
  return { condition: 'full', kitchenSize: 'small', lines, counts: { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null } };
}

const outcome = estimateFromFindings({ price: 70_000, facts: { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null }, country: 'england', ceiling: null, findings: findings() });
assert.equal(outcome.kind, 'project');
const estimate = (outcome as { kind: 'project'; estimate: ProjectEstimate }).estimate;
const ctx = memberContextFrom(estimate, 3, DEFAULT_PROJECT_SETTINGS);

test('unchanged, the member’s working is our estimate to the pound: the same sums', () => {
  const e = evaluateMember(estimate.lines, ctx);
  assert.deepEqual(e.works, estimate.works);
  assert.equal(e.value.value, estimate.value.value);
  assert.equal(e.test.valueAdded, estimate.test.valueAdded);
  assert.deepEqual(e.finance.cash, estimate.finance.cash);
  const f = memberFiguresFrom(e, estimate.lines);
  assert.equal(f.changedLines, 0);
  assert.equal(f.ownLines, 0);
});

test('their changes: quantity, cost a unit and status on our lines; our reasons and photos stay', () => {
  const r = cleanMemberLines([{ key: 'kitchen', quantity: 1, unitCost: 9000, status: 'needed' }, { key: 'roof', status: 'not_needed' }], estimate.lines);
  assert.ok(r.ok);
  if (!r.ok) return;
  const kitchen = r.lines.find((l) => l.key === 'kitchen')!;
  assert.equal(kitchen.unitCost, 9000);
  assert.equal(kitchen.reason, 'From the photos', 'our reason is kept');
  assert.equal(r.lines.find((l) => l.key === 'roof')!.status, 'not_needed');
  assert.equal(r.lines.length, estimate.lines.length, 'a line not sent stays as we had it');
  const f = memberFiguresFrom(evaluateMember(r.lines, ctx), estimate.lines);
  assert.equal(f.changedLines, 2);
});

test('out-of-range numbers are held to the bounds; junk is refused, never guessed', () => {
  const r = cleanMemberLines([{ key: 'paint', quantity: -3, unitCost: 10_000_000 }, { key: 'bogus', quantity: 5 }], estimate.lines);
  assert.ok(r.ok);
  if (r.ok) {
    const paint = r.lines.find((l) => l.key === 'paint')!;
    assert.equal(paint.quantity, 0);
    assert.equal(paint.unitCost, 250_000);
    assert.ok(!r.lines.some((l) => l.key === 'bogus'), 'an unknown key is not read');
  }
  assert.deepEqual(cleanMemberLines('nope', estimate.lines), { ok: false, error: 'not_a_list' });
  assert.deepEqual(cleanMemberLines([{ key: 'paint' }, { key: 'paint' }], estimate.lines), { ok: false, error: 'bad_line' });
  assert.deepEqual(cleanMemberLines([{ key: 'own-1', label: '   ' }], estimate.lines), { ok: false, error: 'bad_line' }, 'a line of their own needs a label');
  const many = Array.from({ length: MAX_OWN_LINES + 1 }, (_, i) => ({ key: `own-${i + 1}`, label: `Line ${i + 1}`, quantity: 1, unitCost: 100 }));
  assert.deepEqual(cleanMemberLines(many, estimate.lines), { ok: false, error: 'too_many_own_lines' });
});

test('a line of their own counts at cost in the value, never twice over', () => {
  const r = cleanMemberLines([{ key: 'own-1', label: 'Garden <b>clearance</b>', quantity: 1, unitCost: 2000 }], estimate.lines);
  assert.ok(r.ok);
  if (!r.ok) return;
  const own = r.lines.find((l) => l.key === 'own-1')!;
  assert.equal(own.label, 'Garden bclearance/b', 'no markup');
  assert.equal(own.valueRole, 'hidden');
  const before = evaluateMember(estimate.lines, ctx);
  const after = evaluateMember(r.lines, ctx);
  // £2,000 more works (and 10% contingency) at the low end; the value moves by the £2,000 at cost only.
  assert.equal(after.works.low - before.works.low, 2200);
  assert.ok(after.value.value - before.value.value <= 2000);
  assert.ok(after.test.valueAdded < before.test.valueAdded, 'adding works never makes the deal look better');
});

test('the next line of their own, and the nation of a stored estimate', () => {
  assert.equal(nextOwnKey([{ key: 'paint' }]), 'own-1');
  assert.equal(nextOwnKey([{ key: 'own-1' }, { key: 'own-4' }]), 'own-5');
  assert.equal(countryOfTax('SDLT'), 'england');
  assert.equal(countryOfTax('LTT'), 'wales');
  assert.equal(countryOfTax('LBTT'), 'scotland');
});
