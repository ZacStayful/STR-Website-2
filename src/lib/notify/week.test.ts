import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, type DealFilters } from '../marketplace/grid.ts';
import type { AlertChange } from '../market/alerts.ts';
import { buildYourWeek, matchesFilters, missedFor, speedLine, wasVisibleToFree, type WentDeal } from './week.ts';
import { renderEmail } from './render-email.ts';

const NOW = new Date('2026-09-28T08:00:00Z');
const SINCE = '2026-09-21T08:00:00Z';
const SITE = 'https://intelligence.stayful.co.uk';

function went(over: Partial<WentDeal> = {}): WentDeal {
  return {
    id: 'w1',
    kind: 'rent',
    postcode_area: 'LS',
    town: 'Leeds',
    bedrooms: 2,
    price_amount: 950,
    price_period: 'pcm',
    raw_type: 'Flat',
    tenure: null,
    annual_profit: 6_000,
    uplift_pct: null,
    listed_date: null,
    first_seen_at: '2026-09-20T05:00:00Z',
    live_since: '2026-09-20T06:00:00Z',
    retired_reason: 'let_agreed',
    retired_at: '2026-09-24T06:00:00Z',
    ...over,
  };
}

const leedsRent: DealFilters = { ...DEFAULT_FILTERS, kind: 'rent', areas: ['LS'], maxPrice: 1_200 };

test('matching mirrors the grid: kind, area, beds, price, profit and uplift', () => {
  assert.equal(matchesFilters(went(), leedsRent), true);
  assert.equal(matchesFilters(went({ kind: 'sale' }), leedsRent), false);
  assert.equal(matchesFilters(went({ postcode_area: 'YO' }), leedsRent), false);
  assert.equal(matchesFilters(went({ price_amount: 1_500 }), leedsRent), false);
  assert.equal(matchesFilters(went({ price_amount: null }), leedsRent), false);
  assert.equal(matchesFilters(went({ bedrooms: 5 }), { ...leedsRent, beds: '4+' }), true);
  assert.equal(matchesFilters(went({ bedrooms: 3 }), { ...leedsRent, beds: '2' }), false);
  // An uplift floor only narrows sales, as on the grid.
  assert.equal(matchesFilters(went(), { ...leedsRent, minUplift: 30 }), true);
});

test('missed means matched, never opened / kept / passed / picked, and went in the window', () => {
  const deals = [
    went({ id: 'a', annual_profit: 5_000 }),
    went({ id: 'b', annual_profit: 9_000 }),
    went({ id: 'seen' }),
    went({ id: 'old', retired_at: '2026-09-20T06:00:00Z' }),
    went({ id: 'elsewhere', postcode_area: 'M' }),
  ];
  const m = missedFor({ deals, filters: leedsRent, seen: new Set(['seen']), since: SINCE, freeDelayHours: null });
  assert.equal(m.total, 2);
  assert.deepEqual(m.listed.map((d) => d.id), ['b', 'a']);
  assert.equal(m.earlyAccess, 0);
});

test('a free account is only ever LISTED deals it could have seen; the rest are a count', () => {
  // Went 18h after going live: inside a 48h window, never visible to free.
  const early = went({ id: 'early', live_since: '2026-09-23T12:00:00Z', retired_at: '2026-09-24T06:00:00Z', annual_profit: 20_000 });
  const late = went({ id: 'late' });
  assert.equal(wasVisibleToFree(early, 48), false);
  assert.equal(wasVisibleToFree(late, 48), true);
  assert.equal(wasVisibleToFree(went({ live_since: null }), 48), false);
  const m = missedFor({ deals: [early, late], filters: leedsRent, seen: new Set(), since: SINCE, freeDelayHours: 48 });
  assert.equal(m.total, 2);
  assert.equal(m.earlyAccess, 1);
  assert.deepEqual(m.listed.map((d) => d.id), ['late']);
  const e = renderEmail(buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: m, freeDelayHours: 48, recap: null, areas: null, unsubscribe: null })!.message);
  assert.match(e.text, /2 deals matching you went this week\./);
  assert.match(e.text, /1 of these was in early access — paid members saw it 2 days before you could\./);
  assert.ok(e.text.includes(`${SITE}/upgrade`));
  // The early deal's own figure is never shown.
  assert.ok(!e.text.includes('£20,000'));
  // A paid account sees both listed and no early-access line.
  const paid = missedFor({ deals: [early, late], filters: leedsRent, seen: new Set(), since: SINCE, freeDelayHours: null });
  const p = renderEmail(buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: paid, freeDelayHours: null, recap: null, areas: null, unsubscribe: null })!.message);
  assert.doesNotMatch(p.text, /early access/);
  assert.ok(!p.text.includes('/upgrade'));
});

test('no early-access line when the count is 0', () => {
  const m = missedFor({ deals: [went()], filters: leedsRent, seen: new Set(), since: SINCE, freeDelayHours: 48 });
  const e = renderEmail(buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: m, freeDelayHours: 48, recap: null, areas: null, unsubscribe: null })!.message);
  assert.doesNotMatch(e.text, /early access/);
});

