import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterResponses, patternsFromResponses, priceBand, typeBand, sizeBand, weekOf, responsesCsv, type ResponseRow } from './picks-patterns.ts';

const row = (over: Partial<ResponseRow> = {}): ResponseRow => ({
  id: 'r1',
  userId: 'u1',
  email: 'a@example.com',
  sentAt: '2026-09-20T07:00:00.000Z',
  respondedAt: '2026-09-20T09:00:00.000Z',
  reaction: 'no',
  reactionSource: 'form',
  reasons: ['too_expensive'],
  comment: '',
  kind: 'sale',
  basis: 'house',
  postcodeArea: 'YO',
  areaName: 'York',
  title: '3 bedroom terraced house for sale',
  address: '1 High St, York',
  url: 'https://www.rightmove.co.uk/properties/1',
  bedrooms: 3,
  rawType: 'Terraced house',
  tenure: 'freehold',
  amount: 230_000,
  fit: 70,
  dealScore: 11.2,
  savedAt: null,
  ...over,
});

test('bands and weeks', () => {
  assert.equal(priceBand('sale', 120_000), 'Under £150k');
  assert.equal(priceBand('sale', 250_000), '£250–400k');
  assert.equal(priceBand('rent', 950), '£800–1,200 pcm');
  assert.equal(priceBand('rent', null), 'Price unknown');
  assert.equal(typeBand('Flat', 'x'), 'Flats');
  assert.equal(typeBand(null, '2 bedroom apartment for sale'), 'Flats');
  assert.equal(typeBand('Detached', 'x'), 'Houses');
  assert.equal(typeBand(null, 'Plot of land'), 'Other / unknown');
  assert.equal(sizeBand(5), '4+ bed');
  assert.equal(sizeBand(null), 'Size unknown');
  assert.equal(weekOf('2026-09-20T09:00:00.000Z'), '2026-09-14'); // Sunday → the Monday before
  assert.equal(weekOf('2026-09-14T00:00:00.000Z'), '2026-09-14');
});

test('filterResponses narrows by reaction, reason, kind, basis, area and text', () => {
  const rows = [row(), row({ id: 'r2', reaction: 'yes', reasons: [], kind: 'rent', basis: 'goals', postcodeArea: 'BS', email: 'b@example.com', comment: 'lovely' }), row({ id: 'r3', reactionSource: 'link', reasons: [] })];
  assert.deepEqual(filterResponses(rows, { reaction: 'yes' }).map((r) => r.id), ['r2']);
  assert.deepEqual(filterResponses(rows, { reason: 'too_expensive' }).map((r) => r.id), ['r1']);
  assert.deepEqual(filterResponses(rows, { kind: 'rent' }).map((r) => r.id), ['r2']);
  assert.deepEqual(filterResponses(rows, { basis: 'house' }).map((r) => r.id), ['r1', 'r3']);
  assert.deepEqual(filterResponses(rows, { area: 'bs' }).map((r) => r.id), ['r2']);
  assert.deepEqual(filterResponses(rows, { q: 'LOVELY' }).map((r) => r.id), ['r2']);
  assert.deepEqual(filterResponses(rows, { q: 'b@' }).map((r) => r.id), ['r2']);
  assert.equal(filterResponses(rows, {}).length, 3);
});

