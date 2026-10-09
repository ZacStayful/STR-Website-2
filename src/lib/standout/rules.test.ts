import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeStandout, memberSkip, bestFirst, beatsBest, liveConfirmed, inWindow, savesLeftToday, profitBarFor, matchPctOf, chosenTypesOf, shownVerdict, type StandoutInput } from './rules.ts';
import { DEFAULT_STANDOUT } from './settings.ts';
import { wantsFor, type Judgement } from '../tailoring/criteria.ts';
import { judgeRow } from '../tailoring/today.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { DEFAULT_ABOUT } from '../profile/about.ts';
import type { TailoringProfile } from '../tailoring/profile.ts';
import type { PoolRow } from '../today/candidates.ts';

const judgement = (met: number, checked: number, mustFails: string[] = []): Judgement =>
  ({ checks: [], mustFails, mustUnknown: [], niceMissed: 0, met, unknown: 0, checked }) as unknown as Judgement;

const input = (over: Partial<StandoutInput> = {}): StandoutInput => ({
  judgement: judgement(5, 5),
  facts: { kind: 'rent', dealType: 'r2r', project: null },
  figures: { range: { kind: 'rent-to-rent', midPcm: 1500, lowPcm: 1300, highPcm: 1700, pct: 15, label: '', basis: '' } },
  wants: { minProfit: null, minProfitR2r: 1000 },
  chosenTypes: ['r2r'],
  revealPct: null,
  settings: DEFAULT_STANDOUT,
  ...over,
});

test('a deal meeting every rule is standout', () => {
  const r = judgeStandout(input());
  assert.equal(r.outcome, 'standout');
  assert.equal(r.reason, 'standout');
  assert.equal(r.matchPct, 100);
  assert.equal(r.profitBar, 1250);
  assert.equal(r.profitBasis, 'range');
});

test('a deal type the primary profile did not choose is never standout, and keeps no row', () => {
  const r = judgeStandout(input({ chosenTypes: ['buy_str'] }));
  assert.equal(r.outcome, 'not_standout');
  assert.equal(r.reason, 'type_not_chosen');
  assert.equal(r.inPool, false);
  // A Short-let-only member: even a forced test cannot make an R2R deal theirs.
  assert.equal(judgeStandout(input({ chosenTypes: ['buy_str'], forced: true })).reason, 'type_not_chosen');
});

test('a missed must-have never reaches the pool', () => {
  const r = judgeStandout(input({ judgement: judgement(4, 5, ['location']) }));
  assert.equal(r.reason, 'must_have_missed');
  assert.equal(r.inPool, false);
});

test('no minimum-profit answer for the type: never standout', () => {
  assert.equal(judgeStandout(input({ wants: { minProfit: 1000, minProfitR2r: null } })).reason, 'no_min_profit_for_type');
});

test('at least five answers checked', () => {
  assert.equal(judgeStandout(input({ judgement: judgement(4, 4) })).reason, 'too_few_checks');
  assert.equal(judgeStandout(input({ judgement: judgement(5, 5) })).reason, 'standout');
});

test('the 90% floor uses the % the member sees: with 5–9 checks every check must pass', () => {
  assert.equal(judgeStandout(input({ judgement: judgement(4, 5) })).reason, 'match_below_floor'); // 80%
  assert.equal(judgeStandout(input({ judgement: judgement(8, 9) })).reason, 'match_below_floor'); // 89%
  assert.equal(judgeStandout(input({ judgement: judgement(9, 10) })).reason, 'standout'); // 90%
  assert.equal(matchPctOf({ met: 8, checked: 9 }), 89);
});

test('at least as high as the reveal #1; no reveal: the floor alone', () => {
  assert.equal(judgeStandout(input({ judgement: judgement(9, 10), revealPct: 100 })).reason, 'below_reveal_match');
  assert.equal(judgeStandout(input({ judgement: judgement(9, 10), revealPct: 90 })).reason, 'standout');
  assert.equal(judgeStandout(input({ judgement: judgement(9, 10), revealPct: null })).reason, 'standout');
});

test('the LOW end of the profit, at least 25% above the minimum', () => {
  const at = (lowPcm: number) => judgeStandout(input({ figures: { range: { kind: 'rent-to-rent', midPcm: lowPcm + 200, lowPcm, highPcm: lowPcm + 400, pct: 15, label: '', basis: '' } } }));
  assert.equal(at(1249).reason, 'profit_short');
  assert.equal(at(1250).reason, 'standout');
  assert.equal(judgeStandout(input({ figures: { range: null } })).reason, 'profit_unknown');
  assert.equal(profitBarFor(800, 25), 1000);
});

test('forced skips every threshold but not types or must-haves', () => {
  const r = judgeStandout(input({ judgement: judgement(1, 2), wants: { minProfit: null, minProfitR2r: null }, forced: true }));
  assert.equal(r.outcome, 'standout');
  assert.equal(r.reason, 'forced');
});

