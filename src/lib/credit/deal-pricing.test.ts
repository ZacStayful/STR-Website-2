import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allocate,
  priceLabel,
  quoteSource,
  fullAnalysisDue,
  dealAnalysisDue,
  planCreditFor,
  newPricingActive,
  fullAnalysesIncluded,
  dailyDealsMonthly,
  dailyDealsDaysLeft,
  formatPence,
  parsePence,
  parseDays,
  parsePlanCredit,
  parseDateSetting,
  parseRangePct,
  DEFAULT_DEAL_PRICING,
  earliestPricingDateFrom,
  type GrantLite,
} from './deal-pricing.ts';
import { seedTable } from './costs.ts';
import { fullAnalysisRawCeiling } from './estimate.ts';
import { pickPrice } from '../listing/picks.ts';

const NOW = new Date('2026-09-27T12:00:00Z');

let n = 0;
function grant(kind: string, remainingPence: number, spendRate: number, extra: Partial<GrantLite> = {}): GrantLite {
  n += 1;
  const priority = kind === 'plan' ? 1 : kind === 'welcome' ? 2 : 3;
  return { id: `g${n}`, kind, priority, remainingPence, spendRate, expiresAt: kind === 'plan' ? '2026-10-20T00:00:00Z' : null, createdAt: `2026-09-${String(10 + (n % 15)).padStart(2, '0')}T00:00:00Z`, ...extra };
}

const plan = (p: number) => grant('plan', p, 1);
const welcome = (p: number) => grant('welcome', p, 1);
const topup = (p: number, rate = 1.3) => grant('topup', p, rate);

// ── The walk: the same grants, order and rates as credit_debit ──

test('plan credit pays at face value', () => {
  const q = allocate([plan(3999)], 400, NOW);
  assert.equal(q.facePence, 400);
  assert.equal(q.shortfallBasePence, 0);
  assert.deepEqual(q.parts.map((p) => [p.kind, p.basePence, p.facePence]), [['plan', 400, 400]]);
});

test('top-up credit pays 1.3× the plan price', () => {
  const q = allocate([topup(2000)], 400, NOW);
  assert.equal(q.facePence, 520);
});

test('a mixed balance takes the plan credit first, then top-up at its own rate', () => {
  // The worked example: £1.50 of plan credit left and £20 of top-up.
  const q = allocate([topup(2000), plan(150)], 400, NOW);
  assert.equal(q.facePence, 475);
  assert.deepEqual(q.parts.map((p) => [p.kind, p.basePence, p.facePence]), [['plan', 150, 150], ['topup', 250, 325]]);
});

test('a top-up bought at the old 1.5× still spends at 1.5× until it is re-rated', () => {
  assert.equal(allocate([topup(2000, 1.5)], 400, NOW).facePence, 600);
});

test('welcome credit comes after plan credit and before top-up', () => {
  const q = allocate([topup(1000), welcome(100), plan(100)], 400, NOW);
  assert.deepEqual(q.parts.map((p) => p.kind), ['plan', 'welcome', 'topup']);
  assert.equal(q.facePence, 100 + 100 + 260);
});

test('the grant expiring first pays first; one without an expiry pays last', () => {
  const late = grant('plan', 500, 1, { expiresAt: '2026-11-01T00:00:00Z' });
  const soon = grant('plan', 500, 1, { expiresAt: '2026-10-01T00:00:00Z' });
  const q = allocate([late, soon], 100, NOW);
  assert.equal(q.parts[0].grantId, soon.id);
});

test('expired and empty grants, and the negative overdraft, are never walked', () => {
  const expired = grant('plan', 5000, 1, { expiresAt: '2026-09-01T00:00:00Z' });
  const overdraft = grant('adjustment', -300, 1);
  const empty = grant('topup', 0, 1.3);
  const q = allocate([expired, overdraft, empty, welcome(50)], 60, NOW);
  assert.deepEqual(q.parts.map((p) => p.kind), ['welcome']);
  assert.equal(q.shortfallBasePence, 10);
});

test('the quick look worked examples', () => {
  assert.equal(allocate([plan(1000)], 60, NOW).facePence, 60);
  assert.equal(allocate([topup(1000)], 60, NOW).facePence, 78);
  assert.equal(allocate([welcome(1000)], 60, NOW).facePence, 60);
  // 30p of plan credit left: 30 at 1.0, 30 at 1.3.
  assert.equal(allocate([plan(30), topup(1000)], 60, NOW).facePence, 69);
});

