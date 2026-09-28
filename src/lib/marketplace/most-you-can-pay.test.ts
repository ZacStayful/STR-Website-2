import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertGapLine, basisLine, cashBuyerOf, gapLine, mostYouCanPay, mostYouCanPayForDeal, payLine, profitNeeded } from './most-you-can-pay.ts';
import { profitRange } from './profit-range.ts';
import { DEFAULT_FINANCE, purchaseDeal, rentToRentDeal } from '../listing/deal.ts';
import { DEFAULT_GOALS } from '../market/goals.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const mine = { ...DEFAULT_FINANCE, targetMarginPcm: 300, depositPct: 25, mortgageRatePct: 5.5, termYears: 25 };

test('the worked example: exact for the property, and on the card’s area estimate', () => {
  const exact = mostYouCanPay({ kind: 'sale', grossRevenue: 30_000, bedrooms: 2, finance: mine, widthPct: 0 })!;
  assert.equal(exact.state, 'price');
  assert.equal(exact.amount, 162_000);
  assert.equal(payLine(exact), 'Most you can pay £162,000');
  assert.equal(basisLine(exact), 'For £300/month profit at your 25% deposit, 5.5% over 25 years (exact for this property)');
  // On the card the income is an estimate, so the figure is where the range STARTS at £300.
  const card = mostYouCanPay({ kind: 'sale', grossRevenue: 30_000, bedrooms: 2, finance: mine, widthPct: 15 })!;
  assert.ok(card.amount! < 162_000);
  assert.equal(payLine(card), `Most you can pay ~£${card.amount!.toLocaleString('en-GB')}`);
  assert.equal(basisLine(card), 'For £300/month profit at your 25% deposit, 5.5% over 25 years (area estimate)');
  assert.equal(profitNeeded(300, 15), 300 / 0.85);
  assert.equal(profitNeeded(0, 15), 10, 'the range is always at least £10 either side');
});