test('member-level reasons, in order', () => {
  const ok = { forClient: false, pausedAt: null };
  const w = { minProfit: null, minProfitR2r: 900 };
  assert.equal(memberSkip({ isTeamMember: true, primary: ok, chosenTypes: ['r2r'], wants: w }), 'team_member');
  assert.equal(memberSkip({ isTeamMember: false, primary: null, chosenTypes: ['r2r'], wants: w }), 'no_primary_profile');
  assert.equal(memberSkip({ isTeamMember: false, primary: { ...ok, forClient: true }, chosenTypes: ['r2r'], wants: w }), 'client_profile');
  assert.equal(memberSkip({ isTeamMember: false, primary: { ...ok, pausedAt: '2026-10-01' }, chosenTypes: ['r2r'], wants: w }), 'profile_paused');
  assert.equal(memberSkip({ isTeamMember: false, primary: { ...ok, awaitingAnswers: true }, chosenTypes: ['r2r'], wants: w }), 'awaiting_answers');
  assert.equal(memberSkip({ isTeamMember: false, primary: ok, chosenTypes: [], wants: w }), 'no_deal_types');
  // A minimum only for a type they don't look at is no minimum.
  assert.equal(memberSkip({ isTeamMember: false, primary: ok, chosenTypes: ['buy_str'], wants: w }), 'no_min_profit');
  assert.equal(memberSkip({ isTeamMember: false, primary: ok, chosenTypes: ['buy_str', 'r2r'], wants: w }), null);
});

test('best first: the highest match, then the highest profit', () => {
  const order = bestFirst([
    { id: 'a', matchPct: 90, profitLow: 2000 },
    { id: 'b', matchPct: 100, profitLow: 1300 },
    { id: 'c', matchPct: 100, profitLow: 1500 },
  ]).map((x) => x.id);
  assert.deepEqual(order, ['c', 'b', 'a']);
});

test('beats the best so far, strictly', () => {
  assert.equal(beatsBest(1500, null), true);
  assert.equal(beatsBest(1500, 1499), true);
  assert.equal(beatsBest(1500, 1500), false);
});

test('live: a page read for a portal we can read, the feed sighting for one we cannot', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  assert.equal(liveConfirmed({ fetchable: true, lastCheckedLiveAt: ago(5), lastConfirmedAt: ago(1) }, now, 6), true);
  assert.equal(liveConfirmed({ fetchable: true, lastCheckedLiveAt: ago(7), lastConfirmedAt: ago(1) }, now, 6), false);
  assert.equal(liveConfirmed({ fetchable: true, lastCheckedLiveAt: null, lastConfirmedAt: ago(1) }, now, 6), false);
  assert.equal(liveConfirmed({ fetchable: false, lastCheckedLiveAt: null, lastConfirmedAt: ago(2) }, now, 6), true);
});

test('the window: after from, up to and including to', () => {
  const w = { from: '2026-10-09T09:00:00Z', to: '2026-10-09T10:00:00Z' };
  assert.equal(inWindow('2026-10-09T09:00:00Z', w), false);
  assert.equal(inWindow('2026-10-09T09:30:00Z', w), true);
  assert.equal(inWindow('2026-10-09T10:00:00Z', w), true);
  assert.equal(inWindow(null, w), false);
});

test('saves left today: 0 means no limit', () => {
  assert.equal(savesLeftToday(0, 1), 1);
  assert.equal(savesLeftToday(1, 1), 0);
  assert.equal(savesLeftToday(7, 0), Number.POSITIVE_INFINITY);
});

// ── Through the real judging code (judgeRow → judgeDeal), as Today uses it ──

const profileWith = (goals: MarketGoals, answered: string[]): TailoringProfile => ({
  profileId: 'p1',
  goals,
  savedAreas: [],
  about: DEFAULT_ABOUT,
  answered: Object.fromEntries(answered.map((q) => [q, { at: '2026-10-01T00:00:00Z', notSure: false }])),
  modes: {},
  signals: [],
  widths: { high: 10, medium: 15, low: 25 },
});