// ── The words on the button ──

test('plan members just see the price', () => {
  const l = priceLabel(allocate([plan(3999)], 400, NOW));
  assert.equal(l.main, '£4');
  assert.equal(l.nudge, null);
  assert.equal(l.state, 'ok');
});

test('top-up payers see what they pay and the plan price next to it', () => {
  const l = priceLabel(allocate([topup(2000)], 400, NOW));
  assert.equal(l.main, '£5.20');
  assert.equal(l.nudge, '£4 on a plan');
});

test('a mixed balance shows the exact total and how it splits', () => {
  const l = priceLabel(allocate([plan(150), topup(2000)], 400, NOW));
  assert.equal(l.main, '£4.75');
  assert.equal(l.nudge, '£4 on a plan');
  assert.equal(l.split, '£1.50 plan credit + £3.25 top-up credit');
});

test('short of credit shows the plan price and a short state', () => {
  const l = priceLabel(allocate([plan(150)], 400, NOW));
  assert.equal(l.state, 'short');
  assert.equal(l.main, '£4');
});

test('credit held by a report in flight does not count as spendable', () => {
  const l = priceLabel(allocate([plan(500)], 400, NOW), { spendableBasePence: 300 });
  assert.equal(l.state, 'short');
});

test('admins see no price', () => {
  const l = priceLabel(allocate([], 400, NOW), { admin: true });
  assert.equal(l.state, 'admin');
  assert.equal(l.main, '');
});

test('quoteSource names the credit a price draws on', () => {
  assert.equal(quoteSource(allocate([plan(1000)], 60, NOW)), 'plan');
  assert.equal(quoteSource(allocate([topup(1000)], 60, NOW)), 'topup');
  assert.equal(quoteSource(allocate([plan(30), topup(1000)], 60, NOW)), 'mixed');
  assert.equal(quoteSource(allocate([], 60, NOW)), 'none');
});

test('prices read as a person would write them', () => {
  assert.equal(formatPence(400), '£4');
  assert.equal(formatPence(520), '£5.20');
  assert.equal(formatPence(42.9), '43p');
  assert.equal(formatPence(78), '78p');
  assert.equal(formatPence(340), '£3.40');
});

// ── A full analysis always totals the fixed price ──

test('an unopened deal: one tap is the fixed price, the quick look included', () => {
  assert.deepEqual(fullAnalysisDue({ fullPence: 400, openPaidBasePence: null, withPmi: false, pmiPence: 200 }), { analysisBasePence: 400, pmiBasePence: 0, totalBasePence: 400 });
});

test('after a quick look, the upgrade is the difference', () => {
  assert.equal(fullAnalysisDue({ fullPence: 400, openPaidBasePence: 60, withPmi: false, pmiPence: 200 }).totalBasePence, 340);
  // A daily pick opened at its ladder price before these prices.
  assert.equal(fullAnalysisDue({ fullPence: 400, openPaidBasePence: 40, withPmi: false, pmiPence: 200 }).totalBasePence, 360);
  // Opened as part of a daily deals day, recorded at £0: the full price.
  assert.equal(fullAnalysisDue({ fullPence: 400, openPaidBasePence: 0, withPmi: false, pmiPence: 200 }).totalBasePence, 400);
});

test('the PMI add-on goes on top and is never reduced', () => {
  const due = fullAnalysisDue({ fullPence: 400, openPaidBasePence: 60, withPmi: true, pmiPence: 200 });
  assert.deepEqual(due, { analysisBasePence: 340, pmiBasePence: 200, totalBasePence: 540 });
});

test('one tap on an unopened deal: the quick look first, then the rest, totalling the fixed price', () => {
  const due = dealAnalysisDue({ fullPence: 400, pmiPence: 200, withPmi: false, opened: false, openPaidBasePence: null, openPricePence: 60 });
  assert.deepEqual(due, { openBasePence: 60, analysisBasePence: 340, pmiBasePence: 0, totalBasePence: 340, purchaseBasePence: 400 });
  // With PMI ticked: £6 on the button, taken as 60p + £3.40 + £2.
  assert.equal(dealAnalysisDue({ fullPence: 400, pmiPence: 200, withPmi: true, opened: false, openPaidBasePence: null, openPricePence: 60 }).purchaseBasePence, 600);
});

