import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bothRates,
  DEFAULT_FUNNEL_TIER_SETTINGS,
  monthCost,
  nextTier,
  parseTierSettings,
  parseTiers,
  priceForLead,
  pricingFor,
  tierFor,
  ukMonthKey,
  usageLine,
  withRate,
} from './tiers.ts';
import { estimateAction, reportAction } from '../credit/estimate.ts';
import { seedTable } from '../credit/costs.ts';
import { DEFAULT_SPEND_RATES } from '../credit/pricing.ts';

test('each lead is priced by its own number in the month', () => {
  const at = (n: number) => priceForLead(n, false);
  assert.equal(at(1), 500);
  assert.equal(at(20), 500);
  assert.equal(at(21), 400, 'lead 21 is the first at £4.00');
  assert.equal(at(60), 400);
  assert.equal(at(61), 325);
  assert.equal(at(150), 325);
  assert.equal(at(151), 250);
  assert.equal(at(5000), 250);
});

test('an enhanced report adds £2.00 at every tier', () => {
  for (const n of [1, 20, 21, 60, 61, 150, 151]) assert.equal(priceForLead(n, true) - priceForLead(n, false), 200, `lead ${n}`);
});

test('top-up credit pays the tier price at 1.3×; plan and pack credit at 1×', () => {
  assert.equal(withRate(500, DEFAULT_SPEND_RATES.topup), 650);
  assert.equal(withRate(400, DEFAULT_SPEND_RATES.topup), 520);
  assert.equal(withRate(325, DEFAULT_SPEND_RATES.topup), 423);
  assert.equal(withRate(250, DEFAULT_SPEND_RATES.topup), 325);
  assert.equal(withRate(500, DEFAULT_SPEND_RATES.plan), 500);
  assert.equal(withRate(500, DEFAULT_SPEND_RATES.welcome), 500);
  assert.equal(bothRates(500, 1.3), '£5.00 a lead (£6.50 from top-up credit)');
});

test('no tier is below twice the raw cost of the report it buys', () => {
  // Raw = the seeded unit costs at markup 1 (the typical run; ~97p standard, ~172p enhanced).
  const table = seedTable();
  const rawStandard = estimateAction(table, reportAction(false), { markupOverride: 1 }).typicalBasePence;
  const rawEnhanced = estimateAction(table, reportAction(true), { markupOverride: 1 }).typicalBasePence;
  assert.ok(rawStandard > 90 && rawStandard < 110, `standard raw ${rawStandard}`);
  for (const t of DEFAULT_FUNNEL_TIER_SETTINGS.tiers) {
    assert.ok(t.pence >= rawStandard * 2, `standard tier from ${t.from}: ${t.pence} < 2 × ${rawStandard}`);
    assert.ok(t.pence + DEFAULT_FUNNEL_TIER_SETTINGS.enhancedExtraPence >= rawEnhanced * 2, `enhanced tier from ${t.from}`);
  }
});

test('the month is the UK calendar month, across the clock changes', () => {
  // 23:30 UTC on 31 March 2026 is 00:30 BST on 1 April.
  assert.equal(ukMonthKey(new Date('2026-03-31T23:30:00Z')), '2026-04-01');
  assert.equal(ukMonthKey(new Date('2026-03-31T22:59:00Z')), '2026-03-01');
  // 23:30 UTC on 31 October 2026 is 23:30 GMT: still October.
  assert.equal(ukMonthKey(new Date('2026-10-31T23:30:00Z')), '2026-10-01');
  assert.equal(ukMonthKey(new Date('2026-11-01T00:00:00Z')), '2026-11-01');
  // New Year in GMT.
  assert.equal(ukMonthKey(new Date('2026-12-31T23:59:59Z')), '2026-12-01');
  assert.equal(ukMonthKey(new Date('2027-01-01T00:00:00Z')), '2027-01-01');
});

