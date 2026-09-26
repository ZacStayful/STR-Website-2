import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackedDeals, forViewer, groupByStage, stageCounts, countsLine, matchesFocus, type TrackedDealFacts, type TrackedInput, type TrackedPipelineInput } from './tracked.ts';
import { stageNeedsOpen, isPipelineStatus, PIPELINE_STATUSES, pipelineStatusInfo, type PipelineStatus } from './pipeline.ts';

const ME = 'me';
const MATE = 'mate';

function deal(id: string, over: Partial<TrackedDealFacts> = {}): TrackedDealFacts {
  return { id, canonicalUrl: `https://www.rightmove.co.uk/properties/${id}`, kind: 'sale', postcodeArea: 'M', price: { amount: 200_000, period: 'total' }, status: 'live', ...over };
}

function row(id: string, over: Partial<TrackedPipelineInput> = {}): TrackedPipelineInput {
  return { id, userId: ME, canonicalUrl: `https://www.rightmove.co.uk/properties/row-${id}`, source: 'rightmove', kind: 'sale', postcode: 'M1 1AA', postcodeArea: 'M', lat: null, lng: null, title: `Row ${id}`, displayAddress: `1 ${id} Street`, photo: null, bedrooms: 2, price: { amount: 150_000, period: 'total' }, listingStatus: null, status: 'watching', notes: '', shareToken: null, analysedReportId: null, quick: null, deal: null, updatedAt: '2026-09-01T00:00:00.000Z', ...over };
}

function input(over: Partial<TrackedInput>): TrackedInput {
  return { viewerId: ME, pipeline: [], reactions: [], opens: [], pickAnswers: [], deals: new Map(), ...over };
}

const deals = (...ds: TrackedDealFacts[]) => new Map(ds.map((d) => [d.id, d]));

test('stages: the old keys keep their meaning and the two new ones are valid', () => {
  assert.deepEqual(PIPELINE_STATUSES.map((s) => s.key), ['watching', 'contacted', 'viewing', 'offer', 'secured', 'passed']);
  assert.equal(pipelineStatusInfo('watching').label, 'Kept');
  assert.equal(pipelineStatusInfo('viewing').label, 'Viewing booked');
  assert.equal(pipelineStatusInfo('offer').label, 'Offer made');
  assert.equal(pipelineStatusInfo('passed').label, 'Passed');
  assert.equal(pipelineStatusInfo('contacted').label, 'Contacted agent / landlord');
  assert.equal(pipelineStatusInfo('secured').label, 'Secured');
  for (const s of PIPELINE_STATUSES) assert.equal(isPipelineStatus(s.key), true, s.key);
  assert.equal(isPipelineStatus('kept'), false);
  assert.equal(isPipelineStatus(undefined), false);
});

test('only Kept and Passed are allowed without an open', () => {
  assert.equal(stageNeedsOpen('watching'), false);
  assert.equal(stageNeedsOpen('passed'), false);
  for (const s of ['contacted', 'viewing', 'offer', 'secured'] as const) assert.equal(stageNeedsOpen(s), true, s);
});

test('existing pipeline rows land in their own stage, "watching" as Kept, junk as Kept', () => {
  const items = trackedDeals(input({ pipeline: [row('a', { status: 'watching' }), row('b', { status: 'viewing' }), row('c', { status: 'offer' }), row('d', { status: 'passed' }), row('e', { status: 'sold' as never })] }));
  assert.deepEqual(items.map((i) => [i.key, i.stage]), [['l-a', 'watching'], ['l-b', 'viewing'], ['l-c', 'offer'], ['l-d', 'passed'], ['l-e', 'watching']]);
  assert.ok(items.every((i) => i.opened && i.source === 'pipeline' && i.listing?.address));
});

test('a kept deal nobody opened never carries its URL or address', () => {
  const d = deal('k1');
  const [item] = trackedDeals(input({ reactions: [{ userId: ME, dealId: 'k1', reaction: 'keep', updatedAt: '2026-09-02T00:00:00.000Z' }], deals: deals(d) }));
  assert.equal(item.key, 'd-k1');
  assert.equal(item.stage, 'watching');
  assert.equal(item.opened, false);
  assert.equal(item.canonicalUrl, null);
  assert.equal(item.listing, null);
  assert.equal(item.area, 'M');
  assert.deepEqual(item.price, { amount: 200_000, period: 'total' });
});

test('a pass on a deal with no row lands in Passed', () => {
  const [item] = trackedDeals(input({ reactions: [{ userId: ME, dealId: 'p1', reaction: 'pass', updatedAt: '2026-09-02T00:00:00.000Z' }], deals: deals(deal('p1')) }));
  assert.equal(item.stage, 'passed');
});