test('speed is an upper bound, worded by what we actually know', () => {
  // 4 days and an hour: "within 4 days" would be untrue, so it rounds up.
  assert.equal(speedLine(went()), 'Let agreed within 5 days of reaching Stayful');
  assert.equal(speedLine(went({ first_seen_at: '2026-09-20T06:00:00Z' })), 'Let agreed within 4 days of reaching Stayful');
  assert.equal(speedLine(went({ listed_date: '2026-09-22T00:00:00Z' })), 'Let agreed within 3 days of listing');
  assert.equal(speedLine(went({ retired_reason: 'under_offer', retired_at: '2026-09-20T07:00:00Z' })), 'Under offer within 1 day of reaching Stayful');
  assert.equal(speedLine(went({ first_seen_at: 'nonsense' })), 'Let agreed');
});

test('never an address or a postcode in a missed deal', () => {
  const m = missedFor({ deals: [went({ town: null })], filters: leedsRent, seen: new Set(), since: SINCE, freeDelayHours: null });
  const e = renderEmail(buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: m, freeDelayHours: null, recap: null, areas: null, unsubscribe: null })!.message);
  assert.match(e.text, /Leeds · 2 bed flat/);
});

const areaChange: AlertChange = { code: 'LS', name: 'Leeds', direction: 'up', previousDirection: 'flat', tier: 'confirmed', previousTier: 'building', deltaPct: 0.12, since: null, becameConfirmed: true, trendChanged: true };

test('the recap never sends the email on its own; nothing to say means no email', () => {
  const recap = [{ place: 'York · 3 bed terraced', summary: 'price down from £250,000 to £240,000 (-4.0%)', link: { label: 'Open in My deals', url: `${SITE}/my-deals` } }];
  assert.equal(buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: null, freeDelayHours: null, recap, areas: null, unsubscribe: null }), null);
  assert.equal(buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: { total: 0, listed: [], earlyAccess: 0 }, freeDelayHours: null, recap: [], areas: [], unsubscribe: null }), null);
  const withAreas = buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: null, freeDelayHours: null, recap, areas: [areaChange], unsubscribe: null })!;
  assert.deepEqual(withAreas.message.sections.map((s) => s.key), ['recap', 'areas']);
  assert.equal(withAreas.message.subject, 'Your week: Leeds changed · 1 of your deals moved');
  const e = renderEmail(withAreas.message);
  assert.ok(e.text.includes('enquiries now rising (+12%), previously steady'));
  assert.ok(e.text.includes(`${SITE}/markets/ls`));
  assert.ok(e.text.includes(`${SITE}/account/notifications`));
});

test('the subject is counted from the sections that go', () => {
  const m = missedFor({ deals: [went({ id: 'a' }), went({ id: 'b' })], filters: leedsRent, seen: new Set(), since: SINCE, freeDelayHours: null });
  const w = buildYourWeek({ siteUrl: SITE, now: NOW, since: SINCE, missed: m, freeDelayHours: null, recap: null, areas: [areaChange, { ...areaChange, code: 'M', name: 'Manchester' }], unsubscribe: null })!;
  assert.equal(w.message.subject, 'Your week: 2 deals matching you went · 2 of your areas changed');
  assert.deepEqual(w.sections.missedListed, ['a', 'b']);
});

test('the recap reads each tracked deal\'s own record since the last Your week, and skips what is not real', async () => {
  const { recapItems } = await import('./week.ts');
  const link = { label: 'Open in My deals', url: `${SITE}/my-deals?focus=d-1` };
  const e = (over: Record<string, unknown>) => ({ at: '2026-09-25T06:00:00Z', amount: null, period: 'total', status: null, previousAmount: null, previousStatus: null, notified: false, ...over });
  const items = recapItems(
    [
      { place: 'York · 3 bed terraced', stage: 'watching', link, pipelineHistory: null, dealHistory: [e({ amount: 240_000, previousAmount: 250_000 })], retired: null, revivedAt: null },
      { place: 'Leeds · 2 bed flat', stage: 'viewing', link, pipelineHistory: null, dealHistory: [], retired: { reason: 'under_offer', at: '2026-09-26T06:00:00Z' }, revivedAt: null },
      { place: 'Old news', stage: 'watching', link, pipelineHistory: [e({ at: '2026-09-01T06:00:00Z', amount: 1, previousAmount: 2 })], dealHistory: null, retired: null, revivedAt: null },
      { place: 'Passed one', stage: 'passed', link, pipelineHistory: [e({ amount: 1, previousAmount: 2 })], dealHistory: null, retired: null, revivedAt: null },
      // £1,300 pcm re-labelled as £300 pw is not a price drop.
      { place: 'Relabelled rent', stage: 'watching', link, pipelineHistory: [e({ amount: 300, previousAmount: 1_300, period: 'pw' })], dealHistory: null, retired: null, revivedAt: null },
    ],
    SINCE,
  );
  assert.deepEqual(items.map((i) => i.place), ['York · 3 bed terraced', 'Leeds · 2 bed flat']);
  assert.match(items[0].summary, /^Price down from £250,000 to £240,000/);
  assert.equal(items[1].summary, 'Now under offer');
});
