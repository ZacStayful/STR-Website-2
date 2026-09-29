import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capLeftPence,
  claimCapPence,
  dayUseFromRuns,
  failedDay,
  needsPrep,
  needsRecost,
  parsePrep,
  photoChecksLeft,
  projectFactsOf,
  readyForCheck,
  reusableCheck,
  verdictFor,
  type EarlierCheck,
  type Prep,
} from './check-plan.ts';
import { estimateFromFindings } from './estimate.ts';
import { LINE_SPECS, type LineFinding, type LineKey, type PhotoFindings } from './costing.ts';

const TODAY = '2026-09-29';

const prep = (over: Partial<Prep> = {}): Prep => ({
  price: 70_000,
  preppedOn: TODAY,
  photos: ['https://img/1.jpg', 'https://img/2.jpg'],
  floorplans: ['https://img/fp.jpg'],
  facts: { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null, rawType: 'End of Terrace', homeType: 'terraced', country: 'england' },
  ceiling: { value: 170_000, sales: 12, radiusMiles: 1, basis: 'type' },
  outcome: 'ready',
  failedDays: 0,
  lastFailedDay: null,
  ...over,
});

test('a stored prep row reads back, and anything unreadable reads as not prepped', () => {
  const p = parsePrep({
    price: '70000',
    prepped_on: '2026-09-29',
    photos: ['https://a', 3, ''],
    floorplans: null,
    facts: { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null, rawType: 'Terraced', homeType: 'terraced', country: 'wales' },
    ceiling: { value: 150000, sales: 8, radiusMiles: 2, basis: 'bedrooms' },
    outcome: 'ready',
    failed_days: 2,
    last_failed_day: '2026-09-28',
  });
  assert.ok(p);
  assert.equal(p.price, 70_000);
  assert.deepEqual(p.photos, ['https://a']);
  assert.deepEqual(p.floorplans, []);
  assert.equal(p.facts?.country, 'wales');
  assert.equal(p.ceiling?.basis, 'bedrooms');
  assert.equal(p.failedDays, 2);
  assert.equal(parsePrep(null), null);
  const odd = parsePrep({ outcome: 'bogus', facts: { bedrooms: -1 }, ceiling: { value: 0 } });
  assert.equal(odd?.outcome, null);
  assert.equal(odd?.facts, null);
  assert.equal(odd?.ceiling, null);
});

test('the costing facts from a listing: a flat is a flat, a bedroom count is needed, the tax country from the postcode', () => {
  assert.deepEqual(projectFactsOf({ bedrooms: 2, bathrooms: 1, rawType: 'Flat', floorAreaSqft: 650, postcode: 'CF10 1AA' }), { bedrooms: 2, bathrooms: 1, propertyKind: 'flat', floorAreaSqft: 650, rawType: 'Flat', homeType: 'flat', country: 'wales' });
  const house = projectFactsOf({ bedrooms: 3, rawType: 'Semi-Detached', outcode: 'YO41' });
  assert.equal(house?.propertyKind, 'house');
  assert.equal(house?.homeType, 'semi');
  assert.equal(house?.country, 'england');
  assert.equal(house?.bathrooms, null);
  assert.equal(projectFactsOf({ bedrooms: null, rawType: 'Terraced' }), null);
  assert.equal(projectFactsOf({ bedrooms: 2, rawType: null })?.propertyKind, 'house', 'an unknown type is costed as a house');
});

test('ready for its photo check: prepped today at this price, every step passed, nothing failed today', () => {
  assert.equal(readyForCheck(prep(), 70_000, TODAY), true);
  assert.equal(readyForCheck(prep(), 65_000, TODAY), false, 'the price moved since the prep');
  assert.equal(readyForCheck(prep({ preppedOn: '2026-09-28' }), 70_000, TODAY), false, 'prepped yesterday');
  assert.equal(readyForCheck(prep({ outcome: 'failed' }), 70_000, TODAY), false);
  assert.equal(readyForCheck(prep({ lastFailedDay: TODAY }), 70_000, TODAY), false, 'its check failed today');
  assert.equal(readyForCheck(prep({ photos: [] }), 70_000, TODAY), false);
  assert.equal(readyForCheck(prep({ ceiling: null }), 70_000, TODAY), false);
  assert.equal(readyForCheck(null, 70_000, TODAY), false);
});

test('prepped once a UK day, and not again the day a step failed', () => {
  assert.equal(needsPrep(null, 70_000, TODAY), true);
  assert.equal(needsPrep(prep(), 70_000, TODAY), false);
  assert.equal(needsPrep(prep({ preppedOn: '2026-09-28' }), 70_000, TODAY), true, 'a new day');
  assert.equal(needsPrep(prep(), 60_000, TODAY), true, 'repriced since');
  assert.equal(needsPrep(prep({ preppedOn: '2026-09-28', lastFailedDay: TODAY }), 70_000, TODAY), false, 'failed today: tomorrow');
});

