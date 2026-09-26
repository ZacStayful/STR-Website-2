import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FINANCE } from '../listing/deal.ts';
import { computeOfferRange, targetCeiling, TOO_FAR_BELOW_RATIO, type OfferInput } from './offer-range.ts';
import { NO_OFFER_RULES, parseOfferRules, type OfferRules } from './offer-rules.ts';

const RULES: OfferRules = parseOfferRules({
  purchase: [
    { minMonths: 0, minReductions: 0, discountPct: 0 },
    { minMonths: 6, minReductions: 0, discountPct: 5 },
    { minMonths: 6, minReductions: 2, discountPct: 8 },
  ],
  rentToRent: [
    { minWeeks: 0, discountPct: 0 },
    { minWeeks: 4, discountPct: 5 },
  ],
});

const purchase = (over: Partial<OfferInput> = {}): OfferInput => ({ kind: 'purchase', marketplace: true, asking: 186000, target: 182000, ageDays: 213, reductions: 2, rules: RULES, ...over });
const rent = (over: Partial<OfferInput> = {}): OfferInput => ({ kind: 'rent-to-rent', marketplace: true, asking: 1100, target: 983, ageDays: 35, reductions: 0, rules: RULES, ...over });

test('the target ceiling is the deal page’s own maths', () => {
  // £18,200 gross at a 10% gross yield: £182,000.
  assert.equal(targetCeiling('purchase', 186000, { grossRevenue: 18200, adr: 90 }, 2, { ...DEFAULT_FINANCE, targetYieldPct: 10 }), 182000);
  // £40,000 gross less 48% variable costs and £250 bills: £1,483 a month before rent, less a £500 margin.
  assert.equal(targetCeiling('rent-to-rent', 1100, { grossRevenue: 40000, adr: 110 }, 2, { ...DEFAULT_FINANCE, targetMarginPcm: 500 }), 983);
  assert.equal(targetCeiling('purchase', 186000, null, 2, DEFAULT_FINANCE), null);
  assert.equal(targetCeiling('purchase', 186000, { grossRevenue: 0, adr: 0 }, 2, DEFAULT_FINANCE), null);
});

test('purchase: the brief’s own example', () => {
  const r = computeOfferRange(purchase());
  assert.equal(r.show, true);
  assert.equal(r.shape, 'range');
  assert.equal(r.low, 171000);
  assert.equal(r.high, 182000);
  assert.equal(r.opening, 171000);
  assert.deepEqual(r.target, { ceiling: 182000, atOrAboveAsking: false });
  assert.equal(r.history?.discountPct, 8);
  assert.equal(r.history?.motivated, 171000);
  assert.equal(r.historyIsTop, false);
  assert.deepEqual(r.missing, []);
});

test('rent-to-rent: history above the target is the top of the range', () => {
  const r = computeOfferRange(rent());
  assert.equal(r.show, true);
  assert.equal(r.low, 980);
  assert.equal(r.high, 1040);
  assert.equal(r.historyIsTop, true);
});

test('never above asking: a target over asking is capped at asking', () => {
  const r = computeOfferRange(purchase({ target: 250000, ageDays: 20, reductions: 0 }));
  assert.deepEqual(r.target, { ceiling: 186000, atOrAboveAsking: true });
  assert.equal(r.high, 186000);
  assert.equal(r.low, 186000);
  assert.equal(r.shape, 'exact');
});

test('launch state: no bands set shows the target figure only', () => {
  const r = computeOfferRange(purchase({ rules: NO_OFFER_RULES }));
  assert.equal(r.show, true);
  assert.equal(r.shape, 'upTo');
  assert.equal(r.low, 182000);
  assert.equal(r.high, 182000);
  assert.equal(r.history, null);
  assert.deepEqual(r.missing, ['bandsNotSet']);
});

test('no area revenue, or a studio: the listing history alone', () => {
  const r = computeOfferRange(purchase({ target: null, targetMissing: 'noRevenue' }));
  assert.equal(r.shape, 'around');
  assert.equal(r.opening, 171000);
  assert.deepEqual(r.missing, ['noRevenue']);
  const s = computeOfferRange(purchase({ target: null, targetMissing: 'studio' }));
  assert.deepEqual(s.missing, ['studio']);
});

