import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeClauseFor, type TypeClause } from '../marketplace/grid.ts';
import { AVAILABLE_DEAL_TYPES, dealFitsTypes, dealTypeFor, dealTypesOf, type DealType, type TypedDeal } from '../profile/deal-types.ts';
import { judgeStandout } from '../standout/rules.ts';
import { DEFAULT_STANDOUT } from '../standout/settings.ts';
import { factsFromRow, type Judgement } from '../tailoring/criteria.ts';
import { matchesFilters, type WentDeal } from '../notify/week.ts';
import { DEFAULT_FILTERS } from '../marketplace/grid.ts';

// Batch 28's leak guard: a buy-to-let-only pool row (a sale whose short-let
// figures failed, kept because it passes the buy-to-let rules) never reaches
// a profile that did not choose Buy to let, and is never read as a
// short-let deal. Today, its email teasers and the reveal read the pool
// through typeClauseFor; standout judges through dealTypesOf.

type Row = TypedDeal & { id: string; project: unknown };

const PROJECT = { v: 1, level: 'light', price: 150000, bedrooms: 3, worksLow: 10000, worksHigh: 15000, value: 190000, valueAdded: 25000, valueAddedPct: 16, months: 4, cashLow: 50000, cashHigh: 60000 };
const ROWS: Row[] = [
  { id: 'short_let', kind: 'sale', band: 'qualified', btl_pass: false, project: null },
  { id: 'btl_only', kind: 'sale', band: 'unqualified', btl_pass: true, project: null },
  { id: 'btl_medium', kind: 'sale', band: 'medium', btl_pass: true, project: null },
  { id: 'both', kind: 'sale', band: 'qualified', btl_pass: true, project: null },
  { id: 'stale', kind: 'sale', band: 'unqualified', btl_pass: false, project: null },
  { id: 'project', kind: 'sale', band: 'qualified', btl_pass: false, project: PROJECT },
  { id: 'rental', kind: 'rent', band: 'qualified', btl_pass: false, project: null },
];
const BTL_ONLY = new Set(['btl_only', 'btl_medium', 'stale']);

/** What PostgREST does with a TypeClause, over rows in memory (only the filters typeClauseFor writes). */
function term(row: Row, t: string): boolean {
  if (t.startsWith('and(') && t.endsWith(')')) return split(t.slice(4, -1)).every((x) => term(row, x));
  switch (t) {
    case 'kind.eq.rent':
      return row.kind === 'rent';
    case 'kind.eq.sale':
      return row.kind === 'sale';
    case 'project.is.null':
      return row.project === null;
    case 'project.not.is.null':
      return row.project !== null;
    case 'project->>level.eq.light':
      return (row.project as { level?: string } | null)?.level === 'light';
    case 'band.eq.qualified':
      return row.band === 'qualified';
    case 'btl_pass.is.true':
      return row.btl_pass === true;
  }
  throw new Error(`unknown filter ${t}`);
}
function split(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    cur += ch;
  }
  out.push(cur);
  return out;
}
function matches(row: Row, c: TypeClause | null): boolean {
  if (c === null) return true;
  if (c.none) return false;
  if (c.kind && row.kind !== c.kind) return false;
  if (c.project === 'null' && row.project !== null) return false;
  if (c.project === 'not_null' && row.project === null) return false;
  if (c.project === 'light' && !term(row, 'project->>level.eq.light')) return false;
  if (c.band && row.band !== c.band) return false;
  if (c.btl && row.btl_pass !== true) return false;
  if (c.or && !split(c.or).some((t) => term(row, t))) return false;
  return true;
}
function subsets<T>(xs: readonly T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]).filter((s) => s.length > 0);
}

test('every combination of types: a buy-to-let-only row only ever matches a list that chose Buy to let, and is shown as Buy to let', () => {
  for (const types of subsets(AVAILABLE_DEAL_TYPES)) {
    for (const light of [false, true]) {
      const clause = typeClauseFor(types, true, light);
      const got = ROWS.filter((r) => matches(r, clause));
      for (const r of got) {
        const shownAs = dealTypeFor(r, types);
        assert.ok(types.includes(shownAs), `${r.id} shown as ${shownAs} to ${types.join('+')}`);
        if (BTL_ONLY.has(r.id)) assert.equal(shownAs, 'btl', `${r.id} for ${types.join('+')}`);
      }
      if (!types.includes('btl')) assert.ok(!got.some((r) => BTL_ONLY.has(r.id)), `no buy-to-let-only row for ${types.join('+')}${light ? ' (light)' : ''}`);
      assert.ok(!got.some((r) => r.id === 'stale'), 'a row whose buy-to-let figures are being redone is shown to nobody');
      // Nothing a chosen type covers is dropped.
      for (const r of ROWS) if (r.id !== 'stale' && dealFitsTypes(r, types) && !(light && dealTypesOf(r).every((t) => t === 'brrr'))) assert.ok(got.includes(r), `${r.id} missing for ${types.join('+')}`);
    }
  }
});

