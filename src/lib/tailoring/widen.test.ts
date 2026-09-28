import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWidenKey, widenChanges, widenOptions } from './widen.ts';
import { plainProfile, type TailoringProfile } from './profile.ts';
import type { ChooseInput, ChooseReads } from '../today/choose.ts';
import type { PoolRow } from '../today/candidates.ts';
import type { SourcedListing } from '../listing/sourcing.ts';
import type { PickFeedback } from '../listing/picks.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };
const home = { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 };

const row = (id: string, over: Partial<PoolRow> = {}): PoolRow => ({
  id, source: 'rightmove', kind: 'sale', postcode_area: 'NG', outcode: 'NG7', town: 'Nottingham', bedrooms: 3,
  price_amount: 150_000, price_period: 'total', raw_type: 'Terraced house', tenure: 'Freehold', band: 'qualified',
  annual_profit: 12_000, uplift_pct: 60, reduced_at: null, listed_date: AT, status: 'live', first_seen_at: AT,
  last_checked_live_at: null, last_confirmed_at: AT, last_confirmed_via: 'live', live_since: AT,
  deal: { kind: 'purchase', grossYieldPct: 12, targetYieldPct: 10, grossRevenue: 30_000, cashflowMonthly: 500 },
  suitability: 'ok', screening: { kind: 'purchase', band: 'qualified', upliftPct: 60, surplus: 12_000 },
  screening_gross: 30_000, screening_confidence: 'medium', motivation: null,
  ...over,
});
const profile = (g: Partial<MarketGoals>, over: Partial<TailoringProfile> = {}) => plainProfile({ ...DEFAULT_GOALS, path: 'buy', where: 'near', home, maxDistanceMiles: 10, ...g }, [], WIDTHS, { answered: { deals_done: real }, ...over });
function world(rows: PoolRow[], opts: { exclude?: string[]; snapshots?: Map<string, SourcedListing>; feedback?: PickFeedback[] } = {}) {
  const reads: ChooseReads = {
    pool: async (f, limit) => rows.filter((r) => f.kind === 'both' || r.kind === f.kind).slice(0, limit),
    fullListings: async (ids) => new Map(ids.flatMap((id) => (opts.snapshots?.has(id) ? [[id, opts.snapshots.get(id)!] as const] : []))),
  };
  const input = (p: TailoringProfile): ChooseInput => ({ goals: p.goals, savedAreas: p.savedAreas, feedback: opts.feedback ?? [], exclude: new Set(opts.exclude ?? []), cards: null, now: NOW, tailoring: p });
  return { reads, input };
}

test('each offer counts the deals it would really add, most first, three at most', async () => {
  // Two at home; three in Derby, about 18 miles away; one in Manchester; two over budget at home.
  const rows = [row('ng1'), row('ng2'), row('de1', { postcode_area: 'DE' }), row('de2', { postcode_area: 'DE' }), row('de3', { postcode_area: 'DE' }), row('m1', { postcode_area: 'M' }), row('dear1', { price_amount: 260_000 }), row('dear2', { price_amount: 280_000 })];
  const p = profile({ budget: 'u200' });
  const w = world(rows);
  const options = await widenOptions(w.input(p), p, w.reads, ['ng1', 'ng2']);
  assert.deepEqual(options, [
    { key: 'nice-location', label: 'Make location a nice-to-have', adds: 4 },
    { key: 'miles', label: '+10 miles', adds: 3 },
    { key: 'nice-budget', label: 'Make budget a nice-to-have', adds: 2 },
  ]);
});

test('what is excluded, already on today, or fails its full listing is never counted', async () => {
  const rows = [row('ng1'), row('de1', { postcode_area: 'DE' }), row('de2', { postcode_area: 'DE' }), row('de3', { postcode_area: 'DE', raw_type: null })];
  const work: SourcedListing = { source: 'rightmove', id: 'de3', canonicalUrl: 'x', kind: 'sale', title: 'Needs modernisation throughout', address: null, postcode: null, outcode: 'DE1', postcodeArea: 'DE', lat: null, lng: null, bedrooms: 3, bathrooms: null, price: { amount: 150_000, period: 'total' }, rawType: null, photo: null };
  const said: PickFeedback[] = [{ reaction: 'no', reactionSource: 'form', reasons: ['needs_work'], kind: 'sale', postcodeArea: 'LN', bedrooms: 3, amount: 150_000, rawType: 'Terraced house', outcode: 'LN1' }];
  const p = profile({});
  const w = world(rows, { exclude: ['de1'], snapshots: new Map([['de3', work]]), feedback: said });
  const options = await widenOptions(w.input(p), p, w.reads, ['ng1']);
  assert.deepEqual(options.find((o) => o.key === 'miles'), { key: 'miles', label: '+10 miles', adds: 1 });
});

test('a change that adds nothing is not offered; nice-to-haves and answers they did not give offer nothing', async () => {
  const p = profile({ where: 'anywhere', home: null, maxDistanceMiles: null });
  const w = world([row('a')]);
  assert.deepEqual(await widenOptions(w.input(p), p, w.reads, ['a']), []);
  assert.deepEqual(widenChanges(profile({ bedrooms: 2 })).map((c) => c.key), ['miles', 'nice-location'], 'bedrooms is already a nice-to-have');
});

test('the changes themselves: worked out from the member’s own answers, never the form', () => {
  const p = profile({ maxDistanceMiles: 25, sourcingKind: 'both', maxRentPcm: 1_000, budget: 'u200', buyer: { ...DEFAULT_GOALS.buyer, cashAvailable: '30-60' }, finance: { ...DEFAULT_GOALS.finance, targetMarginPcm: 400 } }, { answered: { deals_done: real, min_profit: real, cash_available: real } });
  const byKey = new Map(widenChanges(p).map((c) => [c.key, c]));
  assert.equal(byKey.get('miles')?.label, '+5 miles', 'a pre-quiz 25 miles moves to the next step, 30');
  const miles = byKey.get('miles')!.change;
  assert.equal(miles.kind === 'goals' && miles.goals.maxDistanceMiles, 30);
  const rent = byKey.get('rent')!.change;
  assert.equal(rent.kind === 'goals' && rent.goals.maxRentPcm, 1_250);
  const profit = byKey.get('profit')!.change;
  assert.equal(profit.kind === 'goals' && profit.goals.finance.targetMarginPcm, 300);
  const cash = byKey.get('cash')!;
  assert.equal(cash.label, 'Cash up to £100k');
  assert.deepEqual(byKey.get('nice-budget')!.change, { kind: 'mode', criterion: 'budget' });
  assert.equal(isWidenKey('nice-budget'), true);
  assert.equal(isWidenKey('nice-motivation'), false);
  assert.equal(isWidenKey('miles'), true);
  assert.equal(isWidenKey('drop-table'), false);
});