test('no target and no history: nothing shown, both reasons given', () => {
  const r = computeOfferRange(purchase({ target: null, targetMissing: 'studio', rules: NO_OFFER_RULES }));
  assert.equal(r.show, false);
  assert.deepEqual(r.missing, ['studio', 'bandsNotSet']);
});

test('unknown time on market hides the history part only', () => {
  const r = computeOfferRange(purchase({ ageDays: null }));
  assert.equal(r.shape, 'upTo');
  assert.deepEqual(r.missing, ['noHistory']);
});

test('target far below asking: no range, and the reason keeps the target figure', () => {
  const r = computeOfferRange(purchase({ target: 186000 * TOO_FAR_BELOW_RATIO - 1 }));
  assert.equal(r.show, false);
  assert.deepEqual(r.missing, ['tooFarBelow']);
  assert.equal(r.target?.ceiling, 139000);
});

test('rent-to-rent where no rent leaves the margin: no range, never £0', () => {
  const r = computeOfferRange(rent({ target: 0 }));
  assert.equal(r.show, false);
  assert.deepEqual(r.missing, ['noMargin']);
  assert.equal(r.low, null);
});

test('a 0% band opens at asking', () => {
  const r = computeOfferRange(purchase({ ageDays: 30, reductions: 0 }));
  assert.equal(r.history?.motivated, 186000);
  assert.equal(r.low, 182000);
  assert.equal(r.high, 186000);
  assert.equal(r.historyIsTop, true);
});

test('missing or nonsense inputs hide the whole range', () => {
  for (const asking of [null, 0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = computeOfferRange(purchase({ asking }));
    assert.equal(r.show, false, String(asking));
    assert.deepEqual(r.missing, ['noAsking']);
  }
  assert.deepEqual(computeOfferRange(purchase({ marketplace: false })).missing, ['notMarketplace']);
  assert.deepEqual(computeOfferRange(purchase({ target: Number.NaN })).missing, ['noRevenue']);
  assert.deepEqual(computeOfferRange(purchase({ target: -5, rules: NO_OFFER_RULES })).missing, ['noRevenue', 'bandsNotSet']);
});

test('across a grid of inputs: never negative, low ≤ high ≤ asking, and the ceiling still hits the target', () => {
  for (const asking of [95000, 186000, 450000, 1250000]) {
    for (const gross of [5000, 12000, 18200, 40000, 90000]) {
      for (const yieldPct of [5, 8, 10, 14]) {
        for (const ageDays of [null, 10, 60, 213, 800]) {
          for (const reductions of [0, 1, 3]) {
            const t = targetCeiling('purchase', asking, { grossRevenue: gross, adr: 100 }, 2, { ...DEFAULT_FINANCE, targetYieldPct: yieldPct });
            const r = computeOfferRange({ kind: 'purchase', marketplace: true, asking, target: t, ageDays, reductions, rules: RULES });
            if (!r.show) continue;
            assert.ok(r.low! > 0 && r.low! <= r.high! && r.high! <= asking, JSON.stringify({ asking, gross, yieldPct, r }));
            assert.equal(r.opening, r.low);
            if (r.target && !r.target.atOrAboveAsking) assert.ok((gross / r.target.ceiling) * 100 >= yieldPct, 'rounded ceiling still hits the target');
          }
        }
      }
    }
  }
  for (const asking of [400, 1100, 2500]) {
    for (const gross of [8000, 30000, 60000]) {
      for (const margin of [0, 300, 800]) {
        const t = targetCeiling('rent-to-rent', asking, { grossRevenue: gross, adr: 100 }, 2, { ...DEFAULT_FINANCE, targetMarginPcm: margin });
        const r = computeOfferRange({ kind: 'rent-to-rent', marketplace: true, asking, target: t, ageDays: 40, reductions: 0, rules: RULES });
        if (!r.show) continue;
        assert.ok(r.low! > 0 && r.low! <= r.high! && r.high! <= asking);
        assert.equal(r.low! % 10 === 0 || r.low === asking, true);
      }
    }
  }
});
