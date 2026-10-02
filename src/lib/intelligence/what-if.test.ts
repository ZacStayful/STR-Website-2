import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestWhatIfs, isWhatIfKey, whatIfAnswer, whatIfChanges, whatIfLine, whatIfResults, type WhatIfResult } from './what-if.ts';
import { plainProfile, type TailoringProfile } from '../tailoring/profile.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import type { ChooseInput, ChooseReads } from '../today/choose.ts';
import type { PoolRow } from '../today/candidates.ts';

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
const profile = (g: Partial<MarketGoals>, over: Partial<TailoringProfile> = {}) =>
  plainProfile({ ...DEFAULT_GOALS, path: 'buy', where: 'near', home, maxDistanceMiles: 10, dealTypes: ['buy_str'], ...g }, [], WIDTHS, { answered: { deals_done: real }, ...over });

test('variants: the next budget band, +10 miles, bedrooms ±1, the other property type, and ONE added deal type — never one removed', () => {
  const p = profile({ budget: 'u200', bedrooms: 3, buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'house' } });
  const keys = whatIfChanges(p, { nearbyAreas: [] }).map((v) => v.key);
  assert.ok(keys.includes('budget'));
  assert.ok(keys.includes('miles'));
  assert.ok(keys.includes('type_either'));
  assert.ok(keys.some((k) => k.startsWith('add_')));
  assert.ok(keys.length <= 6);
  for (const v of whatIfChanges(p, { nearbyAreas: [] }).filter((x) => x.key.startsWith('add_'))) {
    assert.ok((v.goals.dealTypes ?? []).includes('buy_str'), 'the chosen type stays');
    assert.equal((v.goals.dealTypes ?? []).length, 2, 'exactly one type added');
  }
  const budget = whatIfChanges(p, { nearbyAreas: [] }).find((v) => v.key === 'budget')!;
  assert.equal(budget.goals.budget, '200-350');
  assert.equal(budget.save, 'budget', 'a band can only be changed by the member');
});

test('keys are validated', () => {
  assert.equal(isWhatIfKey('budget'), true);
  assert.equal(isWhatIfKey('add_brrr'), true);
  assert.equal(isWhatIfKey('add_btl'), false);
  assert.equal(isWhatIfKey('drop table'), false);
});

test('counts are real: a variant shows the deals today’s answers miss, with the best one', async () => {
  const rows = [row('ng1', { price_amount: 260_000 }), row('ng2', { price_amount: 280_000, annual_profit: 18_000 })];
  const reads: Pick<ChooseReads, 'pool'> = { pool: async (f, limit) => rows.filter((r) => f.kind === 'both' || r.kind === f.kind).slice(0, limit) };
  const p = profile({ budget: 'u200', modes: undefined } as Partial<MarketGoals>);
  const input: ChooseInput = { goals: p.goals, savedAreas: p.savedAreas, feedback: [], exclude: new Set(), cards: null, now: NOW, tailoring: p };
  const variants = whatIfChanges(p, { nearbyAreas: [] }).filter((v) => v.key === 'budget');
  const [r] = await whatIfResults(input, p, reads, variants);
  assert.equal(r.key, 'budget');
  assert.equal(r.count, 2);
  assert.ok(r.best);
});

test('the best 1–3: matches only, nice-to-have changes first, then the most matches; the line reads naturally', () => {
  const r = (key: WhatIfResult['key'], count: number, mustHave: boolean): WhatIfResult => ({ key, phrase: 'x', mustHave, save: 'use', count, best: null });
  const best = bestWhatIfs([r('budget', 9, true), r('beds_up', 2, false), r('miles', 0, false), r('profit', 5, false)], 3);
  assert.deepEqual(best.map((x) => x.key), ['profit', 'beds_up', 'budget']);
  assert.equal(
    whatIfLine({ key: 'budget', phrase: 'raise your budget to £200k–£350k', mustHave: true, save: 'budget', count: 6, best: { dealId: 'a', matchPct: 88, profitLine: '£1,150/month' } }),
    'If you raise your budget to £200k–£350k, I’d have 6 matches — the best is 88% (£1,150/month).',
  );
});

test('"Use this" saves through the quiz; a budget band is the member’s to change; adding a type keeps the chosen ones', () => {
  const p = profile({ budget: 'u200', bedrooms: 3, buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'house' } });
  const vs = whatIfChanges(p, { nearbyAreas: [] });
  const before = { goals: p.goals!, savedAreas: p.savedAreas };
  assert.equal(whatIfAnswer(vs.find((v) => v.key === 'budget')!, before), null);
  assert.deepEqual(whatIfAnswer(vs.find((v) => v.key === 'beds_down')!, before), { questionId: 'bedrooms', value: '2', undo: '3' });
  const add = whatIfAnswer(vs.find((v) => v.key.startsWith('add_'))!, before)!;
  assert.equal(add.questionId, 'deal_types');
  assert.ok((add.value as string[]).includes('buy_str'));
});

test('Batch 22c: the budget steps up through the five brackets; the legacy Under £200k steps to £200k–£350k, never down', () => {
  const next = (budget: MarketGoals['budget']) => whatIfChanges(profile({ budget }), { nearbyAreas: [] }).find((v) => v.key === 'budget');
  assert.equal(next('u100')?.goals.budget, '100-200');
  assert.equal(next('u100')?.phrase, 'raise your budget to £100k–£200k');
  assert.equal(next('100-200')?.goals.budget, '200-350');
  assert.equal(next('u200')?.goals.budget, '200-350');
  assert.equal(next('350-500')?.goals.budget, '500+');
  assert.equal(next('500+'), undefined, 'nothing above the top bracket');
});
