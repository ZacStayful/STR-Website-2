import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketGoals, goalsFromForm, normalisePostcode, describeGoals, DEFAULT_GOALS, parseMotivationGoals, thresholdDaysFor } from './goals.ts';

test('normalisePostcode accepts UK shapes and rejects junk', () => {
  assert.equal(normalisePostcode('ng2 5gb'), 'NG2 5GB');
  assert.equal(normalisePostcode('  M1   1AE '), 'M1 1AE');
  assert.equal(normalisePostcode('EC1A1BB'), 'EC1A 1BB');
  assert.equal(normalisePostcode('hello'), null);
  assert.equal(normalisePostcode('12345'), null);
});

test('parse rejects the wrong version and non-objects', () => {
  assert.equal(parseMarketGoals(null), null);
  assert.equal(parseMarketGoals('x'), null);
  assert.equal(parseMarketGoals({ version: 2 }), null);
});

test('parse fills defaults for missing fields and drops invalid ones', () => {
  const g = parseMarketGoals({ version: 1, budget: 'silly', bedrooms: 9, maxDistanceMiles: 30, priorities: { yield: '3' } })!;
  assert.equal(g.budget, null);
  assert.equal(g.bedrooms, null);
  assert.equal(g.maxDistanceMiles, null);
  assert.equal(g.priorities.yield, 3);
  assert.equal(g.priorities.revenue, 2);
  assert.equal(g.management, 'managed');
  assert.equal(g.riskAppetite, 'balanced');
  assert.equal(g.home, null);
});

test('home keeps cached coordinates only when numeric', () => {
  const g = parseMarketGoals({ version: 1, home: { postcode: 'ng2 5gb', lat: 52.9, lng: 'x' } })!;
  assert.deepEqual(g.home, { postcode: 'NG2 5GB', lat: 52.9, lng: null });
});

test('goalsFromForm maps the questionnaire fields', () => {
  const form: Record<string, string> = {
    postcode: 'ng2 5gb', maxDistanceMiles: '50', budget: '200-350', bedrooms: '2',
    p_yield: '3', p_revenue: '1', p_lowCompetition: '2', p_directBookings: '0',
    management: 'self', riskAppetite: 'cautious',
  };
  const g = goalsFromForm((k) => form[k] ?? null);
  assert.equal(g.home?.postcode, 'NG2 5GB');
  assert.equal(g.maxDistanceMiles, 50);
  assert.equal(g.budget, '200-350');
  assert.equal(g.bedrooms, 2);
  assert.deepEqual(g.priorities, { yield: 3, revenue: 1, lowCompetition: 2, directBookings: 0 });
  assert.equal(g.management, 'self');
  assert.equal(g.riskAppetite, 'cautious');
});

test('maxRentPcm parses a sane band and drops everything else', () => {
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: 1200 })!.maxRentPcm, 1200);
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: '£1,250' })!.maxRentPcm, 1250);
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: 50 })!.maxRentPcm, null);
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: 'lots' })!.maxRentPcm, null);
  assert.equal(parseMarketGoals({ version: 1 })!.maxRentPcm, null);
  const g = goalsFromForm((k) => ({ sourcingKind: 'rent', maxRentPcm: '1500' } as Record<string, string>)[k] ?? null);
  assert.equal(g.sourcingKind, 'rent');
  assert.equal(g.maxRentPcm, 1500);
  const chips = describeGoals({ ...DEFAULT_GOALS, sourcingKind: 'both', maxRentPcm: 1500 });
  assert.ok(chips.includes('≤ £1,500 pcm'));
  // A rent ceiling on a buy-only filter is not shown.
  assert.ok(!describeGoals({ ...DEFAULT_GOALS, maxRentPcm: 1500 }).some((c) => c.includes('pcm')));
});

test('describeGoals produces readable chips', () => {
  const chips = describeGoals({ ...DEFAULT_GOALS, home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 50, budget: '200-350', bedrooms: 2, priorities: { ...DEFAULT_GOALS.priorities, yield: 3 } });
  assert.deepEqual(chips, ['≤50 mi of NG2', '£200k–£350k', '2-bed', 'Max yield', 'Managed']);
});

// ── Motivated sellers and landlords ──

test('a profile written before the filter existed reads as off', () => {
  // Every stored profile predates this, so the parse must not invent a filter
  // nobody asked for — and must not crash on its absence either.
  const g = parseMarketGoals({ version: 1, priorities: {}, sourcingKind: 'sale' })!;
  assert.equal(g.motivation.mode, 'off');
  assert.equal(g.motivation.minMonthsOnMarket, 5);
  assert.equal(g.motivation.minWeeksOnMarket, 8);
  // Absent means the safer behaviour, not the looser one.
  assert.equal(g.motivation.areaRelative, true);
});

test('the thresholds are kept inside a sane band', () => {
  const at = (raw: unknown) => parseMotivationGoals(raw);
  assert.equal(at({ minMonthsOnMarket: 0 }).minMonthsOnMarket, 5);
  assert.equal(at({ minMonthsOnMarket: 99 }).minMonthsOnMarket, 5);
  assert.equal(at({ minMonthsOnMarket: '3' }).minMonthsOnMarket, 3);
  assert.equal(at({ minWeeksOnMarket: 200 }).minWeeksOnMarket, 8);
  assert.equal(at({ minWeeksOnMarket: 2 }).minWeeksOnMarket, 2);
  assert.equal(at({ mode: 'nonsense' }).mode, 'off');
  assert.equal(at({ mode: 'only' }).mode, 'only');
  assert.equal(at(null).mode, 'off');
});

test('months for a sale, weeks for a let', () => {
  const g = parseMotivationGoals({ minMonthsOnMarket: 5, minWeeksOnMarket: 8 });
  assert.equal(thresholdDaysFor(g, 'sale'), 152);
  assert.equal(thresholdDaysFor(g, 'rent'), 56);
});

test('the questionnaire round-trips the filter', () => {
  const form: Record<string, string> = {
    postcode: 'NG1 1AA', maxDistanceMiles: '25', budget: '200-350', bedrooms: '2',
    sourcingKind: 'sale', m_mode: 'only', m_minMonths: '3', m_minWeeks: '6', m_areaRelative: '1',
  };
  const g = goalsFromForm((k) => form[k] ?? null);
  assert.deepEqual(g.motivation, { mode: 'only', minMonthsOnMarket: 3, minWeeksOnMarket: 6, areaRelative: true });
  // An unchecked box posts nothing at all, which must read as off.
  const off = goalsFromForm((k) => (k === 'm_areaRelative' ? null : form[k] ?? null));
  assert.equal(off.motivation.areaRelative, false);
});

test('the filter shows up in the summary chips only when it is on', () => {
  const base = parseMarketGoals({ version: 1, priorities: {}, sourcingKind: 'sale' })!;
  assert.ok(!describeGoals(base).some((c) => /motivated/i.test(c)));
  const only = { ...base, motivation: { ...base.motivation, mode: 'only' as const } };
  assert.ok(describeGoals(only).includes('Motivated only · 5+ mo listed'));
  const rent = { ...base, sourcingKind: 'rent' as const, motivation: { ...base.motivation, mode: 'prefer' as const } };
  assert.ok(describeGoals(rent).includes('Prefer motivated · 8+ wk listed'));
});