test('an "All" profile from before Batch 28 (three types) never sees a buy-to-let-only row, and a dual one only as Short-let', () => {
  const three: DealType[] = ['buy_str', 'brrr', 'r2r'];
  const got = ROWS.filter((r) => matches(r, typeClauseFor(three, true)));
  assert.deepEqual(got.map((r) => r.id), ['short_let', 'both', 'project', 'rental']);
  assert.equal(dealTypeFor(ROWS.find((r) => r.id === 'both')!, three), 'buy_str');
});

const judgement = { checks: [], mustFails: [], mustUnknown: [], niceMissed: 0, met: 6, unknown: 0, checked: 6 } as unknown as Judgement;
const card = (row: Row) => ({ ...row, postcode_area: 'B', bedrooms: 3, price_amount: 160000, price_period: 'total', raw_type: 'Terraced house', tenure: 'Freehold', screening_gross: '30000', screening_confidence: 'high', check_comps: null }) as never;

test('standout: a buy-to-let-only deal is never a short-let standout, whatever the profile chose', () => {
  const facts = factsFromRow(card(ROWS[1]), null, { qualifies: undefined, score: 0 });
  assert.equal(facts.dealType, 'btl');
  const figures = { range: { kind: 'buy-to-let', midPcm: 2000, lowPcm: 1800, highPcm: 2200, pct: 10, label: '', basis: '' } } as never;
  const wants = { minProfit: 500, minProfitR2r: null };
  for (const chosen of [['buy_str'], ['buy_str', 'brrr', 'r2r'], ['buy_str', 'btl']] as DealType[][]) {
    const r = judgeStandout({ judgement, facts, figures, wants, chosenTypes: chosen, revealPct: null, settings: DEFAULT_STANDOUT, forced: true });
    assert.equal(r.outcome, 'not_standout', chosen.join('+'));
    assert.equal(r.inPool, false);
  }
  // A deal that is both is judged as the type the member chose first: Short-let for a Short-let member.
  const both = factsFromRow(card(ROWS[3]), null, { qualifies: undefined, score: 0 });
  assert.deepEqual(both.dealTypes, ['buy_str', 'btl']);
  assert.equal(judgeStandout({ judgement, facts: both, figures, wants, chosenTypes: ['buy_str'], revealPct: null, settings: DEFAULT_STANDOUT }).dealType, 'buy_str');
  assert.equal(judgeStandout({ judgement, facts: both, figures, wants, chosenTypes: ['btl'], revealPct: null, settings: DEFAULT_STANDOUT }).dealType, 'btl');
});

test('"Your week": a buy-to-let-only deal that went is never a missed short-let profit', () => {
  const went = (row: Row): WentDeal => ({ ...(card(row) as object), id: row.id, annual_profit: 9000, uplift_pct: null, retired_reason: 'sold', retired_at: '2026-10-10T00:00:00Z' }) as unknown as WentDeal;
  assert.equal(matchesFilters(went(ROWS[1]), { ...DEFAULT_FILTERS, types: [] }), false);
  assert.equal(matchesFilters(went(ROWS[1]), { ...DEFAULT_FILTERS, types: ['buy_str'] }), false);
  assert.equal(matchesFilters(went(ROWS[0]), { ...DEFAULT_FILTERS, types: ['buy_str'] }), true);
  assert.equal(matchesFilters(went(ROWS[3]), { ...DEFAULT_FILTERS, types: ['buy_str', 'btl'] }), true, 'a dual deal is a short-let deal to a Short-let member');
});

test('a sale kept only as buy to let is never made a short-let deal again by a page read or a feed price', async () => {
  const { keptAsBtlOnly, btlOnlyBand } = await import('./screen.ts');
  // Kept as buy to let (its comps check, the page or a price failed): the band it would be given stays below qualified.
  for (const band of ['unqualified', 'medium', 'insufficient-data']) {
    assert.equal(keptAsBtlOnly('sale', band), true, band);
    assert.notEqual(btlOnlyBand('qualified'), 'qualified');
  }
  // A short-let deal, and a rental, are judged as before.
  assert.equal(keptAsBtlOnly('sale', 'qualified'), false);
  assert.equal(keptAsBtlOnly('rent', 'unqualified'), false);
  // And whatever the area figures say, the row is still never shown to a profile without Buy to let.
  const row: TypedDeal = { kind: 'sale', band: btlOnlyBand('qualified'), project: null, btl_pass: true };
  assert.equal(dealFitsTypes(row, ['buy_str', 'brrr', 'r2r']), false);
});

test('a deal chosen into a list earlier that is buy-to-let-only now no longer fits a profile without Buy to let', () => {
  const nowBtlOnly: TypedDeal = { kind: 'sale', band: 'unqualified', project: null, btl_pass: true };
  const stillDual: TypedDeal = { kind: 'sale', band: 'qualified', project: null, btl_pass: true };
  assert.equal(dealFitsTypes(nowBtlOnly, ['buy_str', 'r2r']), false);
  assert.equal(dealFitsTypes(stillDual, ['buy_str', 'r2r']), true);
  assert.equal(dealFitsTypes(nowBtlOnly, ['btl']), true);
});