test('"within what you can pay" and "clears your minimum" never disagree on the card', () => {
  let a = 7;
  const next = () => ((a = (a * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  let checked = 0;
  for (let i = 0; i < 400; i += 1) {
    const gross = 15_000 + Math.floor(next() * 45_000);
    const min = Math.floor(next() * 100) * 10;
    const confidence = next() < 0.5 ? 'medium' : 'low';
    const finance = { ...DEFAULT_FINANCE, targetMarginPcm: min, depositPct: 15 + Math.floor(next() * 26), mortgageRatePct: 3 + Math.floor(next() * 50) / 10 };
    for (const kind of ['sale', 'rent'] as const) {
      const c = mostYouCanPay({ kind, grossRevenue: gross, bedrooms: 2, finance, widthPct: WIDTHS[confidence] });
      if (!c || c.state !== 'price') continue;
      const range = (asking: number) => profitRange({ kind, priceAmount: asking, pricePeriod: kind === 'rent' ? 'pcm' : 'total', bedrooms: 2, grossRevenue: gross, confidence, finance, widths: WIDTHS })!;
      const step = kind === 'rent' ? 10 : 1_000;
      for (const asking of [c.amount!, Math.max(step, c.amount! - 3 * step)]) assert.ok(range(asking).lowPcm >= min, `within but short: ${kind} gross ${gross} min ${min} asking ${asking}`);
      assert.ok(range(c.amount! + 10 * step).lowPcm < min, `above but clears: ${kind} gross ${gross} min ${min}`);
      checked += 1;
    }
  }
  assert.ok(checked > 300);
});

test('no price, any price, and rentals', () => {
  const none = mostYouCanPay({ kind: 'sale', grossRevenue: 12_000, bedrooms: 2, finance: { ...mine, targetMarginPcm: 900 }, widthPct: 15 })!;
  assert.equal(none.state, 'none');
  assert.equal(none.amount, null);
  assert.equal(payLine(none), 'No price reaches your £900/month at these figures');
  assert.equal(gapLine(150_000, none), null);
  const cash = mostYouCanPay({ kind: 'sale', grossRevenue: 30_000, bedrooms: 2, finance: mine, cashBuyer: true, widthPct: 15 })!;
  assert.equal(cash.state, 'any');
  assert.equal(payLine(cash), 'Any price clears your £300/month; check your return on cash instead');
  assert.equal(gapLine(400_000, cash), 'Within what you can pay');
  const rent = mostYouCanPay({ kind: 'rent', grossRevenue: 40_000, bedrooms: 2, finance: mine, widthPct: 0 })!;
  assert.equal(rent.amount! % 10, 0);
  assert.equal(payLine(rent), `Most rent you can pay £${rent.amount!.toLocaleString('en-GB')}`);
  assert.equal(basisLine(rent), 'For £300/month profit after the rent (exact for this property)');
  assert.equal(mostYouCanPay({ kind: 'sale', grossRevenue: null, bedrooms: 2, finance: mine, widthPct: 15 }), null);
});

test('house figures on public pages, and the member’s own figures change it', () => {
  const house = mostYouCanPay({ kind: 'sale', grossRevenue: 30_000, bedrooms: 2, finance: null, widthPct: 15 })!;
  assert.equal(house.house, true);
  assert.equal(house.minProfitPcm, 500, 'the £500 fallback');
  assert.equal(basisLine(house), 'For £500/month profit at a 25% deposit, 5.5% over 25 years (area estimate)');
  const at300 = mostYouCanPay({ kind: 'sale', grossRevenue: 30_000, bedrooms: 2, finance: mine, widthPct: 15 })!;
  const at40 = mostYouCanPay({ kind: 'sale', grossRevenue: 30_000, bedrooms: 2, finance: { ...mine, depositPct: 40 }, widthPct: 15 })!;
  assert.ok(at300.amount! > house.amount!);
  assert.ok(at40.amount! > at300.amount!);
  // A rent-to-rent profile's minimum is its own too.
  const r300 = mostYouCanPay({ kind: 'rent', grossRevenue: 40_000, bedrooms: 2, finance: mine, widthPct: 15 })!;
  const r600 = mostYouCanPay({ kind: 'rent', grossRevenue: 40_000, bedrooms: 2, finance: { ...mine, targetMarginPcm: 600 }, widthPct: 15 })!;
  assert.ok(r600.amount! < r300.amount!);
});

test('the gap lines: My deals and the price-drop email', () => {
  const c = { kind: 'sale' as const, state: 'price' as const, amount: 221_000, minProfitPcm: 300, depositPct: 25, mortgageRatePct: 5.5, termYears: 25, basis: 'area' as const, house: false };
  assert.equal(gapLine(245_000, c), '£24,000 above what you can pay');
  assert.equal(gapLine(221_000, c), 'Within what you can pay');
  assert.equal(alertGapLine(227_000, c), 'Now £6,000 above what you can pay');
  assert.equal(alertGapLine(200_000, c), 'Now within what you can pay');
  assert.equal(gapLine(null, c), null);
  assert.equal(gapLine(1_100, { ...c, kind: 'rent', amount: 980 }), '£120 a month above what you can pay');
  for (const line of [payLine(c), basisLine(c), gapLine(245_000, c)!]) assert.ok(!/value|worth|valuation/i.test(line), line);
});

test('from a deal already worked out: a Full analysis exactly, a shared listing on the house figures', () => {
  const d = purchaseDeal(300_000, { grossRevenue: 30_000, adr: 0, bedrooms: 2, finance: mine });
  const exact = mostYouCanPayForDeal(d, { minProfitPcm: 300, basis: 'exact' });
  assert.equal(exact.amount, 162_000);
  assert.equal(gapLine(d.askingPrice, exact), '£138,000 above what you can pay');
  const shared = mostYouCanPayForDeal(d, { house: true, basis: 'listing' });
  assert.equal(shared.minProfitPcm, 500);
  assert.equal(basisLine(shared), 'For £500/month profit at a 25% deposit, 5.5% over 25 years (estimate for this listing)');
  assert.ok(shared.amount! < exact.amount!);
  const r = rentToRentDeal(1_100, { grossRevenue: 40_000, adr: 0, bedrooms: 2, finance: { ...mine, targetMarginPcm: 400 } });
  const rent = mostYouCanPayForDeal(r, { basis: 'exact' });
  assert.equal(rent.minProfitPcm, 400, 'a rent-to-rent deal carries the minimum it was worked at');
  assert.equal(rent.amount, Math.floor((r.monthlyNetBeforeRent - 400) / 10) * 10);
  assert.equal(cashBuyerOf({ ...DEFAULT_GOALS, path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, funding: 'cash' } }), true);
  assert.equal(cashBuyerOf({ ...DEFAULT_GOALS, path: 'r2r', buyer: { ...DEFAULT_GOALS.buyer, funding: 'cash' } }), false);
  assert.equal(cashBuyerOf(null), false);
});