test('patternsFromResponses cuts the answers every way the admin page shows', () => {
  const rows = [
    row(),
    row({ id: 'r2', userId: 'u2', email: 'b@example.com', reasons: ['too_expensive', 'no_flats'], rawType: 'Flat', title: '2 bedroom flat for sale', bedrooms: 2, amount: 300_000 }),
    row({ id: 'r3', reaction: 'yes', reasons: [], reactionSource: 'link', respondedAt: '2026-09-22T09:00:00.000Z' }),
    row({ id: 'r4', userId: 'u2', reactionSource: 'link', reasons: [], comment: 'meh', kind: 'rent', amount: 900, basis: 'goals', postcodeArea: 'BS', areaName: 'Bristol' }),
  ];
  const p = patternsFromResponses(rows);
  assert.equal(p.total, 4);
  assert.equal(p.yes, 1);
  assert.equal(p.no, 3);
  assert.equal(p.withReasons, 2);
  assert.equal(p.withComment, 1);
  assert.equal(p.linkOnly, 2);
  assert.deepEqual(p.reasons.map((r) => [r.key, r.count, r.share]), [['too_expensive', 2, 67], ['no_flats', 1, 33]]);
  assert.deepEqual(p.byKind.map((c) => [c.label, c.yes, c.no, c.noRate]), [['To buy', 1, 2, 67], ['Rent-to-rent', 0, 1, 100]]);
  assert.deepEqual(p.byBasis.map((c) => c.label), ['From a filter', 'House picks']);
  assert.deepEqual(p.byType.find((c) => c.label === 'Flats')?.topReasons.map((r) => r.key), ['no_flats', 'too_expensive']);
  assert.deepEqual(p.bySize.map((c) => c.label), ['2 bed', '3 bed']);
  assert.equal(p.byPrice.find((c) => c.label === '£250–400k')?.no, 1);
  assert.equal(p.byArea[0].label, 'York (YO)');
  assert.deepEqual(p.members.map((m) => [m.userId, m.yes, m.no]), [['u2', 0, 2], ['u1', 1, 1]]);
  assert.deepEqual(p.members[0].reasons.map((r) => r.key), ['no_flats', 'too_expensive']);
  assert.deepEqual(p.weekly.map((w) => [w.week, w.yes, w.no, w.withReasons]), [['2026-09-14', 0, 3, 2], ['2026-09-21', 1, 0, 0]]);
  assert.equal(patternsFromResponses([]).total, 0);
});

test('responsesCsv quotes commas and quotes', () => {
  const csv = responsesCsv([row({ comment: 'too far, "really"', reasons: ['too_expensive', 'wrong_area'] })]);
  const [head, line] = csv.split('\r\n');
  assert.ok(head.startsWith('responded_at,sent_at,email,reaction'));
  assert.ok(line.includes('"too far, ""really"""'));
  assert.ok(line.includes('Too expensive; Wrong area'));
  assert.ok(line.endsWith('https://www.rightmove.co.uk/properties/1'));
});

test('a yes never contributes reasons, so a share cannot exceed 100%', () => {
  // A member answers no with a reason, then re-clicks "yes" in the email: the
  // stored row is a yes still carrying the reason.
  const p = patternsFromResponses([row({ reaction: 'yes', reasons: ['too_expensive'] }), row({ id: 'r2', reaction: 'no', reasons: ['too_expensive'] })]);
  assert.equal(p.yes, 1);
  assert.equal(p.no, 1);
  assert.deepEqual(p.reasons.map((r) => [r.key, r.count, r.share]), [['too_expensive', 1, 100]]);
  assert.ok(p.reasons.every((r) => r.share <= 100));
});

test('areas are ordered worst rate first, with a floor on answers', () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row({ id: `y${i}`, reaction: 'yes', reasons: [], postcodeArea: 'YO', areaName: 'York' })),
    ...Array.from({ length: 10 }, (_, i) => row({ id: `n${i}`, postcodeArea: 'YO', areaName: 'York' })),
    ...Array.from({ length: 5 }, (_, i) => row({ id: `h${i}`, postcodeArea: 'HU', areaName: 'Hull' })),
    row({ id: 'solo', postcodeArea: 'ZZ', areaName: 'Nowhere' }),
  ];
  const p = patternsFromResponses(rows);
  // Hull is 100% no over 5 answers, York 50% over 20: Hull leads.
  assert.deepEqual(p.byArea.slice(0, 2).map((c) => c.label), ['Hull (HU)', 'York (YO)']);
  // A single answer at 100% is noise and sorts below both.
  assert.equal(p.byArea[p.byArea.length - 1].label, 'Nowhere (ZZ)');
});

test('csvCell neutralises a comment Excel would run as a formula', () => {
  const csv = responsesCsv([row({ comment: '=cmd|\' /c calc\'!A1' }), row({ id: 'r2', comment: '+1-2' }), row({ id: 'r3', comment: '@SUM(A1)' }), row({ id: 'r4', comment: 'plain text' })]);
  const lines = csv.trim().split('\r\n').slice(1);
  assert.ok(lines[0].includes("'=cmd"), lines[0]);
  assert.ok(lines[1].includes("'+1-2"));
  assert.ok(lines[2].includes("'@SUM(A1)"));
  assert.ok(lines[3].includes('plain text') && !lines[3].includes("'plain"));
});