test('a failed day counts once however often it fails, and the third lets it go', () => {
  assert.deepEqual(failedDay(null, TODAY, 3), { failedDays: 1, lastFailedDay: TODAY, giveUp: false });
  assert.deepEqual(failedDay({ failedDays: 1, lastFailedDay: TODAY }, TODAY, 3), { failedDays: 1, lastFailedDay: TODAY, giveUp: false }, 'the same day again');
  assert.deepEqual(failedDay({ failedDays: 1, lastFailedDay: '2026-09-28' }, TODAY, 3), { failedDays: 2, lastFailedDay: TODAY, giveUp: false });
  assert.deepEqual(failedDay({ failedDays: 2, lastFailedDay: '2026-09-28' }, TODAY, 3), { failedDays: 3, lastFailedDay: TODAY, giveUp: true });
  assert.equal(failedDay(null, TODAY, 1).giveUp, true);
});

const findings = (status: LineFinding['status'] = 'needed'): PhotoFindings => {
  const lines: Partial<Record<LineKey, LineFinding>> = {};
  for (const s of LINE_SPECS) lines[s.key] = { status: s.sight === 'hidden' ? 'cant_tell' : status, reason: 'x', photos: [1] };
  return { condition: 'full', kitchenSize: 'small', lines, counts: { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null } };
};

test('an earlier photo check is reused only for exactly the same photos, within the window', () => {
  const at = new Date('2026-09-29T05:00:00Z');
  const earlier: EarlierCheck[] = [
    { id: 'old', photos: ['https://img/1.jpg', 'https://img/2.jpg'], floorplans: ['https://img/fp.jpg'], at: '2026-06-01T05:00:00Z', findings: findings() },
    { id: 'new', photos: ['https://img/1.jpg', 'https://img/2.jpg'], floorplans: ['https://img/fp.jpg'], at: '2026-09-01T05:00:00Z', findings: findings() },
    { id: 'other', photos: ['https://img/2.jpg', 'https://img/1.jpg'], floorplans: ['https://img/fp.jpg'], at: '2026-09-20T05:00:00Z', findings: findings() },
  ];
  const now = { photos: ['https://img/1.jpg', 'https://img/2.jpg'], floorplans: ['https://img/fp.jpg'] };
  assert.equal(reusableCheck(earlier, now, at, 60)?.id, 'new', 'the newest within 60 days with the same photos in the same order');
  assert.equal(reusableCheck(earlier, now, at, 20), null, 'too old');
  assert.equal(reusableCheck(earlier, { ...now, floorplans: [] }, at, 60), null, 'the floorplan changed');
  assert.equal(reusableCheck(earlier, now, at, 0), null, 'reuse off');
  assert.equal(reusableCheck(earlier, { photos: [], floorplans: [] }, at, 60), null);
});

test('the day’s spend line: photo checks, sold prices and planning checks together', () => {
  const allowance = { photoChecks: 5, capPence: 250 };
  const use = { photoChecks: 2, photoPence: 21.5, otherPence: 30, soldLookups: 6 };
  assert.equal(capLeftPence(allowance, use), 198.5);
  assert.equal(photoChecksLeft(allowance, use), 3);
  assert.equal(claimCapPence(allowance, 30), 220, 'the claim function adds the photo spend itself');
  assert.equal(capLeftPence({ photoChecks: 5, capPence: 40 }, use), 0, 'never below nothing');
  assert.deepEqual(dayUseFromRuns([{ otherPence: 5, soldLookups: 2 }, { otherPence: '2.5', soldLookups: 1 }, null, { rawCostPence: 12 }]), { otherPence: 7.5, soldLookups: 3 });
});

test('the verdict: ready to go is released, a pass goes live with card numbers only, a fail is never shown', () => {
  const now = new Date('2026-09-29T05:00:00Z');
  const facts = { bedrooms: 3, bathrooms: 1, propertyKind: 'house' as const, floorAreaSqft: null };
  const pass = verdictFor(estimateFromFindings({ price: 70_000, facts, country: 'england', ceiling: null, findings: findings() }), 3, now);
  assert.equal(pass.kind, 'project');
  if (pass.kind === 'project') {
    assert.ok(pass.card.valueAdded >= 15_000);
    // Card-safe: numbers only, never a line, a reason or a photo.
    assert.ok(!JSON.stringify(pass.card).includes('reason'));
    assert.ok(!('lines' in pass.card));
  }
  const dear = verdictFor(estimateFromFindings({ price: 450_000, facts, country: 'england', ceiling: null, findings: findings() }), 3, now);
  assert.equal(dear.kind, 'not_project', 'the same works on a dear house cannot reach 10% of its value');
  const ready: PhotoFindings = { ...findings('not_needed'), condition: 'ready' };
  assert.equal(verdictFor(estimateFromFindings({ price: 200_000, facts, country: 'england', ceiling: null, findings: ready }), 3, now).kind, 'ready');
});

test('a live Project deal is re-costed when its price moves', () => {
  assert.equal(needsRecost({ price: 70_000 }, 65_000), true);
  assert.equal(needsRecost({ price: 70_000 }, '70000'), false);
  assert.equal(needsRecost(null, 65_000), false);
  assert.equal(needsRecost({ price: 70_000 }, null), false);
});