test('a rent-to-rent deal judged as Today judges it', () => {
  const goals: MarketGoals = { ...DEFAULT_GOALS, path: 'r2r', where: 'anywhere', sourcingKind: 'rent', dealTypes: ['r2r'], maxRentPcm: 2000, bedrooms: 1, r2r: { ...DEFAULT_GOALS.r2r, minMarginPcm: 1000, paybackMonths: 6, breakEvenOccupancyPct: 70 }, finance: { ...DEFAULT_GOALS.finance, targetMarginPcm: 1000 } };
  const p = profileWith(goals, ['deal_types', 'where', 'max_rent', 'bedrooms', 'payback', 'break_even', 'r2r_min_profit']);
  const row = { id: 'd1', kind: 'rent', postcode_area: 'HD', bedrooms: 1, price_amount: 575, price_period: 'pcm', raw_type: 'Flat', tenure: null, screening_gross: '64624', screening_confidence: 'low', check_comps: null, deal: { kind: 'rent-to-rent', setupCost: 9500, breakevenOccupancyPct: 16.8, paybackMonths: 5, monthlyMargin: 1975, targetMarginPcm: 500 }, motivation: null, listed_date: null, first_seen_at: '2026-10-06T00:00:00Z', project: null } as unknown as PoolRow;
  const w = wantsFor(p);
  const j = judgeRow(row, p, w, new Date('2026-10-09T10:00:00Z'));
  const r = judgeStandout({ ...j, wants: w, chosenTypes: ['r2r'], revealPct: null, settings: DEFAULT_STANDOUT });
  assert.equal(r.dealType, 'r2r');
  assert.equal(r.profitLow, j.figures.range?.lowPcm);
  assert.equal(r.outcome, 'standout', JSON.stringify(r));
});

const project = (level: 'light' | 'full') => ({ v: 1, level, price: 90_000, bedrooms: 3, worksLow: 15_000, worksHigh: 25_000, value: 150_000, valueAdded: 35_000, valueAddedPct: 23, ceilingApplied: false, months: 6, cashLow: 40_000, cashHigh: 50_000, moneyLeftInLow: level === 'full' ? 10_000 : null, moneyLeftInHigh: level === 'full' ? 20_000 : null, refinancePct: level === 'full' ? 75 : null, estimatedAt: '2026-10-01T00:00:00Z' });

test('a BRRR deal is judged on profit after the works (after refinance for a full project)', () => {
  const goals: MarketGoals = { ...DEFAULT_GOALS, path: 'buy', where: 'anywhere', sourcingKind: 'sale', dealTypes: ['brrr'], finance: { ...DEFAULT_GOALS.finance, targetMarginPcm: 300 } };
  const p = profileWith(goals, ['deal_types', 'where', 'min_profit']);
  const w = wantsFor(p);
  for (const level of ['light', 'full'] as const) {
    const row = { id: `b-${level}`, kind: 'sale', postcode_area: 'S', bedrooms: 3, price_amount: 90_000, price_period: 'total', raw_type: 'Terraced house', tenure: 'Freehold', screening_gross: '30000', screening_confidence: 'medium', check_comps: null, deal: null, motivation: null, listed_date: null, first_seen_at: '2026-10-06T00:00:00Z', project: project(level) } as unknown as PoolRow;
    const j = judgeRow(row, p, w, new Date('2026-10-09T10:00:00Z'));
    const r = judgeStandout({ ...j, wants: w, chosenTypes: ['brrr'], revealPct: null, settings: DEFAULT_STANDOUT });
    assert.equal(r.dealType, 'brrr');
    assert.equal(r.profitBasis, level === 'full' ? 'after_refinance' : 'after_works');
    // The same figure the profit check reads: Batch 17's range, never a second model.
    assert.ok(j.figures.range, 'a project has an after-works range');
    assert.equal(r.profitLow, j.figures.range!.lowPcm);
    assert.equal(r.minProfit, 300);
  }
});

test('a save is told about only while the main profile still shows its deal type and is still judged', () => {
  const ok = { forClient: false, pausedAt: null };
  const w = { minProfit: null, minProfitR2r: 1000 };
  const r2rOnly = chosenTypesOf({ primary: ok, types: ['r2r'], wants: w });
  assert.deepEqual(r2rOnly, { types: ['r2r'] });
  assert.equal(shownVerdict(r2rOnly, 'r2r'), 'ok');
  // The member stopped showing BRRR (or never chose it): not told.
  assert.equal(shownVerdict(r2rOnly, 'brrr'), 'type_not_chosen');
  assert.equal(shownVerdict(r2rOnly, null), 'type_not_chosen');
  // Paused, for a client, waiting on answers, or gone: not told.
  assert.deepEqual(chosenTypesOf({ primary: { ...ok, pausedAt: '2026-10-01T00:00:00Z' }, types: ['r2r'], wants: w }), { blocked: 'profile_changed' });
  assert.deepEqual(chosenTypesOf({ primary: { ...ok, forClient: true }, types: ['r2r'], wants: w }), { blocked: 'profile_changed' });
  assert.deepEqual(chosenTypesOf({ primary: { ...ok, awaitingAnswers: true }, types: ['r2r'], wants: w }), { blocked: 'profile_changed' });
  assert.deepEqual(chosenTypesOf({ primary: null, types: ['r2r'], wants: w }), { blocked: 'profile_changed' });
  // No types left: not told.
  assert.deepEqual(chosenTypesOf({ primary: ok, types: [], wants: w }), { blocked: 'type_not_chosen' });
  assert.equal(shownVerdict({ blocked: 'profile_changed' }, 'r2r'), 'profile_changed');
});