test('precedence: pipeline row over reaction over open', () => {
  const d = deal('x');
  const items = trackedDeals(input({
    pipeline: [row('r1', { canonicalUrl: d.canonicalUrl, status: 'viewing', analysedReportId: 'rep1', updatedAt: '2026-09-10T00:00:00.000Z' })],
    // An older pass: the row changed since, so the row's stage stands.
    reactions: [{ userId: ME, dealId: 'x', reaction: 'pass', updatedAt: '2026-09-09T00:00:00.000Z' }],
    opens: [{ dealId: 'x', openedAt: '2026-09-01T00:00:00.000Z', viaPick: false }],
    deals: deals(d),
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'd-x');
  assert.equal(items[0].stage, 'viewing');
  assert.equal(items[0].checkedListingId, 'r1');
  assert.equal(items[0].reportId, 'rep1');
  assert.equal(items[0].dealId, 'x');

  const noRow = trackedDeals(input({ reactions: [{ userId: ME, dealId: 'x', reaction: 'keep', updatedAt: '2026-09-09T00:00:00.000Z' }], opens: [{ dealId: 'x', openedAt: '2026-09-01T00:00:00.000Z', viaPick: false }], deals: deals(d) }));
  assert.equal(noRow.length, 1);
  assert.equal(noRow[0].source, 'reaction');
  assert.equal(noRow[0].opened, true);
  assert.equal(noRow[0].canonicalUrl, d.canonicalUrl);
});

test('every opened deal appears at Kept, once, even without a row', () => {
  const items = trackedDeals(input({ opens: [{ dealId: 'o1', openedAt: '2026-09-03T00:00:00.000Z', viaPick: false }, { dealId: 'o1', openedAt: '2026-09-03T00:00:00.000Z', viaPick: false }], deals: deals(deal('o1')) }));
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].stage, items[0].opened, items[0].source, items[0].userId], ['watching', true, 'open', ME]);
});

test("a daily pick's automatic open only counts once acted on", () => {
  const base = { opens: [{ dealId: 'pk', openedAt: '2026-09-03T00:00:00.000Z', viaPick: true }], deals: deals(deal('pk')) };
  assert.equal(trackedDeals(input(base)).length, 0);
  assert.equal(trackedDeals(input({ ...base, pickAnswers: [{ userId: ME, dealId: 'pk', reaction: 'no' }] })).length, 0);
  assert.equal(trackedDeals(input({ ...base, pickAnswers: [{ userId: ME, dealId: 'pk', reaction: 'yes' }] })).length, 1);
  assert.equal(trackedDeals(input({ ...base, reactions: [{ userId: ME, dealId: 'pk', reaction: 'keep', updatedAt: '2026-09-04T00:00:00.000Z' }] })).length, 1);
});

test('a reaction or open on a deal the caller left out (not visible) is dropped', () => {
  const items = trackedDeals(input({ reactions: [{ userId: ME, dealId: 'hidden', reaction: 'keep', updatedAt: '2026-09-02T00:00:00.000Z' }], opens: [{ dealId: 'hidden2', openedAt: '2026-09-02T00:00:00.000Z', viaPick: false }] }));
  assert.equal(items.length, 0);
});

test('forViewer: own item wins, teammates are named, and a teammate report is borrowed', () => {
  const d = deal('t');
  const items = trackedDeals(input({
    pipeline: [
      row('mine', { canonicalUrl: d.canonicalUrl, status: 'contacted', updatedAt: '2026-09-01T00:00:00.000Z' }),
      row('theirs', { userId: MATE, canonicalUrl: d.canonicalUrl, status: 'offer', analysedReportId: 'rep', updatedAt: '2026-09-05T00:00:00.000Z' }),
      row('solo', { userId: MATE, status: 'viewing' }),
    ],
    // The team opened it, so the teammate's report is the viewer's to see.
    opens: [{ dealId: 't', openedAt: '2026-08-30T00:00:00.000Z', viaPick: false }],
    deals: deals(d),
  }));
  const view = forViewer(items, ME);
  assert.equal(view.length, 2);
  const shared = view.find((v) => v.key === 'd-t')!;
  assert.equal(shared.userId, ME);
  assert.equal(shared.mine, true);
  assert.equal(shared.stage, 'contacted');
  assert.deepEqual(shared.alsoTrackedBy, [MATE]);
  assert.equal(shared.reportId, 'rep');
  assert.equal(shared.reportUserId, MATE);
  const solo = view.find((v) => v.key === 'l-solo')!;
  assert.equal(solo.mine, false);
  assert.equal(solo.stage, 'viewing');
});

test("forViewer: a team open nobody has moved is the viewer's; a teammate's stage hides it", () => {
  const d = deal('open');
  const bare = forViewer(trackedDeals(input({ opens: [{ dealId: 'open', openedAt: '2026-09-01T00:00:00.000Z', viaPick: false }], deals: deals(d) })), ME);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].mine, true);
  const moved = forViewer(trackedDeals(input({ pipeline: [row('m', { userId: MATE, canonicalUrl: d.canonicalUrl, status: 'viewing' })], opens: [{ dealId: 'open', openedAt: '2026-09-01T00:00:00.000Z', viaPick: false }], deals: deals(d) })), ME);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].mine, false);
  assert.equal(moved[0].stage, 'viewing');
});