test('an opened deal: the button is the difference, and nothing is opened again', () => {
  const due = dealAnalysisDue({ fullPence: 400, pmiPence: 200, withPmi: false, opened: true, openPaidBasePence: 60, openPricePence: 60 });
  assert.deepEqual(due, { openBasePence: 0, analysisBasePence: 340, pmiBasePence: 0, totalBasePence: 340, purchaseBasePence: 340 });
  // Opened by a daily-deals email at £0: the full price.
  assert.equal(dealAnalysisDue({ fullPence: 400, pmiPence: 200, withPmi: false, opened: true, openPaidBasePence: 0, openPricePence: 60 }).purchaseBasePence, 400);
});

test('the two debits of a one-tap walk the grants exactly as one debit of the total would', () => {
  const grants: GrantLite[] = [
    { id: 'plan', kind: 'plan', priority: 1, remainingPence: 150, spendRate: 1, expiresAt: '2026-10-20T00:00:00Z', createdAt: '2026-09-20T00:00:00Z' },
    { id: 'top', kind: 'topup', priority: 3, remainingPence: 2000, spendRate: 1.3, expiresAt: null, createdAt: '2026-09-01T00:00:00Z' },
  ];
  const now = new Date('2026-09-27T00:00:00Z');
  const whole = allocate(grants, 400, now);
  const first = allocate(grants, 60, now);
  const after = grants.map((g) => ({ ...g, remainingPence: g.remainingPence - (first.parts.find((p) => p.grantId === g.id)?.facePence ?? 0) }));
  const second = allocate(after, 340, now);
  assert.equal(Math.round(first.facePence + second.facePence), Math.round(whole.facePence));
  assert.equal(Math.round(whole.facePence), 475);
});

test('the difference is never below zero', () => {
  assert.equal(fullAnalysisDue({ fullPence: 400, openPaidBasePence: 900, withPmi: false, pmiPence: 200 }).analysisBasePence, 0);
  assert.equal(fullAnalysisDue({ fullPence: 400, openPaidBasePence: Number.NaN, withPmi: false, pmiPence: 200 }).analysisBasePence, 400);
});

test('the upgrade worked examples from the member side', () => {
  const upgrade = fullAnalysisDue({ fullPence: 400, openPaidBasePence: 60, withPmi: false, pmiPence: 200 }).totalBasePence;
  // Top-up member: 78p for the look, £4.42 for the upgrade = £5.20, as one tap costs.
  assert.equal(allocate([topup(5000)], 60, NOW).facePence + allocate([topup(5000)], upgrade, NOW).facePence, 520);
  assert.equal(priceLabel(allocate([topup(5000)], upgrade, NOW)).main, '£4.42');
  assert.equal(priceLabel(allocate([topup(5000)], upgrade, NOW)).nudge, '£3.40 on a plan');
});

// ── Plan credit: new amounts at the first renewal on or after the date ──

const PRO = { code: 'pro', monthlyCreditPence: 5000 };
const ANNUAL = { code: 'pro_annual', monthlyCreditPence: 5000 };
const FROM = { ...DEFAULT_DEAL_PRICING, newPricingFrom: '2026-10-20T00:00:00.000Z' };

test('plan credit stays as it is until a date is set', () => {
  assert.equal(planCreditFor(PRO, new Date('2027-01-01T00:00:00Z'), DEFAULT_DEAL_PRICING), 5000);
  assert.equal(newPricingActive(DEFAULT_DEAL_PRICING, NOW), false);
});

test('a period that starts before the date keeps the old credit; one on or after it is 1:1', () => {
  assert.equal(planCreditFor(PRO, new Date('2026-10-19T23:59:59Z'), FROM), 5000);
  assert.equal(planCreditFor(PRO, new Date('2026-10-20T00:00:00Z'), FROM), 3999);
  assert.equal(planCreditFor({ code: 'scale', monthlyCreditPence: 14000 }, new Date('2026-11-01T00:00:00Z'), FROM), 9900);
  assert.equal(planCreditFor({ code: 'starter', monthlyCreditPence: 1900 }, new Date('2026-11-01T00:00:00Z'), FROM), 1900);
});

test('the annual plan changes at its next annual renewal, not its next monthly slot', () => {
  // A year that began before the date keeps £50 a month for all twelve slots.
  assert.equal(planCreditFor(ANNUAL, new Date('2026-03-01T00:00:00Z'), FROM), 5000);
  // The year that begins after it gets £30 a month.
  assert.equal(planCreditFor(ANNUAL, new Date('2027-03-01T00:00:00Z'), FROM), 3000);
});