test('Usage says where the month stands', () => {
  assert.equal(usageLine(34, false), 'This month: 34 leads · £4.00 a lead now · 27 more to reach £3.25');
  assert.equal(usageLine(0, false), 'This month: 0 leads · £5.00 a lead now · 21 more to reach £4.00');
  assert.equal(usageLine(1, false), 'This month: 1 lead · £5.00 a lead now · 20 more to reach £4.00');
  assert.equal(usageLine(20, false), 'This month: 20 leads · £4.00 a lead now · 41 more to reach £3.25');
  assert.equal(usageLine(150, false), 'This month: 150 leads · £2.50 a lead now');
  assert.equal(usageLine(34, true), 'This month: 34 leads · £6.00 a lead now · 27 more to reach £5.25');
});

test('a month costs the sum of each lead at its own tier', () => {
  assert.equal(monthCost(20, false), 20 * 500);
  assert.equal(monthCost(21, false), 20 * 500 + 400);
  assert.equal(monthCost(100, false), 20 * 500 + 40 * 400 + 40 * 325);
  assert.equal(monthCost(0, false), 0);
  assert.equal(monthCost(10, true), 10 * 700);
});

test('tierFor and nextTier', () => {
  assert.equal(tierFor(21).pence, 400);
  assert.equal(nextTier(21)?.from, 61);
  assert.equal(nextTier(151), null);
});

test('a malformed tier list falls back to the defaults whole, never half', () => {
  assert.deepEqual(parseTiers(null), DEFAULT_FUNNEL_TIER_SETTINGS.tiers);
  assert.deepEqual(parseTiers([{ from: 2, pence: 500 }]), DEFAULT_FUNNEL_TIER_SETTINGS.tiers, 'must start at lead 1');
  assert.deepEqual(parseTiers([{ from: 1, pence: 500 }, { from: 1, pence: 0 }]), DEFAULT_FUNNEL_TIER_SETTINGS.tiers, 'never free');
  assert.deepEqual(parseTiers([{ from: 1, pence: 600 }, { from: 11, pence: 450 }]), [{ from: 1, pence: 600 }, { from: 11, pence: 450 }]);
});

test('settings parse from billing_settings rows', () => {
  const rows: Record<string, unknown> = { funnel_tiers: [{ from: 1, pence: 500 }], funnel_enhanced_extra_pence: 150, funnel_tiers_from: '2026-10-02T09:00:00Z', funnel_notice_days: 30 };
  const s = parseTierSettings((k) => rows[k]);
  assert.equal(s.enhancedExtraPence, 150);
  assert.equal(s.tiersFrom?.toISOString(), '2026-10-02T09:00:00.000Z');
  assert.equal(s.noticeDays, 30);
});

test('existing owners keep their price until 30 days after their notice', () => {
  const s = { tiersFrom: new Date('2026-10-02T00:00:00Z'), noticeDays: 30 };
  const old = new Date('2026-09-23T00:00:00Z');
  const now = new Date('2026-10-10T00:00:00Z');
  assert.equal(pricingFor({ firstFunnelAt: null, noticeSentAt: null, now }, s), 'tiers', 'no funnel yet: tiers');
  assert.equal(pricingFor({ firstFunnelAt: new Date('2026-10-05T00:00:00Z'), noticeSentAt: null, now }, s), 'tiers', 'new owner: tiers');
  assert.equal(pricingFor({ firstFunnelAt: old, noticeSentAt: null, now }, s), 'legacy', 'never told: legacy');
  const told = new Date('2026-10-03T00:00:00Z');
  assert.equal(pricingFor({ firstFunnelAt: old, noticeSentAt: told, now: new Date('2026-11-01T23:59:00Z') }, s), 'legacy', 'inside the 30 days');
  assert.equal(pricingFor({ firstFunnelAt: old, noticeSentAt: told, now: new Date('2026-11-02T00:00:00Z') }, s), 'tiers', 'after the 30 days');
  assert.equal(pricingFor({ firstFunnelAt: old, noticeSentAt: null, now }, { tiersFrom: null, noticeDays: 30 }), 'legacy', 'no switch date: nothing changes');
});

test('the £10 pack (£30 credit) is about 5 standard leads', async () => {
  const { leadsFromPack } = await import('./tiers.ts');
  assert.equal(leadsFromPack({ topupPence: 1000, bonusPence: 2000 }, DEFAULT_SPEND_RATES, 500), 5);
  assert.equal(leadsFromPack({ topupPence: 1000, bonusPence: 2000 }, DEFAULT_SPEND_RATES, 0), 0);
});