test('groupByStage orders stages (Passed last) and sorts by last change', () => {
  const items = trackedDeals(input({ pipeline: [row('old', { updatedAt: '2026-09-01T00:00:00.000Z' }), row('new', { updatedAt: '2026-09-08T00:00:00.000Z' }), row('p', { status: 'passed' }), row('s', { status: 'secured' })] }));
  const groups = groupByStage(items);
  assert.deepEqual(groups.map((g) => g.stage), ['watching', 'contacted', 'viewing', 'offer', 'secured', 'passed']);
  assert.deepEqual(groups[0].items.map((i) => i.key), ['l-new', 'l-old']);
  assert.deepEqual(groups[4].items.map((i) => i.key), ['l-s']);
  assert.deepEqual(groups[5].items.map((i) => i.key), ['l-p']);
});

test('countsLine names the active stages that have anything', () => {
  const stages: PipelineStatus[] = [...Array(12).fill('watching'), ...Array(3).fill('contacted'), 'viewing', 'offer', 'passed', 'passed'];
  const counts = stageCounts(stages.map((stage) => ({ stage })));
  assert.equal(countsLine(counts), '12 kept · 3 contacted · 1 viewing · 1 offer');
  assert.equal(counts.passed, 2);
  assert.equal(countsLine(stageCounts([])), '');
});

test('matchesFocus finds an item by its key or by the pipeline row behind it', () => {
  assert.equal(matchesFocus({ key: 'd-1', checkedListingId: 'r9' }, 'd-1'), true);
  assert.equal(matchesFocus({ key: 'd-1', checkedListingId: 'r9' }, 'l-r9'), true);
  assert.equal(matchesFocus({ key: 'd-1', checkedListingId: null }, 'l-r9'), false);
  assert.equal(matchesFocus({ key: 'd-1', checkedListingId: null }, null), false);
});

test("a teammate's row on a deal the team never opened shows only the card: no URL, address or report", () => {
  const d = deal('x');
  const items = trackedDeals(input({ pipeline: [row('b', { userId: MATE, canonicalUrl: d.canonicalUrl, status: 'viewing', analysedReportId: 'rep' })], reactions: [{ userId: ME, dealId: 'x', reaction: 'keep', updatedAt: '2026-09-01T00:00:00.000Z' }], deals: deals(d) }));
  const mate = items.find((i) => i.userId === MATE)!;
  assert.equal(mate.opened, false);
  assert.equal(mate.canonicalUrl, null);
  assert.equal(mate.listing, null);
  assert.equal(mate.reportId, null);
  const [mine] = forViewer(items, ME);
  assert.equal(mine.mine, true);
  assert.equal(mine.reportId, null);
  // Once the team opens it, the teammate's row (and its report) are the viewer's to see.
  const opened = trackedDeals(input({ pipeline: [row('b', { userId: MATE, canonicalUrl: d.canonicalUrl, status: 'viewing', analysedReportId: 'rep' })], reactions: [{ userId: ME, dealId: 'x', reaction: 'keep', updatedAt: '2026-09-01T00:00:00.000Z' }], opens: [{ dealId: 'x', openedAt: '2026-09-02T00:00:00.000Z', viaPick: false }], deals: deals(d) }));
  assert.equal(opened.find((i) => i.userId === MATE)!.listing?.address, '1 b Street');
  assert.equal(forViewer(opened, ME)[0].reportId, 'rep');
});

test('a teammate listing that is not a marketplace deal keeps its address in the team view', () => {
  const [item] = trackedDeals(input({ pipeline: [row('solo', { userId: MATE })] }));
  assert.equal(item.opened, true);
  assert.equal(item.listing?.address, '1 solo Street');
});

test("a Pass given after the row last changed wins (the card's Pass does not touch the row); an older one does not", () => {
  const d = deal('p');
  const base = { pipeline: [row('r', { canonicalUrl: d.canonicalUrl, status: 'viewing', updatedAt: '2026-09-05T00:00:00.000Z' })], deals: deals(d) };
  const newer = trackedDeals(input({ ...base, reactions: [{ userId: ME, dealId: 'p', reaction: 'pass', updatedAt: '2026-09-06T00:00:00.000Z' }] }));
  assert.equal(newer[0].stage, 'passed');
  assert.equal(newer[0].lastChangedAt, '2026-09-06T00:00:00.000Z');
  const older = trackedDeals(input({ ...base, reactions: [{ userId: ME, dealId: 'p', reaction: 'pass', updatedAt: '2026-09-04T00:00:00.000Z' }] }));
  assert.equal(older[0].stage, 'viewing');
  const keep = trackedDeals(input({ ...base, reactions: [{ userId: ME, dealId: 'p', reaction: 'keep', updatedAt: '2026-09-06T00:00:00.000Z' }] }));
  assert.equal(keep[0].stage, 'viewing');
});