test('a plan with no new amount keeps its old credit', () => {
  assert.equal(planCreditFor({ code: 'legacy', monthlyCreditPence: 2500 }, new Date('2027-01-01T00:00:00Z'), FROM), 2500);
});

test('what each plan covers once daily deals are paid for', () => {
  const p = DEFAULT_DEAL_PRICING;
  assert.equal(fullAnalysesIncluded(1900, p), 2);
  assert.equal(fullAnalysesIncluded(3999, p), 7);
  assert.equal(fullAnalysesIncluded(9900, p), 22);
  assert.equal(fullAnalysesIncluded(3000, p), 5);
  assert.equal(fullAnalysesIncluded(500, p), 0);
});

test('daily deals: 33p a day is about £10 a month', () => {
  assert.equal(dailyDealsMonthly(33), 'about £10 a month');
});

test('days of daily deals a balance covers', () => {
  // £10 of top-up at 1.3 is 769 base pence: 23 days.
  assert.equal(dailyDealsDaysLeft(769.2308, 33), 23);
  assert.equal(dailyDealsDaysLeft(0, 33), 0);
  assert.equal(dailyDealsDaysLeft(-50, 33), 0);
  assert.equal(dailyDealsDaysLeft(500, 0), null);
});

// ── Settings read defensively ──

test('a bad price setting never makes anything free', () => {
  assert.equal(parsePence('400', 1), 400);
  assert.equal(parsePence(0, 400), 400);
  assert.equal(parsePence(-5, 400), 400);
  assert.equal(parsePence('nope', 400), 400);
  assert.equal(parseDays(29.7, 30), 29);
  assert.equal(parseDays(0, 30), 30);
});

test('plan credit, dates and range widths parse defensively', () => {
  assert.deepEqual(parsePlanCredit({ pro: 3999, scale: '9900', bad: -1 }), { pro: 3999, scale: 9900 });
  assert.deepEqual(parsePlanCredit('junk'), DEFAULT_DEAL_PRICING.planCreditPence);
  assert.equal(parseDateSetting(null), null);
  assert.equal(parseDateSetting('2026-10-20'), '2026-10-20T00:00:00.000Z');
  assert.equal(parseDateSetting('not a date'), null);
  assert.deepEqual(parseRangePct({ high: 10, medium: 40, low: 'x' }), { high: 10, medium: 25, low: 25 });
});

// ── Margins: the fixed prices can never sit below what they cost us ──

function seededSetting(key: string): number {
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  const m = sql.match(new RegExp(`\\('${key}',\\s*'(\\d+(?:\\.\\d+)?)'`));
  assert.ok(m, `${key} is not seeded in supabase/schema.sql`);
  return Number(m![1]);
}

test('a full analysis never costs us more than its price, however unlucky the report', () => {
  const table = seedTable();
  const ceiling = fullAnalysisRawCeiling(table);
  const price = seededSetting('full_analysis_pence');
  assert.ok(ceiling < price, `worst-case raw ${ceiling}p must stay below the seeded price ${price}p`);
  assert.ok(ceiling < DEFAULT_DEAL_PRICING.fullAnalysisPence, `worst-case raw ${ceiling}p must stay below the fallback price`);
  // The most expensive report seen in production: £1.79 raw.
  assert.ok(179 < price);
});

test('a full analysis with the PMI second opinion never costs us more than its price', () => {
  const table = seedTable();
  const ceiling = fullAnalysisRawCeiling(table, { pmi: true, priceLabs: true });
  const price = seededSetting('full_analysis_pence') + seededSetting('pmi_addon_pence');
  assert.ok(ceiling < price, `worst-case raw ${ceiling}p must stay below ${price}p`);
  assert.ok(179 + 75 < price);
});

test('a day of daily deals costs more than the pick search behind it', () => {
  assert.ok(pickPrice(seedTable()).rawPence < seededSetting('todays_5_daily_pence'));
});

test('the new prices can only start 14 days after the last member was told', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  // No notice yet: 14 days from now.
  assert.equal(earliestPricingDateFrom(null, now).toISOString(), '2026-10-11T12:00:00.000Z');
  // The last notice went out yesterday: 14 days from then.
  assert.equal(earliestPricingDateFrom(new Date('2026-09-26T09:00:00Z'), now).toISOString(), '2026-10-10T09:00:00.000Z');
  // The notice went out long ago: any date from now.
  assert.equal(earliestPricingDateFrom(new Date('2026-08-01T00:00:00Z'), now).toISOString(), now.toISOString());
});
